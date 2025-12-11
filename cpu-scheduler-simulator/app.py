from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing

# --- Models ---
class Process:
    def __init__(self, pid, arrival, burst, priority=1):
        self.pid = pid
        self.arrival = arrival
        self.burst = burst
        self.priority = priority
        self.remaining = burst
        self.start_time = -1
        self.completion_time = 0

    def to_dict(self):
        return {
            'pid': self.pid,
            'arrival': self.arrival,
            'burst': self.burst,
            'priority': self.priority,
            'remaining': self.remaining
        }

# --- Algorithm Implementations ---

def solve_fcfs(processes, context_switch=0):
    timeline = []
    decisions = []
    current_time = 0
    
    # Sort by arrival
    procs = sorted(processes, key=lambda p: p.arrival)
    last_pid = None
    
    for p in procs:
        # 1. Check for idle time
        if current_time < p.arrival:
            timeline.append({'pid': 'idle', 'start': current_time, 'end': p.arrival})
            decisions.append({
                'time': current_time,
                'chosenPid': 'idle',
                'candidates': [],
                'reason': 'No process arrived yet'
            })
            current_time = p.arrival

        # 2. Context Switch
        if last_pid is not None and last_pid != p.pid and context_switch > 0:
            timeline.append({'pid': 'context_switch', 'start': current_time, 'end': current_time + context_switch})
            current_time += context_switch
        
        # 3. Decision Log
        decisions.append({
            'time': current_time,
            'chosenPid': p.pid,
            'candidates': [x.to_dict() for x in procs if x.arrival <= current_time and x.remaining > 0],
            'reason': 'FCFS - Earliest Arrival'
        })
        
        # 4. Execute Process
        start = current_time
        if p.start_time == -1: p.start_time = start
        current_time += p.burst
        p.remaining = 0
        p.completion_time = current_time
        timeline.append({'pid': p.pid, 'start': start, 'end': current_time})
        last_pid = p.pid

    return timeline, decisions

def solve_sjf_np(processes, context_switch=0):
    timeline = []
    decisions = []
    current_time = 0
    completed = 0
    n = len(processes)
    last_pid = None
    
    while completed < n:
        # Find available processes
        available = [p for p in processes if p.arrival <= current_time and p.remaining > 0]
        
        if not available:
            # Move time to next arrival
            next_arrival = min([p.arrival for p in processes if p.remaining > 0])
            timeline.append({'pid': 'idle', 'start': current_time, 'end': next_arrival})
            current_time = next_arrival
            continue

        # SJF Logic: Min Burst, Tie-breaker Arrival
        candidate = min(available, key=lambda x: (x.burst, x.arrival))
        
        decisions.append({
            'time': current_time,
            'chosenPid': candidate.pid,
            'candidates': [x.to_dict() for x in available],
            'reason': 'SJF - Shortest Burst Time'
        })

        if last_pid is not None and last_pid != candidate.pid and context_switch > 0:
            timeline.append({'pid': 'context_switch', 'start': current_time, 'end': current_time + context_switch})
            current_time += context_switch

        start = current_time
        if candidate.start_time == -1: candidate.start_time = start
        
        # Non-preemptive: Run fully
        current_time += candidate.burst
        candidate.remaining = 0
        candidate.completion_time = current_time
        
        timeline.append({'pid': candidate.pid, 'start': start, 'end': current_time})
        last_pid = candidate.pid
        completed += 1

    return timeline, decisions

def solve_priority_np(processes, context_switch=0):
    timeline = []
    decisions = []
    current_time = 0
    completed = 0
    n = len(processes)
    last_pid = None
    
    while completed < n:
        available = [p for p in processes if p.arrival <= current_time and p.remaining > 0]
        
        if not available:
            next_arrival = min([p.arrival for p in processes if p.remaining > 0])
            timeline.append({'pid': 'idle', 'start': current_time, 'end': next_arrival})
            current_time = next_arrival
            continue

        # Priority Logic: Min Priority value (Lower # is higher priority)
        candidate = min(available, key=lambda x: (x.priority, x.arrival))

        decisions.append({
            'time': current_time,
            'chosenPid': candidate.pid,
            'candidates': [x.to_dict() for x in available],
            'reason': 'Priority - Lowest Priority Value'
        })

        if last_pid is not None and last_pid != candidate.pid and context_switch > 0:
            timeline.append({'pid': 'context_switch', 'start': current_time, 'end': current_time + context_switch})
            current_time += context_switch

        start = current_time
        if candidate.start_time == -1: candidate.start_time = start
        current_time += candidate.burst
        candidate.remaining = 0
        candidate.completion_time = current_time
        timeline.append({'pid': candidate.pid, 'start': start, 'end': current_time})
        last_pid = candidate.pid
        completed += 1

    return timeline, decisions

