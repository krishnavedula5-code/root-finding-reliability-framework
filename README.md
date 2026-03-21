# GRASP

**GRASP — Solver Reliability Analysis & Validation Framework**

Basin-of-attraction analysis | Solver benchmarking | Convergence diagnostics

---

## What is GRASP?

GRASP is a **research-grade numerical experimentation and validation framework** for analyzing the global behavior of root-finding algorithms.

Unlike traditional tools that evaluate a solver from a single initial guess, GRASP studies:

- Global convergence behavior  
- Basin-of-attraction structure  
- Statistical reliability (Monte Carlo)  
- Failure regions and instability patterns  
- Expected vs observed solver behavior  
- Automated validation of results  

GRASP is not just a solver.

It is a system for understanding:

> **Which solver to trust — and why**

---

## Key Capabilities

- Transparent iteration behavior  
- Convergence diagnostics  
- Stability flags  
- Root coverage analysis  
- JSON traces for visualization  
- Auto-generated interpretations  
- Validation layer for consistency and correctness  

---

## Quick Start (PowerShell / Windows)

Activate environment:

```powershell
.\venv\Scripts\Activate.ps1
pip install -e .