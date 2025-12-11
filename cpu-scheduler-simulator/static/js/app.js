/**
 * Project: Intelligent CPU Scheduler Simulator
 * Author: AI Assistant
 * Description: Frontend logic handling state, API communication, Gantt rendering,
 * playback animation, and user interactions.
 */

(function() {
    // --- Configuration & State ---
    const API_URL = 'http://127.0.0.1:5000/simulate';
    
    // Default Process Template
    const DEFAULT_PROCESS = { pid: 'P1', arrival: 0, burst: 1, priority: 1 };
    
    // Application State
    const state = {
        processes: [
            { pid: 'P1', arrival: 0, burst: 5, priority: 2 },
            { pid: 'P2', arrival: 2, burst: 3, priority: 1 },
            { pid: 'P3', arrival: 4, burst: 4, priority: 3 }
        ],
        config: {
            algorithm: 'FCFS',
            quantum: 2,
            contextSwitch: 0
        },
        simulation: null, // Holds result from backend
        playback: {
            isPlaying: false,
            currentTime: 0,
            speed: 1,
            totalDuration: 0,
            animationId: null,
            lastFrameTime: 0
        }
    };

    // Color Palette for Processes (CSS Vars would be ideal, using Hex for SVG)
    const COLORS = [
        '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#fbbf24', '#9ca3af'
    ];

    // --- DOM Elements ---
    const dom = {
        processList: document.getElementById('process-list'),
        btnAddProcess: document.getElementById('btn-add-process'),
        algoSelect: document.getElementById('algo-select'),
        quantumGroup: document.getElementById('group-quantum'),
        quantumInput: document.getElementById('quantum'),
        csInput: document.getElementById('context-switch'),
        btnRun: document.getElementById('btn-run'),
        btnReset: document.getElementById('btn-reset'),
        ganttSvg: document.getElementById('gantt-svg'),
        ganttWrapper: document.getElementById('gantt-wrapper'),
        timeCursor: document.getElementById('time-cursor'),
        currentTimeLabel: document.getElementById('current-time'),
        btnPlay: document.getElementById('btn-play-pause'),
        btnStepBack: document.getElementById('btn-step-back'),
        btnStepFwd: document.getElementById('btn-step-fwd'),
        speedSlider: document.getElementById('speed-slider'),
        speedLabel: document.getElementById('speed-label'),
        decisionLog: document.getElementById('decision-log'),
        metricsBody: document.getElementById('metrics-body'),
        avgWait: document.getElementById('avg-wait'),
        avgTurn: document.getElementById('avg-turn'),
        cpuUtil: document.getElementById('cpu-util'),
        tooltip: document.getElementById('tooltip'),
        btnExport: document.getElementById('btn-export'),
        fileImport: document.getElementById('file-import'),
        themeToggle: document.getElementById('theme-toggle')
    };

    // --- Initialization ---
    function init() {
        renderProcessList();
        setupEventListeners();
        toggleQuantumInput();
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        dom.btnAddProcess.addEventListener('click', addProcess);
        dom.algoSelect.addEventListener('change', (e) => {
            state.config.algorithm = e.target.value;
            toggleQuantumInput();
        });
        dom.btnRun.addEventListener('click', runSimulation);
        dom.btnReset.addEventListener('click', resetSimulation);
        
        // Playback
        dom.btnPlay.addEventListener('click', togglePlay);
        dom.btnStepBack.addEventListener('click', () => step(-1));
        dom.btnStepFwd.addEventListener('click', () => step(1));
        dom.speedSlider.addEventListener('input', (e) => {
            const vals = [0.25, 0.5, 1, 2, 4];
            state.playback.speed = vals[e.target.value - 1] || 1;
            dom.speedLabel.textContent = state.playback.speed + 'x';
        });

        // Export/Import
        dom.btnExport.addEventListener('click', exportData);
        dom.fileImport.addEventListener('change', importData);

        // Accessibility / Keyboard
        document.addEventListener('keydown', handleKeyboard);
        dom.themeToggle.addEventListener('click', () => document.body.classList.toggle('high-contrast'));

        // Input Changes
        dom.quantumInput.addEventListener('change', (e) => state.config.quantum = parseInt(e.target.value));
        dom.csInput.addEventListener('change', (e) => state.config.contextSwitch = parseInt(e.target.value));
    }

    function toggleQuantumInput() {
        dom.quantumGroup.style.display = state.config.algorithm === 'RR' ? 'block' : 'none';
    }

    // --- Process Management ---
    function renderProcessList() {
        dom.processList.innerHTML = '';
        state.processes.forEach((proc, index) => {
            const row = document.createElement('div');
            row.className = 'process-item';
            row.innerHTML = `
                <span style="background:${COLORS[index % COLORS.length]}; width:12px; height:12px; display:inline-block; border-radius:50%;"></span>
                <input type="text" value="${proc.pid}" data-idx="${index}" data-field="pid" aria-label="Process ID">
                <input type="number" value="${proc.arrival}" min="0" data-idx="${index}" data-field="arrival" placeholder="Arr" aria-label="Arrival Time">
                <input type="number" value="${proc.burst}" min="1" data-idx="${index}" data-field="burst" placeholder="Burst" aria-label="Burst Time">
                <input type="number" value="${proc.priority}" min="1" data-idx="${index}" data-field="priority" placeholder="Pri" aria-label="Priority">
                <button class="btn-danger btn-sm" onclick="removeProcess(${index})">×</button>
            `;
            // Attach individual listeners to inputs for real-time state update
            row.querySelectorAll('input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const field = e.target.dataset.field;
                    const idx = e.target.dataset.idx;
                    let val = e.target.value;
                    if(field !== 'pid') val = parseInt(val) || 0;
                    state.processes[idx][field] = val;
                });
            });
            dom.processList.appendChild(row);
        });
    }

    function addProcess() {
        const id = state.processes.length + 1;
        state.processes.push({ ...DEFAULT_PROCESS, pid: 'P' + id });
        renderProcessList();
    }

    // Exposed to global scope for inline onclick (simple pattern)
    window.removeProcess = function(index) {
        state.processes.splice(index, 1);
        renderProcessList();
    };

    // --- Simulation Logic ---
    async function runSimulation() {
        // Validate
        if (state.processes.length === 0) return alert("Add at least one process.");

        const payload = {
            algorithm: state.config.algorithm,
            preemptive: false, // Backend requirement specified NP for SJF/Priority
            quantum: state.config.quantum,
            context_switch_ms: state.config.contextSwitch,
            processes: state.processes
        };

        dom.btnRun.textContent = "Simulating...";
        dom.btnRun.disabled = true;

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if(!response.ok) throw new Error("Simulation failed");

            const data = await response.json();
            state.simulation = data;
            
            // Setup Visualization
            setupVisualizer(data);
            
        } catch (error) {
            console.error(error);
            alert("Error connecting to scheduler service. Ensure scheduler.py is running.");
        } finally {
            dom.btnRun.textContent = "Simulate";
            dom.btnRun.disabled = false;
        }
    }

    function setupVisualizer(data) {
        // Reset playback
        state.playback.currentTime = 0;
        state.playback.isPlaying = false;
        
        // Calculate max time
        const timeline = data.timeline;
        state.playback.totalDuration = timeline.length > 0 ? timeline[timeline.length - 1].end : 0;

        renderGanttStatic(timeline);
        renderMetrics(data);
        updateUIForTime(0);
    }

    // --- Visualizer: Gantt & Playback ---
    function renderGanttStatic(timeline) {
        const SCALE = 40; // px per ms
        const HEIGHT = 60;
        const totalWidth = state.playback.totalDuration * SCALE + 50; // Buffer

        dom.ganttSvg.innerHTML = ''; // Clear
        dom.ganttSvg.setAttribute('width', totalWidth);
        
        // Draw Grid and Blocks
        timeline.forEach(block => {
            const width = (block.end - block.start) * SCALE;
            const x = block.start * SCALE;
            
            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute('x', x);
            rect.setAttribute('y', 20);
            rect.setAttribute('width', width);
            rect.setAttribute('height', HEIGHT);
            rect.setAttribute('rx', 4);
            rect.classList.add('process-rect');
            
            // Color logic
            if (block.pid === 'idle') {
                rect.setAttribute('fill', '#e2e8f0');
                rect.setAttribute('stroke-dasharray', '4');
            } else if (block.pid === 'context_switch') {
                rect.setAttribute('fill', '#94a3b8');
                rect.classList.add('idle-rect');
            } else {
                // Find process index for color
                const idx = state.processes.findIndex(p => p.pid === block.pid);
                const color = COLORS[idx % COLORS.length] || '#ccc';
                rect.setAttribute('fill', color);
            }

            // Events for Tooltip
            rect.addEventListener('mouseenter', (e) => showTooltip(e, block));
            rect.addEventListener('mouseleave', hideTooltip);

            // Label
            if (width > 20 && block.pid !== 'idle' && block.pid !== 'context_switch') {
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute('x', x + width/2);
                text.setAttribute('y', 20 + HEIGHT/2 + 5);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('fill', 'white');
                text.setAttribute('font-size', '12px');
                text.setAttribute('font-weight', 'bold');
                text.setAttribute('pointer-events', 'none');
                text.textContent = block.pid;
                g.appendChild(text);
            }

            g.appendChild(rect);
            dom.ganttSvg.appendChild(g);
        });

        // Time Axis Labels
        for (let i = 0; i <= state.playback.totalDuration; i++) {
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute('x', i * SCALE);
            text.setAttribute('y', 110);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-size', '10px');
            text.setAttribute('fill', '#64748b');
            text.textContent = i;
            dom.ganttSvg.appendChild(text);
        }
    }

    // --- Animation Loop ---
    function togglePlay() {
        if(!state.simulation) return;
        state.playback.isPlaying = !state.playback.isPlaying;
        dom.btnPlay.textContent = state.playback.isPlaying ? '⏸' : '▶';
        
        if (state.playback.isPlaying) {
            state.playback.lastFrameTime = performance.now();
            requestAnimationFrame(animate);
        }
    }

    function animate(timestamp) {
        if (!state.playback.isPlaying) return;

        const delta = (timestamp - state.playback.lastFrameTime) / 1000; // sec
        state.playback.lastFrameTime = timestamp;

        // Advance time
        state.playback.currentTime += delta * state.playback.speed;
        
        if (state.playback.currentTime >= state.playback.totalDuration) {
            state.playback.currentTime = state.playback.totalDuration;
            togglePlay(); // Stop at end
        }

        updateUIForTime(state.playback.currentTime);
        requestAnimationFrame(animate);
    }

    function step(dir) {
        if(!state.simulation) return;
        state.playback.isPlaying = false;
        dom.btnPlay.textContent = '▶';
        
        let newTime = Math.round(state.playback.currentTime) + dir;
        if (newTime < 0) newTime = 0;
        if (newTime > state.playback.totalDuration) newTime = state.playback.totalDuration;
        
        state.playback.currentTime = newTime;
        updateUIForTime(newTime);
    }

    function updateUIForTime(time) {
        const SCALE = 40;
        // Move Cursor
        dom.timeCursor.style.transform = `translateX(${time * SCALE}px)`;
        dom.currentTimeLabel.textContent = time.toFixed(1);
        
        // Scroll if cursor goes out of view
        const cursorX = time * SCALE;
        const wrapperWidth = dom.ganttWrapper.clientWidth;
        if (cursorX > dom.ganttWrapper.scrollLeft + wrapperWidth - 50) {
            dom.ganttWrapper.scrollLeft = cursorX - 50;
        }

        // Update Decision Log
        updateDecisionLog(time);
    }

    function updateDecisionLog(time) {
        if (!state.simulation || !state.simulation.decisions) return;
        
        const floorTime = Math.floor(time);
        // Find decision at or immediately preceding current time
        const decision = state.simulation.decisions.find(d => d.time === floorTime) 
                      || state.simulation.decisions.filter(d => d.time < time).pop();

        if (decision) {
            dom.decisionLog.innerHTML = '';
            const entry = document.createElement('div');
            entry.className = 'decision-entry active';
            
            let candidatesHTML = '';
            if(decision.candidates && decision.candidates.length) {
                candidatesHTML = decision.candidates.map(c => 
                    `<span class="badge" style="background:#e2e8f0; color:#333; padding:2px 4px; border-radius:3px; margin-right:4px;">${c.pid}(Bur:${c.burst})</span>`
                ).join('');
            } else {
                candidatesHTML = 'None';
            }

            entry.innerHTML = `
                <div class="decision-time">Time: ${decision.time}</div>
                <div class="decision-reason">Chosen: <strong>${decision.chosenPid}</strong></div>
                <div class="decision-reason">Reason: ${decision.reason}</div>
                <div class="decision-candidates">Candidates: ${candidatesHTML}</div>
            `;
            dom.decisionLog.appendChild(entry);
        }
    }

    // --- Metrics & Helpers ---
    function renderMetrics(data) {
        dom.metricsBody.innerHTML = '';
        const m = data.per_process_metrics;
        for (const [pid, val] of Object.entries(m)) {
            const row = `<tr>
                <td>${pid}</td>
                <td>${val.waiting}</td>
                <td>${val.turnaround}</td>
                <td>${val.completion}</td>
            </tr>`;
            dom.metricsBody.innerHTML += row;
        }
        
        dom.avgWait.textContent = data.summary.avg_waiting;
        dom.avgTurn.textContent = data.summary.avg_turnaround;
        dom.cpuUtil.textContent = data.summary.cpu_util + '%';
    }

    function showTooltip(e, block) {
        dom.tooltip.innerHTML = `
            <strong>${block.pid}</strong><br>
            Start: ${block.start}<br>
            End: ${block.end}<br>
            Dur: ${block.end - block.start}
        `;
        dom.tooltip.style.left = e.pageX + 10 + 'px';
        dom.tooltip.style.top = e.pageY + 10 + 'px';
        dom.tooltip.classList.remove('hidden');
    }

    function hideTooltip() {
        dom.tooltip.classList.add('hidden');
    }

    function handleKeyboard(e) {
        if (e.target.tagName === 'INPUT') return;
        if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
        if (e.code === 'ArrowRight') step(1);
        if (e.code === 'ArrowLeft') step(-1);
    }

    function resetSimulation() {
        state.playback.isPlaying = false;
        state.playback.currentTime = 0;
        dom.ganttSvg.innerHTML = '';
        dom.decisionLog.innerHTML = '<div class="empty-state">Run simulation to see decisions.</div>';
        dom.metricsBody.innerHTML = '';
        dom.avgWait.textContent = '-';
        dom.avgTurn.textContent = '-';
        dom.cpuUtil.textContent = '-';
        state.simulation = null;
    }

    // --- Import / Export ---
    function exportData() {
        const data = {
            processes: state.processes,
            config: state.config,
            simulation: state.simulation
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cpu_sim_scenario.json';
        a.click();
    }

    function importData(e) {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if(data.processes) state.processes = data.processes;
                if(data.config) state.config = data.config;
                
                // Update UI
                renderProcessList();
                dom.algoSelect.value = state.config.algorithm;
                dom.quantumInput.value = state.config.quantum;
                dom.csInput.value = state.config.contextSwitch;
                toggleQuantumInput();
                
                if(data.simulation) {
                    state.simulation = data.simulation;
                    setupVisualizer(data.simulation);
                }
            } catch(err) {
                alert("Invalid JSON file");
            }
        };
        reader.readAsText(file);
    }

    // Start
    init();

})();