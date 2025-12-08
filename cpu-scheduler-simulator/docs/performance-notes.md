# Performance Notes

## Metrics Explained
This document describes how CPU Scheduling metrics are calculated inside the project.

### 1. Waiting Time (WT)
WT = Turnaround Time - Burst Time

### 2. Turnaround Time (TAT)
TAT = Completion Time - Arrival Time

### 3. CPU Utilization
(Active CPU cycles / Total time) * 100

### 4. Throughput
Processes completed per unit time.

These metrics are automatically computed in `compute_metrics()` in `app.py`.