def solve_rr(processes, quantum, context_switch=0):
    timeline = []
    decisions = []
    current_time = 0
    completed = 0
    n = len(processes)
    last_pid = None
    
    # RR Queue Management
    procs_by_arrival = sorted(processes, key=lambda x: x.arrival)
    queue = []
    visited = [False] * n
    
    def check_arrivals(time):
        for i, p in enumerate(procs_by_arrival):
            if not visited[i] and p.arrival <= time:
                queue.append(p)
                visited[i] = True
    
    check_arrivals(current_time)
    
    while completed < n:
        if not queue:
            # Idle
            unvisited = [p for i, p in enumerate(procs_by_arrival) if not visited[i]]
            if unvisited:
                next_arr = unvisited[0].arrival
                timeline.append({'pid': 'idle', 'start': current_time, 'end': next_arr})
                current_time = next_arr
                check_arrivals(current_time)
                continue
            else:
                break 

        candidate = queue.pop(0)
        
        decisions.append({
            'time': current_time,
            'chosenPid': candidate.pid,
            'candidates': [x.to_dict() for x in queue + [candidate]],
            'reason': f'RR - Quantum {quantum}'
        })

        if last_pid is not None and last_pid != candidate.pid and context_switch > 0:
            timeline.append({'pid': 'context_switch', 'start': current_time, 'end': current_time + context_switch})
            current_time += context_switch
            
        start = current_time
        if candidate.start_time == -1: candidate.start_time = start
        
        # Execute for Quantum or Remaining
        exec_time = min(quantum, candidate.remaining)
        current_time += exec_time
        candidate.remaining -= exec_time
        
        timeline.append({'pid': candidate.pid, 'start': start, 'end': current_time})
        last_pid = candidate.pid
        
        # Important: Check arrivals before re-queueing current process
        check_arrivals(current_time)
        
        if candidate.remaining > 0:
            queue.append(candidate)
        else:
            candidate.completion_time = current_time
            completed += 1

    return timeline, decisions

# --- Routes ---

@app.route('/simulate', methods=['POST'])
def simulate():
    data = request.json
    algo = data.get('algorithm', 'FCFS')
    quantum = int(data.get('quantum', 2))
    cs = int(data.get('context_switch_ms', 0))
    raw_procs = data.get('processes', [])

    processes = [Process(p['pid'], p['arrival'], p['burst'], p.get('priority', 1)) for p in raw_procs]
    
    if algo == 'FCFS':
        timeline, decisions = solve_fcfs(processes, cs)
    elif algo == 'SJF':
        timeline, decisions = solve_sjf_np(processes, cs)
    elif algo == 'PRIORITY':
        timeline, decisions = solve_priority_np(processes, cs)
    elif algo == 'RR':
        timeline, decisions = solve_rr(processes, quantum, cs)
    else:
        return jsonify({'error': 'Unknown algorithm'}), 400

    metrics = {}
    total_wait = 0
    total_turn = 0
    
    for p in processes:
        p.turnaround_time = p.completion_time - p.arrival
        p.waiting_time = p.turnaround_time - p.burst
        total_wait += p.waiting_time
        total_turn += p.turnaround_time
        
        metrics[p.pid] = {
            'completion': p.completion_time,
            'turnaround': p.turnaround_time,
            'waiting': p.waiting_time,
            'response': p.start_time - p.arrival
        }

    total_duration = timeline[-1]['end'] if timeline else 0
    idle_time = sum([t['end'] - t['start'] for t in timeline if t['pid'] == 'idle'])
    busy_time = total_duration - idle_time
    util = (busy_time / total_duration * 100) if total_duration > 0 else 0

    response = {
        'timeline': timeline,
        'decisions': decisions,
        'per_process_metrics': metrics,
        'summary': {
            'avg_waiting': round(total_wait / len(processes), 2) if processes else 0,
            'avg_turnaround': round(total_turn / len(processes), 2) if processes else 0,
            'cpu_util': round(util, 2),
            'throughput': round(len(processes) / total_duration, 4) if total_duration else 0
        }
    }
    
    return jsonify(response)

if __name__ == '__main__':
    print("Scheduler Backend Running on http://127.0.0.1:5000")
    app.run(port=5000, debug=True)