// static/js/app.js
// Clean frontend scheduler: no import/export JSON, keeps table and UI controls.

(function () {
  /* ---------- Helpers ---------- */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const randColor = (n) => {
    const colors = ["#ef4444","#f97316","#f59e0b","#10b981","#06b6d4","#3b82f6","#8b5cf6","#ec4899"];
    return colors[n % colors.length];
  };

  /* ---------- State ---------- */
  let processes = [
    { id: 1, pid: "P1", arrival: 0, burst: 4, remaining: 4, color: randColor(1) },
    { id: 2, pid: "P2", arrival: 1, burst: 3, remaining: 3, color: randColor(2) },
    { id: 3, pid: "P3", arrival: 2, burst: 1, remaining: 1, color: randColor(3) }
  ];
  let nextId = 4;
  let mode = "ADAPTIVE"; // ADAPTIVE | FCFS | SRTF | RR
  let goal = "";
  let enablePrediction = true;
  let events = [];
  let metrics = null;
  let tick = 0;
  let interval = null;
  let speed = 250; // ms per tick
  const ganttContainer = $("#ganttSvgContainer");

  /* ---------- Analysis / Recommendation ---------- */
  function analyze(ps) {
    if (!ps || ps.length === 0) return null;
    const bursts = ps.map(p => p.burst);
    const avg = bursts.reduce((a,b) => a+b,0)/bursts.length;
    const variance = bursts.reduce((a,b)=>a+(b-avg)*(b-avg),0)/bursts.length;
    const std = Math.sqrt(variance);
    return { n: ps.length, avg, variance, std };
  }

  function recommend(ps, g=null) {
    const stats = analyze(ps);
    if (!stats) return { algo: "FCFS", reason: "no processes", score:0.5 };
    if (g === "minWaiting") return { algo:"SRTF", reason:"Min waiting", score:0.9 };
    if (g === "fairness") return { algo:"RR", reason:"Fairness", score:0.85 };
    if (g === "lowContext") return { algo:"FCFS", reason:"Low context switches", score:0.75 };
    if (stats.std / Math.max(1, stats.avg) > 0.6) return { algo:"SRTF", reason:"High burst variance", score:0.9 };
    if (stats.n > 6) return { algo:"RR", reason:"Many processes", score:0.8 };
    return { algo:"FCFS", reason:"Default heuristic", score:0.65 };
  }

  function suggestQuantum(ps) {
    const stats = analyze(ps);
    if (!stats) return 4;
    return Math.min(10, Math.max(2, Math.round(stats.avg)));
  }

  /* ---------- Simulation engines ---------- */
  const deepcopy = (arr) => arr.map(p => ({ ...p, remaining: p.remaining == null ? p.burst : p.remaining }));

  function finalize(procs, events, algoTimeline=[]) {
    const completion = {};
    for (let i = events.length-1; i>=0; --i) {
      const ev = events[i];
      if (ev.pid && completion[ev.pid] == null) completion[ev.pid] = ev.time + 1;
    }
    const metricsArr = procs.map(p => {
      const ct = completion[p.pid] ?? 0;
      const tat = ct - p.arrival;
      const wt = tat - p.burst;
      return { pid: p.pid, arrival: p.arrival, burst: p.burst, completion: ct, tat, wt };
    });
    const busy = events.filter(e => e.pid !== null).length;
    let prev = null, ctx = 0;
    events.forEach(e => { if (e.pid !== prev && prev !== null && e.pid !== null) ctx++; prev = e.pid; });
    const totalTime = events.length || 1;
    return {
      metrics: metricsArr,
      events,
      algoTimeline,
      avgWaiting: metricsArr.reduce((a,b)=>a+b.wt,0)/Math.max(1,metricsArr.length),
      avgTurnaround: metricsArr.reduce((a,b)=>a+b.tat,0)/Math.max(1,metricsArr.length),
      throughput: metricsArr.length/totalTime,
      cpuUtil: (busy/totalTime)*100,
      contextSwitches: ctx,
      totalTime
    };
  }

  function simulateFCFS(input) {
    const procs = deepcopy(input);
    const ev = [];
    let time = 0, completed = 0, n = procs.length;
    while (completed < n) {
      const ready = procs.filter(p=>p.arrival <= time && p.remaining>0).sort((a,b)=>a.arrival - b.arrival || a.id - b.id);
      if (ready.length === 0) { ev.push({time, pid:null}); time++; continue; }
      const cur = ready[0];
      while (cur.remaining > 0) { ev.push({time, pid:cur.pid}); cur.remaining--; time++; }
      completed++;
    }
    return finalize(procs, ev, []);
  }

  function simulateSRTF(input) {
    const procs = deepcopy(input);
    const ev = [];
    let time=0, completed=0, n=procs.length;
    while (completed < n) {
      const ready = procs.filter(p=>p.arrival<=time && p.remaining>0);
      if (ready.length===0) { ev.push({time, pid:null}); time++; continue; }
      ready.sort((a,b)=>a.remaining - b.remaining || a.arrival - b.arrival);
      const cur = ready[0];
      ev.push({time, pid:cur.pid}); cur.remaining--; if (cur.remaining===0) completed++; time++;
    }
    return finalize(procs, ev, []);
  }

  function simulateRR(input, quantum) {
    const procs = deepcopy(input);
    const ev = [];
    let time=0, completed=0, n=procs.length;
    const queue = [];
    while (completed < n) {
      procs.forEach(p=>{ if (p.arrival === time) queue.push(p); });
      if (queue.length === 0) { ev.push({time, pid:null}); time++; continue; }
      const cur = queue.shift();
      let slice = 0;
      while (cur.remaining > 0 && slice < quantum) {
        ev.push({time, pid:cur.pid}); cur.remaining--; time++; slice++;
        procs.forEach(p=>{ if (p.arrival === time) queue.push(p); });
      }
      if (cur.remaining > 0) queue.push(cur); else completed++;
    }
    return finalize(procs, ev, []);
  }

  function simulateAdaptive(input, goal=null, enablePrediction=true) {
    const rec = recommend(input, goal);
    const stats = analyze(input);
    if (enablePrediction && stats && stats.std / Math.max(1, stats.avg) > 0.5) return simulateSRTF(input);
    if (rec.algo === "SRTF") return simulateSRTF(input);
    if (rec.algo === "RR") return simulateRR(input, suggestQuantum(input));
    return simulateFCFS(input);
  }

  /* ---------- UI & wiring ---------- */
  function renderProcTable() {
    const tbody = $("#procTbody");
    tbody.innerHTML = "";
    if (processes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted center small">No processes</td></tr>`;
      return;
    }
    processes.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${p.pid}</td><td class="center">${p.arrival}</td><td class="center">${p.burst}</td><td class="right"><button class="link" data-id="${p.id}">Remove</button></td>`;
      tbody.appendChild(tr);
    });
    $$("#procTbody .link").forEach(btn => btn.addEventListener("click", (e) => {
      const id = Number(e.target.dataset.id);
      processes = processes.filter(x=>x.id !== id);
      recompute();
    }));
  }

  // keep a small table in the sidebar showing processes for quick view
  function refreshSidebarTable() {
    const t = $("#jsonTableBody");
    if (!t) return;
    if (processes.length === 0) {
      t.innerHTML = `<tr><td colspan="3" class="muted center small">No data</td></tr>`;
      return;
    }
    t.innerHTML = processes.map(p => `<tr><td>${p.pid}</td><td>${p.arrival}</td><td>${p.burst}</td></tr>`).join("");
  }

  function recompute() {
    if (mode === "FCFS") metrics = simulateFCFS(processes);
    else if (mode === "SRTF") metrics = simulateSRTF(processes);
    else if (mode === "RR") metrics = simulateRR(processes, suggestQuantum(processes));
    else metrics = simulateAdaptive(processes, goal || null, enablePrediction);
    events = metrics.events;
    tick = 0;
    updateRec();
    updateUI();
    refreshSidebarTable();
  }

  function updateRec() {
    const rec = recommend(processes, goal || null);
    $("#recAlgo").innerText = rec.algo;
    $("#recReason").innerText = rec.reason;
    $("#recQuantum").innerText = suggestQuantum(processes);
  }

  function updateUI() {
    $("#tickLabel").innerText = `Tick: ${tick}/${metrics ? metrics.totalTime : 0}`;
    const sb = $("#summaryBox");
    if (!metrics) sb.innerHTML = "No data";
    else {
      sb.innerHTML = `
        <div>Avg Waiting: ${metrics.avgWaiting.toFixed(2)}</div>
        <div>Avg Turnaround: ${metrics.avgTurnaround.toFixed(2)}</div>
        <div>CPU Util: ${metrics.cpuUtil.toFixed(2)}%</div>
        <div>Throughput: ${metrics.throughput.toFixed(2)}</div>
        <div>Context switches: ${metrics.contextSwitches}</div>
      `;
    }
    renderGantt();
    renderProcTable();
  }

  /* ---------- Gantt drawing (SVG) ---------- */
  function renderGantt() {
    const cont = ganttContainer;
    cont.innerHTML = "";
    if (!metrics) return;
    const total = metrics.totalTime;
    const w = Math.max(600, Math.min(1200, Math.floor(window.innerWidth * 0.65)));
    const h = 160;
    const pxPer = w / Math.max(1, total);
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.classList.add("gantt-svg");

    for (let i=0;i<total;i++){
      const line = document.createElementNS(svgNS, "line");
      const x = Math.round(i*pxPer)+0.5;
      line.setAttribute("x1", x); line.setAttribute("x2", x);
      line.setAttribute("y1", 0); line.setAttribute("y2", h);
      line.setAttribute("stroke", "#f0f0f0"); line.setAttribute("stroke-width", "1");
      svg.appendChild(line);
    }

    const blocks = [];
    for (let i=0;i<events.length;i++){
      const e = events[i];
      if (blocks.length===0 || blocks[blocks.length-1].pid !== e.pid) blocks.push({pid:e.pid, start:e.time, end:e.time+1});
      else blocks[blocks.length-1].end = e.time+1;
    }

    blocks.forEach(b => {
      const x = Math.round(b.start*pxPer);
      const wrect = Math.max(1, Math.round((b.end - b.start)*pxPer));
      const rect = document.createElementNS(svgNS, "rect");
      const pid = b.pid;
      const color = pid ? (processes.find(p=>p.pid===pid)?.color || "#888") : "#ddd";
      rect.setAttribute("x", x); rect.setAttribute("y", 30);
      rect.setAttribute("width", wrect); rect.setAttribute("height", 40);
      rect.setAttribute("rx", 6);
      rect.setAttribute("fill", color);
      rect.setAttribute("opacity", pid ? 1 : 0.6);
      svg.appendChild(rect);

      const txt = document.createElementNS(svgNS, "text");
      txt.setAttribute("x", x + 6); txt.setAttribute("y", 54);
      txt.setAttribute("font-size","12"); txt.setAttribute("fill","#fff");
      txt.textContent = pid ?? "idle";
      svg.appendChild(txt);

      if (tick >= b.start && tick < b.end) {
        const overlay = document.createElementNS(svgNS, "rect");
        overlay.setAttribute("x", x); overlay.setAttribute("y", 20);
        overlay.setAttribute("width", wrect); overlay.setAttribute("height", 60);
        overlay.setAttribute("fill", "rgba(0,0,0,0.06)");
        svg.appendChild(overlay);
      }
    });

    const cursor = document.createElementNS(svgNS, "line");
    const cx = Math.round(tick * pxPer) + 0.5;
    cursor.setAttribute("x1", cx); cursor.setAttribute("x2", cx);
    cursor.setAttribute("y1", 0); cursor.setAttribute("y2", h);
    cursor.setAttribute("stroke", "#111"); cursor.setAttribute("stroke-width","2");
    svg.appendChild(cursor);

    cont.appendChild(svg);
  }

  /* ---------- Controls handlers ---------- */
  function addProcess(arrival, burst) {
    const id = nextId++;
    const p = { id, pid:`P${id}`, arrival: Number(arrival), burst: Number(burst), remaining: Number(burst), color: randColor(id) };
    processes.push(p);
    processes.sort((a,b)=>a.arrival - b.arrival || a.id - b.id);
    recompute();
  }

  function removeProcessById(id) {
    processes = processes.filter(p => p.id !== id);
    recompute();
  }

  /* ---------- Buttons & wiring ---------- */
  function wire() {
    $("#mode").addEventListener("change", (e)=>{ mode = e.target.value; recompute(); });
    $("#goal").addEventListener("change", (e)=>{ goal = e.target.value; recompute(); });
    $("#predict").addEventListener("change", (e)=>{ enablePrediction = e.target.checked; recompute(); });

    $("#addProc").addEventListener("click", ()=>{
      const a = Number($("#inArrival").value || 0);
      const b = Number($("#inBurst").value || 1);
      addProcess(a,b);
      $("#inArrival").value = ""; $("#inBurst").value = "";
      $("#inArrival").focus();
    });

    $("#addSample").addEventListener("click", ()=>{
      const sample = [
        {arrival:0, burst:5},
        {arrival:2, burst:3},
        {arrival:4, burst:1},
      ];
      sample.forEach(s => addProcess(s.arrival, s.burst));
    });

    $("#loadSimple").addEventListener("click", ()=> {
      processes = [
        { id:1, pid:"P1", arrival:0, burst:5, remaining:5, color: randColor(1)},
        { id:2, pid:"P2", arrival:2, burst:3, remaining:3, color: randColor(2)},
        { id:3, pid:"P3", arrival:4, burst:1, remaining:1, color: randColor(3)}
      ];
      nextId = 4;
      recompute();
    });

    $("#playBtn").addEventListener("click", ()=>{
      if (!metrics) return;
      if (interval) { clearInterval(interval); interval = null; $("#playBtn").innerText = "Play"; return; }
      interval = setInterval(()=> {
        tick++;
        if (tick >= metrics.totalTime) { clearInterval(interval); interval = null; $("#playBtn").innerText = "Play"; tick = metrics.totalTime; }
        updateUI();
      }, speed);
      $("#playBtn").innerText = "Pause";
    });

    $("#stepBack").addEventListener("click", ()=> { if (!metrics) return; tick = Math.max(0, tick-1); updateUI(); });
    $("#stepForward").addEventListener("click", ()=> { if (!metrics) return; tick = Math.min(metrics.totalTime, tick+1); updateUI(); });
    $("#resetBtn").addEventListener("click", ()=> { if (!metrics) return; tick = 0; clearInterval(interval); interval = null; $("#playBtn").innerText = "Play"; updateUI(); });
  }

  /* ---------- Init ---------- */
  function init() {
    document.addEventListener("click", (e) => {
      if (e.target && e.target.matches && e.target.matches(".link")) {
        const id = Number(e.target.dataset?.id);
        if (id) removeProcessById(id);
      }
    });

    wire();
    recompute();
    refreshSidebarTable();
    const inp = $("#inArrival");
    if (inp) inp.focus();
    window.addEventListener("resize", () => renderGantt());
  }

  // expose small debug API
  window.schedulerApp = {
    getState: () => ({ processes, metrics, events, tick }),
    recompute
  };

  init();

})();

// UX: minor debug marker
console.log('UI: simulator loaded');

