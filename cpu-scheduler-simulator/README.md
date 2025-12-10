# CPU Scheduler Simulator

**Intelligent CPU Scheduler** — a small educational app that simulates CPU scheduling algorithms and visualizes them with a responsive SVG Gantt chart.

**Features**
- Simulates FCFS, SRTF (SJF preemptive), Round Robin (RR) and an Adaptive mode.
- Local browser simulation (no server calls required).
- Play / Pause / Step controls, process add/remove, preset loader.
- Metrics: average waiting time, turnaround, CPU utilization, throughput, context switches.
- Clean responsive UI (Flask serves static files and template).

---

## Project structure

cpu-scheduler-simulator/
├─ app.py
├─ requirements.txt
├─ README.md
├─ templates/
│ └─ index.html
├─ static/
│ ├─ js/
│ │ └─ app.js
│ └─ css/
│ └─ style.css
└─ .gitignore

---

## Requirements

- Python 3.8+ (3.13 tested)
- pip

---

## Run locally (Windows PowerShell)

```powershell
# from project root
python -m venv venv
# activate
.\venv\Scripts\Activate.ps1
# install deps
pip install -r requirements.txt
# run dev server
python app.py
# open http://127.0.0.1:5000 in your browser
### Update: Documentation improved for clarity.
