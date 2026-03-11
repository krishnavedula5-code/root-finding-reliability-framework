Numerical Solver Reliability Framework

Basin-of-attraction analysis | Solver benchmarking | Convergence diagnostics

# Numerical Lab — Teaching-Oriented Root Finding

Numerical Lab is a pedagogical numerical solver designed for **numerical analysis education**.

Unlike black-box solvers, it provides:

- Transparent iteration behaviour
- Convergence diagnostics
- Stability flags
- JSON traces for visualization
- Auto-generated explanations
- Markdown reports

---

## Quick Start (PowerShell / Windows)

Activate environment:

'''powershell
.\venv\Scripts\Activate.ps1
pip install -e .

### To run the examples
Run the following command in the root directory of the terminal
.\examples\cubic.ps1
.\examples\cosx_minus_x.ps1
.\examples\exp_minus_3x.ps1

### Architecture of NUmerical Lab

Numerical Solver Research Platform

Architecture
------------
Frontend: React (Vercel)
Backend: FastAPI (Render)
Computation: Numerical Lab Engine

Workflow:
User → UI → API → Solver Engine → Results
