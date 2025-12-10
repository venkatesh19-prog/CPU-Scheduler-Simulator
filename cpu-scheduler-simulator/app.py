# app.py
from flask import Flask, request, jsonify, render_template
import os
from collections import deque

app = Flask(__name__, static_folder="static", template_folder="templates")


def _deepcopy_procs(procs):
    return [{ **p, "arrival": int(p["arrival"]), "burst": int(p["burst"]), "remaining": int(p.get("remaining", p["burst"])) } for p in procs]


def finalize(procs, events):
    """Compute completion times, TAT, WT and summary metrics given procs and events[] where events are {time, pid} (pid may be None)."""
    # completion time is last time index + 1 when pid seen
    completion = {}
    for ev in reversed(events):
        pid = ev["pid"]
        if pid is None: 
            continue
        if pid not in completion:
            completion[pid] = ev["time"] + 1

    metrics_arr = []
    for p in procs:
        pid = p["pid"]
        ct = completion.get(pid, 0)
        tat = ct - p["arrival"]
        wt = tat - p["burst"]
        metrics_arr.append({"pid": pid, "arrival": p["arrival"], "burst": p["burst"], "completion": ct, "tat": tat, "wt": wt})

    busy = sum(1 for e in events if e["pid"] is not None)
    total_time = max(1, len(events))
    # context switches: count transitions between different non-null pids (when pid changes and both are non-null)
    prev = None
    ctx = 0
    for e in events:
        if e["pid"] != prev and prev is not None and e["pid"] is not None:
            ctx += 1
        prev = e["pid"]

    summary = {
        "metrics": metrics_arr,
        "avgWaiting": sum(m["wt"] for m in metrics_arr)/max(1,len(metrics_arr)),
        "avgTurnaround": sum(m["tat"] for m in metrics_arr)/max(1,len(metrics_arr)),
        "throughput": len(metrics_arr) / total_time,
        "cpuUtil": (busy / total_time) * 100,
        "contextSwitches": ctx,
        "totalTime": total_time,
        "events": events
    }
    return summary


def simulate_fcfs(procs):
    procs = _deepcopy_procs(procs)
    procs.sort(key=lambda p: (p["arrival"], p["pid"]))
    events = []
    t = 0
    for p in procs:
        if t < p["arrival"]:
            # idle period
            for idle_t in range(t, p["arrival"]):
                events.append({"time": idle_t, "pid": None})
            t = p["arrival"]
        for i in range(p["burst"]):
            events.append({"time": t, "pid": p["pid"]})
            t += 1
    return finalize(procs, events)


def simulate_srtf(procs):
    # preemptive shortest remaining time first
    procs = _deepcopy_procs(procs)
    n = len(procs)
    events = []
    t = 0
    # use list of dicts for remaining
    while True:
        ready = [p for p in procs if p["arrival"] <= t and p["remaining"] > 0]
        if not ready:
            # if all finished, break
            if all(p["remaining"] == 0 for p in procs):
                break
            # otherwise idle until next arrival
            next_arrivals = [p["arrival"] for p in procs if p["remaining"] > 0 and p["arrival"] > t]
            if not next_arrivals:
                break
            next_t = min(next_arrivals)
            for idle_t in range(t, next_t):
                events.append({"time": idle_t, "pid": None})
            t = next_t
            continue
        # pick process with smallest remaining, tie by arrival then pid
        cur = min(ready, key=lambda p: (p["remaining"], p["arrival"], p["pid"]))
        # run for 1 time unit (preemptive)
        events.append({"time": t, "pid": cur["pid"]})
        cur["remaining"] -= 1
        t += 1
    return finalize(procs, events)


def simulate_rr(procs, quantum=2):
    procs = _deepcopy_procs(procs)
    procs.sort(key=lambda p: (p["arrival"], p["pid"]))
    events = []
    t = 0
    q = deque()
    i = 0
    rem = {p["pid"]: p["remaining"] for p in procs}
    while i < len(procs) or q:
        # enqueue newly arrived
        while i < len(procs) and procs[i]["arrival"] <= t:
            q.append(procs[i])
            i += 1
        if not q:
            if i < len(procs):
                nxt = procs[i]["arrival"]
                for idle_t in range(t, nxt):
                    events.append({"time": idle_t, "pid": None})
                t = nxt
                continue
            else:
                break
        cur = q.popleft()
        run = min(quantum, rem[cur["pid"]])
        for _ in range(run):
            events.append({"time": t, "pid": cur["pid"]})
            t += 1
            # enqueue any arrivals during run
            while i < len(procs) and procs[i]["arrival"] <= t:
                q.append(procs[i])
                i += 1
        rem[cur["pid"]] -= run
        if rem[cur["pid"]] > 0:
            q.append(cur)
    return finalize(procs, events)


def simulate_adaptive(procs, quantum=2):
    # simple adaptive: pick SRTF if burst variance high, else RR when many processes else FCFS
    stats = None
    if procs:
        bursts = [int(p["burst"]) for p in procs]
        avg = sum(bursts)/len(bursts)
        var = sum((b-avg)**2 for b in bursts)/len(bursts)
        std = var**0.5
        stats = {"avg": avg, "std": std, "n": len(bursts)}
    if stats:
        if stats["std"] / max(1, stats["avg"]) > 0.6:
            return simulate_srtf(procs)
        if stats["n"] > 6:
            return simulate_rr(procs, quantum)
    # default to FCFS
    return simulate_fcfs(procs)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/simulate", methods=["POST"])
def simulate():
    data = request.get_json(force=True)
    algorithm = (data.get("algorithm") or "ADAPTIVE").upper()
    quantum = int(data.get("quantum", 2))
    procs = data.get("processes", [])

    # validate input
    if not isinstance(procs, list):
        return jsonify({"error": "processes must be a list"}), 400
    # normalize pids if missing
    for idx, p in enumerate(procs, start=1):
        if "pid" not in p:
            p["pid"] = f"P{idx}"
        if "arrival" not in p:
            p["arrival"] = 0
        if "burst" not in p:
            p["burst"] = 1

    if algorithm == "FCFS":
        res = simulate_fcfs(procs)
    elif algorithm == "SRTF" or algorithm == "SJF":
        res = simulate_srtf(procs)
    elif algorithm == "RR":
        res = simulate_rr(procs, quantum)
    elif algorithm == "ADAPTIVE":
        res = simulate_adaptive(procs, quantum)
    else:
        return jsonify({"error": f"Unknown algorithm '{algorithm}'"}), 400

    # respond with events and metrics in shape frontend expects
    return jsonify({
        "events": res["events"],
        "metrics": {
            "avgWaiting": res["avgWaiting"],
            "avgTurnaround": res["avgTurnaround"],
            "cpuUtil": res["cpuUtil"],
            "throughput": res["throughput"],
            "contextSwitches": res["contextSwitches"],
            "totalTime": res["totalTime"],
            "processMetrics": res["metrics"]
        }
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
