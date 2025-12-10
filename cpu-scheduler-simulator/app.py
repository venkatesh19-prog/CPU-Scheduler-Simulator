# app.py
from flask import Flask, request, jsonify, render_template
import os
from collections import deque
from typing import Any, Dict, List

app = Flask(__name__, static_folder="static", template_folder="templates")


def _deepcopy_procs(procs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Create a normalized shallow copy of the process list ensuring numeric fields
    are ints and 'remaining' defaults to burst if missing.
    """
    result: List[Dict[str, Any]] = []
    for p in procs:
        arrival = int(p.get("arrival", 0))
        burst = int(p.get("burst", 1))
        remaining = int(p.get("remaining", p.get("burst", 1)))
        item = {**p, "arrival": arrival, "burst": burst, "remaining": remaining}
        result.append(item)
    return result


def _compute_completion_times(events: List[Dict[str, Any]]) -> Dict[str, int]:
    """
    Compute completion time for each pid by scanning events in reverse and
    taking the last time the pid ran (+1 to represent completion instant).
    """
    completion: Dict[str, int] = {}
    for ev in reversed(events):
        pid = ev.get("pid")
        if pid is None:
            continue
        if pid not in completion:
            completion[pid] = ev["time"] + 1
    return completion


def _compute_context_switches(events: List[Dict[str, Any]]) -> int:
    """
    Compute number of context switches: transitions from one pid to another
    where both are not idle (None).
    """
    prev = None
    ctx = 0
    for e in events:
        pid = e.get("pid")
        if pid != prev and prev is not None and pid is not None:
            ctx += 1
        prev = pid
    return ctx


def finalize(procs: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Generate final metrics and return a structured summary for the schedule.
    """
    completion = _compute_completion_times(events)

    metrics_arr: List[Dict[str, Any]] = []
    for p in procs:
        pid = p["pid"]
        ct = completion.get(pid, 0)
        tat = ct - p["arrival"]
        wt = tat - p["burst"]
        metrics_arr.append(
            {
                "pid": pid,
                "arrival": p["arrival"],
                "burst": p["burst"],
                "completion": ct,
                "tat": tat,
                "wt": wt,
            }
        )

    busy = sum(1 for e in events if e.get("pid") is not None)
    total_time = max(1, len(events))
    context_switches = _compute_context_switches(events)

    avg_waiting = sum(m["wt"] for m in metrics_arr) / max(1, len(metrics_arr))
    avg_turnaround = sum(m["tat"] for m in metrics_arr) / max(1, len(metrics_arr))

    return {
        "metrics": metrics_arr,
        "avgWaiting": avg_waiting,
        "avgTurnaround": avg_turnaround,
        "throughput": len(metrics_arr) / total_time,
        "cpuUtil": (busy / total_time) * 100,
        "contextSwitches": context_switches,
        "totalTime": total_time,
        "events": events,
    }


def simulate_fcfs(procs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    First-Come-First-Served scheduling simulation.
    Returns the finalized schedule and metrics.
    """
    procs = _deepcopy_procs(procs)
    procs.sort(key=lambda p: (p["arrival"], p["pid"]))
    events: List[Dict[str, Any]] = []
    t = 0
    for p in procs:
        if t < p["arrival"]:
            # idle until arrival
            for idle_t in range(t, p["arrival"]):
                events.append({"time": idle_t, "pid": None})
            t = p["arrival"]
        for _ in range(p["burst"]):
            events.append({"time": t, "pid": p["pid"]})
            t += 1
    return finalize(procs, events)


def simulate_srtf(procs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Shortest Remaining Time First scheduling simulation (preemptive SJF).
    """
    procs = _deepcopy_procs(procs)
    events: List[Dict[str, Any]] = []
    t = 0

    while True:
        ready = [p for p in procs if p["arrival"] <= t and p["remaining"] > 0]
        if not ready:
            if all(p["remaining"] == 0 for p in procs):
                break
            next_arrivals = [p["arrival"] for p in procs if p["remaining"] > 0 and p["arrival"] > t]
            if not next_arrivals:
                break
            nxt = min(next_arrivals)
            for idle_t in range(t, nxt):
                events.append({"time": idle_t, "pid": None})
            t = nxt
            continue
        cur = min(ready, key=lambda p: (p["remaining"], p["arrival"], p["pid"]))
        events.append({"time": t, "pid": cur["pid"]})
        cur["remaining"] -= 1
        t += 1

    return finalize(procs, events)


def simulate_rr(procs: List[Dict[str, Any]], quantum: int = 2) -> Dict[str, Any]:
    """
    Round-Robin scheduling simulation with given quantum.
    """
    procs = _deepcopy_procs(procs)
    procs.sort(key=lambda p: (p["arrival"], p["pid"]))
    events: List[Dict[str, Any]] = []
    t = 0
    q = deque()
    i = 0
    rem = {p["pid"]: p["remaining"] for p in procs}

    while i < len(procs) or q:
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
            while i < len(procs) and procs[i]["arrival"] <= t:
                q.append(procs[i])
                i += 1

        rem[cur["pid"]] -= run
        if rem[cur["pid"]] > 0:
            q.append(cur)

    return finalize(procs, events)


def simulate_adaptive(procs: List[Dict[str, Any]], quantum: int = 2) -> Dict[str, Any]:
    """
    Adaptive selection between FCFS, SRTF and RR based on burst statistics.
    """
    if not procs:
        return simulate_fcfs(procs)

    bursts = [int(p["burst"]) for p in procs]
    avg = sum(bursts) / len(bursts)
    var = sum((b - avg) ** 2 for b in bursts) / len(bursts)
    std = var ** 0.5

    if std / max(1, avg) > 0.6:
        return simulate_srtf(procs)
    if len(bursts) > 6:
        return simulate_rr(procs, quantum)
    return simulate_fcfs(procs)


@app.route("/")
def index():
    """Render the main UI page."""
    return render_template("index.html")


@app.route("/simulate", methods=["POST"])
def simulate():
    """
    API endpoint for schedule simulation.
    Accepts JSON with keys: algorithm, quantum, processes.
    """
    data = request.get_json(force=True)
    algorithm = (data.get("algorithm") or "ADAPTIVE").upper()
    quantum = int(data.get("quantum", 2))
    procs = data.get("processes", [])

    if not isinstance(procs, list):
        return jsonify({"error": "processes must be a list"}), 400

    # normalize process fields and default pid if missing
    for idx, p in enumerate(procs, start=1):
        p.setdefault("pid", f"P{idx}")
        p.setdefault("arrival", 0)
        p.setdefault("burst", 1)

    if algorithm == "FCFS":
        res = simulate_fcfs(procs)
    elif algorithm in ("SRTF", "SJF"):
        res = simulate_srtf(procs)
    elif algorithm == "RR":
        res = simulate_rr(procs, quantum)
    elif algorithm == "ADAPTIVE":
        res = simulate_adaptive(procs, quantum)
    else:
        return jsonify({"error": f"Unknown algorithm '{algorithm}'"}), 400

    return jsonify(
        {
            "events": res["events"],
            "metrics": {
                "avgWaiting": res["avgWaiting"],
                "avgTurnaround": res["avgTurnaround"],
                "cpuUtil": res["cpuUtil"],
                "throughput": res["throughput"],
                "contextSwitches": res["contextSwitches"],
                "totalTime": res["totalTime"],
                "processMetrics": res["metrics"],
            },
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
