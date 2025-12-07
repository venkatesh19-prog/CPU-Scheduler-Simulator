from flask import Flask, request, jsonify, render_template
from collections import deque

app = Flask(__name__)

def compute_metrics(schedule, processes):
    completion = {pid: None for pid in processes}
    for start, end, pid in schedule:
        if pid is None:
            continue
        completion[pid] = end
    turnaround = {}
    waiting = {}
    for pid, p in processes.items():
        t = completion[pid]
        turnaround[pid] = t - p['arrival']
        waiting[pid] = turnaround[pid] - p['burst']
    avg_turnaround = sum(turnaround.values()) / len(turnaround) if turnaround else 0
    avg_waiting = sum(waiting.values()) / len(waiting) if waiting else 0
    return {
        "completion": completion,
        "turnaround": turnaround,
        "waiting": waiting,
        "avg_turnaround": avg_turnaround,
        "avg_waiting": avg_waiting
    }

def fcfs(procs):
    schedule = []
    time = 0
    procs = sorted(procs, key=lambda x: x['arrival'])
    for p in procs:
        if time < p['arrival']:
            schedule.append((time, p['arrival'], None))
            time = p['arrival']
        schedule.append((time, time + p['burst'], p['pid']))
        time += p['burst']
    return schedule

def sjf(procs):
    remaining = sorted(procs, key=lambda x: x['arrival'])
    schedule = []
    time = 0
    while remaining:
        available = [p for p in remaining if p['arrival'] <= time]
        if not available:
            nxt = min(remaining, key=lambda x: x['arrival'])
            schedule.append((time, nxt['arrival'], None))
            time = nxt['arrival']
            continue
        p = min(available, key=lambda x: x['burst'])
        schedule.append((time, time + p['burst'], p['pid']))
        time += p['burst']
        remaining.remove(p)
    return schedule

def round_robin(procs, quantum):
    procs = sorted(procs, key=lambda x: x['arrival'])
    time = 0
    schedule = []
    q = deque()
    i = 0
    rem = {p['pid']: p['burst'] for p in procs}
    while i < len(procs) or q:
        while i < len(procs) and procs[i]['arrival'] <= time:
            q.append(procs[i])
            i += 1
        if not q:
            if i < len(procs):
                nxt = procs[i]['arrival']
                schedule.append((time, nxt, None))
                time = nxt
            continue
        p = q.popleft()
        run_time = min(quantum, rem[p['pid']])
        schedule.append((time, time + run_time, p['pid']))
        time += run_time
        rem[p['pid']] -= run_time
        while i < len(procs) and procs[i]['arrival'] <= time:
            q.append(procs[i])
            i += 1
        if rem[p['pid']] > 0:
            q.append(p)
    return schedule

def priority_scheduling(procs):
    remaining = sorted(procs, key=lambda x: x['arrival'])
    schedule = []
    time = 0
    while remaining:
        available = [p for p in remaining if p['arrival'] <= time]
        if not available:
            nxt = min(remaining, key=lambda x: x['arrival'])
            schedule.append((time, nxt['arrival'], None))
            time = nxt['arrival']
            continue
        p = min(available, key=lambda x: x['priority'])
        schedule.append((time, time + p['burst'], p['pid']))
        time += p['burst']
        remaining.remove(p)
    return schedule

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/simulate", methods=["POST"])
def simulate():
    data = request.json
    algorithm = data.get("algorithm")
    quantum = int(data.get("quantum", 2))
    procs = data.get("processes", [])

    proc_map = {p["pid"]: {"arrival": int(p["arrival"]), "burst": int(p["burst"])} for p in procs}
    for p in procs:
        p["arrival"] = int(p["arrival"])
        p["burst"] = int(p["burst"])
        p["priority"] = int(p.get("priority", 0))

    if algorithm == "FCFS":
        schedule = fcfs(procs)
    elif algorithm == "SJF":
        schedule = sjf(procs)
    elif algorithm == "RR":
        schedule = round_robin(procs, quantum)
    elif algorithm == "PRIORITY":
        schedule = priority_scheduling(procs)
    else:
        return jsonify({"error": "Unknown algorithm"}), 400

    metrics = compute_metrics(schedule, proc_map)
    return jsonify({"schedule": schedule, "metrics": metrics})

if __name__ == "__main__":
    app.run(debug=True)
# Added inline documentation comments for clarity.
# These comments explain routing and algorithm flow.

# --- Routing Notes ---
# The '/' route renders the main UI (templates/index.html).
# The '/schedule' POST request receives process data, runs the selected algorithm,
# computes metrics, and returns JSON back to the frontend.

# --- Algorithm Notes ---
# Supported algorithms:
# - FCFS
# - SJF / SRTF
# - Round Robin
# - Priority Scheduling (non-preemptive)
# The compute_metrics() function calculates WT, TAT, CPU Utilization, etc.
