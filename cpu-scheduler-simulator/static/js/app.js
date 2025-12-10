// static/js/app.js
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const randColor = n => {
    const colors = ["#ef4444","#f97316","#f59e0b","#10b981","#06b6d4","#3b82f6","#8b5cf6","#ec4899"];
    return colors[n % colors.length];
  };

  // initial state
  let processes = [
    { id:1, pid:"P1", arrival:0, burst:4, remaining:4, color: randColor(1) },
    { id:2, pid:"P2", arrival:1, burst:3, remaining:3, color: randColor(2) },
    { id:3, pid:"P3", arrival:2, burst:1, remaining:1, color: randColor(3) }
  ];
  let nextId = 4;
  let mode = "ADAPTIVE";
  let goal = "";
  let enablePrediction = true;
  let events = [], metrics = null, tick = 0;

  /* ---------- recommendation & helpers ---------- */
  function analyze(ps) {
    if (!ps || ps.length===0) return null;
    const bursts = ps.map(p=>p.burst);
    const avg = bursts.reduce((a,b)=>a+b,0)/bursts.length;
    const variance = bursts.reduce((a,b)=>a+(b-avg)*(b-avg),0)/bursts.length;
    const std = Math.sqrt(variance);
    return { n:ps.length, avg, variance, std };
  }

  function recommend(ps,g=null) {
    const stats = analyze(ps);
    if (!stats) return {algo:"FCFS", reason:"no processes"};
    if (g==="minWaiting") return {algo:"SRTF", reason:"Min waiting"};
    if (g==="fairness") return {algo:"RR", reason:"Fairness"};
    if (g==="lowContext") return {algo:"FCFS", reason:"Low context switches"};
    if (stats.std / Math.max(1,stats.avg) > 0.6) return {algo:"SRTF", reason:"High burst variance"};
    if (stats.n > 6) return {algo:"RR", reason:"Many processes"};
    return {algo:"FCFS", reason:"Default heuristic"};
  }

  function suggestQuantum(ps) {
    const s = analyze(ps);
    if (!s) return 4;
    return Math.min(10, Math.max(2, Math.round(s.avg)));
  }

  /* ---------- backend simulate (preferred) ---------- */
  async function backendSimulate() {
    const body = { algorithm: mode, quantum: suggestQuantum(processes), processes };
    try {
      const r = await fetch('/simulate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('simulate error');
      const j = await r.json();
      events = j.events;
      metrics = j.metrics;
    } catch (err) {
      console.warn('backend simulate failed, falling back local', err);
      localRecompute();
    }
    tick = 0;
    updateRec();
    updateUI();
  }

  /* ---------- fallback local recompute (FCFS) ---------- */
  function localRecompute() {
    const sorted = processes.slice().sort((a,b)=>a.arrival - b.arrival || a.id - b.id);
    const ev = []; let t=0;
    for (const p of sorted) {
      if (t < p.arrival) { for (let x=t;x<p.arrival;x++) ev.push({time:x,pid:null}); t = p.arrival; }
      for (let i=0;i<p.burst;i++){ ev.push({time:t,pid:p.pid}); t++; }
    }
    events = ev;
    metrics = { totalTime: ev.length, events: ev, avgWaiting:0, avgTurnaround:0, cpuUtil:100, throughput:0, contextSwitches:0, processMetrics:[] };
  }

  /* ---------- UI helpers ---------- */
  function renderProcTable() {
    const tbody = $("#procTbody");
    tbody.innerHTML = "";
    if (processes.length===0) { tbody.innerHTML = `<tr><td colspan="4" class="muted center small">No processes</td></tr>`; return; }
    processes.forEach(p=> {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${p.pid}</td><td class="center">${p.arrival}</td><td class="center">${p.burst}</td><td class="right"><button class="link" data-id="${p.id}">Remove</button></td>`;
      tbody.appendChild(tr);
    });
    $$("#procTbody .link").forEach(btn => btn.addEventListener('click', e => {
      processes = processes.filter(x => x.id !== Number(e.target.dataset.id));
      recompute();
    }));
  }

  function refreshSidebarTable() {
    const t = $("#jsonTableBody");
    if (!t) return;
    if (processes.length===0) { t.innerHTML = `<tr><td colspan="3" class="muted center small">No data</td></tr>`; return; }
    t.innerHTML = processes.map(p=>`<tr><td>${p.pid}</td><td>${p.arrival}</td><td>${p.burst}</td></tr>`).join('');
  }

  function updateRec() {
    const rec = recommend(processes, goal || null);
    $("#recAlgo").innerText = rec.algo;
    $("#recReason").innerText = rec.reason;
    $("#recQuantum").innerText = suggestQuantum(processes);
  }

  /* ---------- Animated canvas Gantt (same engine as before) ---------- */
  (function(){
    const canvas = document.getElementById("gantt");
    const playBtn = document.getElementById("playBtn");
    const pauseBtn = document.getElementById("pauseBtn");
    const speedSel = document.getElementById("speedSel");
    const popup = document.getElementById("processPopup");
    const popupPid = document.getElementById("popupPid");
    const popupMeta = document.getElementById("popupMeta");
    const sidebarPlay = document.getElementById("playSidebar");
    const exportPNG = document.getElementById("exportPNG");
    const downloadJSON = document.getElementById("downloadJSON");

    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha:false });
    const padding = { left:60, right:20, top:18, bottom:30 };
    const trackH = 22, trackGap = 10, radius=6, LIFT = 8;

    let anim = { schedule:null, pidRows:[], start:0, end:1, current:0, playing:false, speed:1, lastTs:null, width:0, height:0 };

    function colorForPid(pid) {
      if (!pid) return "#e5e7eb";
      let hash=0; for (let i=0;i<pid.length;i++) hash = pid.charCodeAt(i) + ((hash<<5)-hash);
      const h = Math.abs(hash) % 360; return `hsl(${h}deg 72% 56%)`;
    }

    function prepare(schedule) {
      const pids=[];
      schedule.forEach(s=>{ if (s[2]!==null && !pids.includes(s[2])) pids.push(s[2]); });
      const pidRows = pids.map((pid,idx)=>({pid,row:idx,color:colorForPid(pid)}));
      const start = Math.min(...schedule.map(s=>s[0]));
      const end = Math.max(...schedule.map(s=>s[1]));
      return { pidRows, start, end };
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = "100%";
      ctx.setTransform(dpr,0,0,dpr,0,0);
      anim.width = rect.width; anim.height = rect.height;
    }

    function roundRect(c,x,y,w,h,r) {
      const rad = Math.min(r,h/2,w/2);
      c.beginPath();
      c.moveTo(x+rad,y);
      c.arcTo(x+w,y,x+w,y+h,rad);
      c.arcTo(x+w,y+h,x,y+h,rad);
      c.arcTo(x,y+h,x,y,rad);
      c.arcTo(x,y,x+w,y,rad);
      c.closePath();
      c.fill();
    }

    function renderStatic(schedule,meta) {
      resizeCanvas();
      const { pidRows, start, end } = meta;
      ctx.clearRect(0,0,anim.width,anim.height);
      ctx.fillStyle="#fff"; ctx.fillRect(0,0,anim.width,anim.height);
      ctx.fillStyle="#0b1220"; ctx.font="600 14px Arial"; ctx.fillText("Time →",8,padding.top+6);

      pidRows.forEach(row=>{
        const y = padding.top + 28 + row.row * (trackH + trackGap);
        ctx.fillStyle="#0b1220"; ctx.font="600 12px Arial"; ctx.fillText(row.pid,8,y+trackH/2+2);
        ctx.fillStyle="#f8fafc"; const x0 = padding.left; const w = anim.width - padding.left - padding.right; ctx.fillRect(x0, y, w, trackH);
      });

      schedule.forEach(seg=>{
        const [s,e,pid] = seg;
        const row = pid ? pidRows.find(p=>p.pid===pid) : null;
        const y = pid ? padding.top + 28 + row.row * (trackH + trackGap) : padding.top + 28 + (pidRows.length*(trackH+trackGap));
        const x1 = timeToX(s,start,end,anim.width);
        const x2 = timeToX(e,start,end,anim.width); const w = Math.max(1, x2-x1);
        ctx.fillStyle = pid ? row.color : "#e5e7eb"; ctx.globalAlpha = pid?1:0.9;
        roundRect(ctx, x1, y+2, w, trackH-4, radius);
        if (w>40) { ctx.fillStyle="#fff"; ctx.font="600 11px Arial"; ctx.textAlign="center"; ctx.fillText(pid?`${pid} (${s}-${e})`:"idle", x1+w/2, y+trackH/2+2); }
        else { ctx.fillStyle="#0b1220"; ctx.font="11px Arial"; ctx.textAlign="left"; ctx.fillText(pid||"idle", x2+6, y+trackH/2+2); }
      });

      // ticks
      ctx.fillStyle="#374151"; ctx.font="11px Arial"; ctx.textAlign="center";
      const ticks = Math.min(12, Math.ceil((meta.end-meta.start)));
      for (let i=0;i<=ticks;i++){
        const t = meta.start + (i/ticks)*(meta.end-meta.start);
        const x = timeToX(t, meta.start, meta.end, anim.width);
        ctx.fillRect(x-0.5, padding.top+12, 1, 6);
        ctx.fillText(Math.round(t).toString(), x, padding.top+6);
      }
      ctx.globalAlpha = 1;
    }

    function timeToX(t, start, end, w) {
      const usable = w - padding.left - padding.right;
      if (end === start) return padding.left;
      return padding.left + ((t-start)/(end-start)) * usable;
    }

    function renderFrame() {
      if (!anim.schedule) return;
      renderStatic(anim.schedule, { pidRows: anim.pidRows, start: anim.start, end: anim.end });
      // highlight active: draw lifted bar overlay for current segment
      const active = anim.schedule.find(seg => (anim.current >= seg[0] && anim.current < seg[1]));
      if (active) {
        const [s,e,pid] = active;
        const rowInfo = pid ? anim.pidRows.find(r => r.pid === pid) : null;
        const y = pid ? padding.top + 28 + rowInfo.row * (trackH + trackGap) : padding.top + 28 + (anim.pidRows.length*(trackH+trackGap));
        const x1 = timeToX(s, anim.start, anim.end, anim.width);
        const x2 = timeToX(e, anim.start, anim.end, anim.width); const w = Math.max(1, x2-x1);
        const liftedY = y - LIFT;
        ctx.save();
        ctx.fillStyle = pid ? rowInfo.color : "#e5e7eb";
        roundRect(ctx, x1, liftedY+2, w, trackH-4, radius);
        ctx.restore();
      }
      // progress shade and cursor
      const executedX = timeToX(anim.current, anim.start, anim.end, anim.width);
      ctx.fillStyle = "rgba(2,6,23,0.04)";
      ctx.fillRect(padding.left, padding.top + 24, executedX - padding.left, anim.height - padding.top - padding.bottom - 24);
      ctx.beginPath(); ctx.strokeStyle="#ff3b58"; ctx.lineWidth=2; ctx.moveTo(executedX+0.5, padding.top+8); ctx.lineTo(executedX+0.5, anim.height - padding.bottom + 6); ctx.stroke();
      ctx.fillStyle="#0b1220"; ctx.font="600 12px Arial"; ctx.textAlign="center"; ctx.fillText(anim.current.toFixed(2), executedX, padding.top+2);
    }

    function showPopup(pid, start, burst) {
      if (!popup || !anim) return;
      if (!pid) return;
      const row = anim.pidRows.find(r=>r.pid===pid);
      if (!row) return;
      const canvasRect = canvas.getBoundingClientRect();
      const x1 = timeToX(start, anim.start, anim.end, canvasRect.width);
      const x2 = timeToX(start+burst, anim.start, anim.end, canvasRect.width);
      const centerX = Math.round((x1+x2)/2);
      const y = padding.top + 28 + row.row * (trackH + trackGap);
      const top = canvasRect.top + window.scrollY + Math.max(6, y - 36 - LIFT);
      const left = canvasRect.left + centerX - 60;
      popup.style.left = `${Math.max(8,left)}px`;
      popup.style.top = `${top}px`;
      $("#popupPid").innerText = pid;
      $("#popupMeta").innerText = `Burst: ${burst}  •  Start: ${start}`;
      popup.classList.remove('pop'); void popup.offsetWidth; popup.classList.add('pop'); popup.setAttribute('aria-hidden','false');
      clearTimeout(popup._hideTimer);
      popup._hideTimer = setTimeout(()=> { popup.classList.remove('pop'); popup.setAttribute('aria-hidden','true'); }, 1200);
    }

    function loop(ts) {
      if (!anim.playing) { anim.lastTs = null; return; }
      if (!anim.lastTs) anim.lastTs = ts;
      const dtMs = ts - anim.lastTs; anim.lastTs = ts;
      const dt = (dtMs / 1000) * anim.speed;
      anim.current += dt;
      if (anim.schedule) {
        for (let i=0;i<anim.schedule.length;i++){
          const seg = anim.schedule[i];
          if (anim.current >= seg[0] && anim.current - dt < seg[0]) {
            showPopup(seg[2], seg[0], seg[1]-seg[0]);
          }
        }
      }
      if (anim.current >= anim.end) {
        anim.current = anim.end; renderFrame(); anim.playing=false; playBtn.disabled=false; pauseBtn.disabled=true; if (sidebarPlay) sidebarPlay.innerText="Play"; return;
      }
      renderFrame();
      requestAnimationFrame(loop);
    }

    // export PNG
    exportPNG && exportPNG.addEventListener('click', ()=> {
      if (!anim.schedule) return alert('Nothing to export');
      // create temporary canvas with full resolution
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width; tmp.height = canvas.height;
      const tctx = tmp.getContext('2d');
      // draw current canvas contents
      tctx.drawImage(canvas, 0, 0);
      const data = tmp.toDataURL('image/png');
      const a = document.createElement('a'); a.href = data; a.download = 'gantt.png'; a.click();
    });

    // download JSON
    downloadJSON && downloadJSON.addEventListener('click', ()=> {
      if (!anim.schedule) return alert('No schedule to download');
      const payload = { schedule: anim.schedule, start: anim.start, end: anim.end, generated: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'schedule.json'; a.click(); URL.revokeObjectURL(url);
    });

    window.drawGanttAnimated = function(schedule) {
      if (!Array.isArray(schedule) || schedule.length===0) { ctx.clearRect(0,0,canvas.width,canvas.height); return; }
      const meta = prepare(schedule);
      anim.schedule = schedule;
      anim.pidRows = meta.pidRows;
      anim.start = meta.start; anim.end = meta.end;
      anim.current = meta.start;
      anim.speed = parseFloat(speedSel.value) || 1;
      anim.playing = false; anim.lastTs = null;
      renderStatic(schedule, { pidRows: anim.pidRows, start: anim.start, end: anim.end });
      renderFrame();
      playBtn.disabled = false; pauseBtn.disabled = true; if (sidebarPlay) sidebarPlay.innerText="Play";

      playBtn.onclick = function() {
        if (!anim.schedule) return;
        if (anim.current >= anim.end) anim.current = anim.start; // replay support
        anim.playing = true; anim.speed = parseFloat(speedSel.value) || 1;
        playBtn.disabled = true; pauseBtn.disabled = false; if (sidebarPlay) sidebarPlay.innerText="Pause";
        requestAnimationFrame(loop);
      };
      pauseBtn.onclick = function() { anim.playing=false; playBtn.disabled=false; pauseBtn.disabled=true; if (sidebarPlay) sidebarPlay.innerText="Play"; };
      speedSel.onchange = function() { anim.speed = parseFloat(speedSel.value) || 1; };

      if (sidebarPlay) {
        sidebarPlay.onclick = function() {
          if (!anim.schedule) return;
          if (anim.playing) { anim.playing=false; playBtn.disabled=false; pauseBtn.disabled=true; sidebarPlay.innerText="Play"; }
          else { if (anim.current >= anim.end) anim.current = anim.start; anim.playing=true; anim.speed=parseFloat(speedSel.value)||1; playBtn.disabled=true; pauseBtn.disabled=false; sidebarPlay.innerText="Pause"; requestAnimationFrame(loop); }
        };
      }

      // handle resizing to keep canvas full width and popup placement correct
      resizeCanvas();
      setTimeout(()=> { resizeCanvas(); renderStatic(schedule, { pidRows: anim.pidRows, start: anim.start, end: anim.end }); renderFrame(); }, 30);
    };

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(800, rect.width) * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = "100%";
      ctx.setTransform(dpr,0,0,dpr,0,0);
      anim.width = rect.width; anim.height = rect.height;
    }

    window.addEventListener('resize', ()=> { if (anim.schedule) { resizeCanvas(); renderStatic(anim.schedule, { pidRows: anim.pidRows, start: anim.start, end: anim.end }); renderFrame(); } });
  })();

  /* ---------- main wiring ---------- */
  function recompute() { backendSimulate(); }

  function updateUI() {
    $("#tickLabel").innerText = `Tick: ${tick}/${metrics ? metrics.totalTime : 0}`;
    const sb = $("#summaryBox");
    if (!metrics) sb.innerHTML = "No data";
    else {
      sb.innerHTML = `<div>Avg Waiting: ${metrics.avgWaiting.toFixed(2)}</div><div>Avg Turnaround: ${metrics.avgTurnaround.toFixed(2)}</div><div>CPU Util: ${metrics.cpuUtil.toFixed(2)}%</div><div>Throughput: ${metrics.throughput.toFixed(2)}</div><div>Context switches: ${metrics.contextSwitches}</div>`;
      // draw schedule
      const blocks = [];
      for (let i=0;i<events.length;i++){
        const e = events[i];
        if (!blocks.length || blocks[blocks.length-1].pid !== e.pid) blocks.push({ pid: e.pid, start: e.time, end: e.time+1 });
        else blocks[blocks.length-1].end = e.time+1;
      }
      const schedule = blocks.map(b=>[b.start,b.end,b.pid]);
      if (typeof drawGanttAnimated === 'function' && schedule.length) drawGanttAnimated(schedule);
    }
    renderProcTable(); refreshSidebarTable();
  }

  /* ---------- small actions ---------- */
  function addProcess(a,b) { const id = nextId++; const p={id,pid:`P${id}`,arrival:Number(a),burst:Number(b),remaining:Number(b),color:randColor(id)}; processes.push(p); processes.sort((x,y)=>x.arrival - y.arrival || x.id - y.id); recompute(); }
  function removeById(id) { processes = processes.filter(p=>p.id !== id); recompute(); }

  function wire() {
    $("#mode").addEventListener("change", e=>{ mode = e.target.value; recompute(); });
    $("#goal").addEventListener("change", e=>{ goal = e.target.value; recompute(); });
    $("#predict").addEventListener("change", e=>{ enablePrediction = e.target.checked; recompute(); });
    $("#addProc").addEventListener("click", ()=>{ const a = Number($("#inArrival").value||0), b = Number($("#inBurst").value||1); addProcess(a,b); $("#inArrival").value=""; $("#inBurst").value=""; $("#inArrival").focus(); });
    $("#addSample").addEventListener("click", ()=>{ [{arrival:0,burst:5},{arrival:2,burst:3},{arrival:4,burst:1}].forEach(s=>addProcess(s.arrival,s.burst)); });
    $("#loadSimple").addEventListener("click", ()=>{ processes = [{ id:1, pid:"P1", arrival:0, burst:4, remaining:4, color:randColor(1) },{ id:2, pid:"P2", arrival:1, burst:3, remaining:3, color:randColor(2) },{ id:3, pid:"P3", arrival:2, burst:1, remaining:1, color:randColor(3) }]; nextId=4; recompute(); });
    $("#addRandom").addEventListener("click", ()=>{ for (let i=0;i<6;i++) addProcess(Math.floor(Math.random()*8), Math.floor(Math.random()*6)+1); });
    $("#stepBack").addEventListener("click", ()=>{ if (!metrics) return; tick = Math.max(0, tick-1); updateUI(); });
    $("#stepForward").addEventListener("click", ()=>{ if (!metrics) return; tick = Math.min(metrics.totalTime, tick+1); updateUI(); });
    $("#resetBtn").addEventListener("click", ()=>{ if (!metrics) return; tick = 0; updateUI(); const sp=$("#playSidebar"); if (sp) sp.innerText="Play"; });

    $("#playSidebar").addEventListener("click", ()=>{ const sp=$("#playSidebar"); if (!metrics) return; if (sp._int) { clearInterval(sp._int); sp._int=null; sp.innerText="Play"; } else { sp._int = setInterval(()=>{ tick++; if (tick>=metrics.totalTime) { clearInterval(sp._int); sp._int=null; sp.innerText="Play"; tick=metrics.totalTime; } updateUI(); }, 250); sp.innerText="Pause"; } });
  }

  function init() {
    document.addEventListener("click", (e)=> { if (e.target && e.target.matches && e.target.matches(".link")) { const id = Number(e.target.dataset?.id); if (id) removeById(id); }});
    wire(); recompute(); renderProcTable(); refreshSidebarTable(); const inp = $("#inArrival"); if (inp) inp.focus();
  }

  window.schedulerApp = { getState: ()=>({processes,metrics,events,tick}), recompute };
  init();
})();
