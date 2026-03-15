from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Literal

import math
from dataclasses import asdict

from numerical_lab.core.base import SolverResult


ConvergenceClass = Literal[
    "unknown",
    "linear",
    "superlinear",
    "quadratic_or_better",
    "diverging",
    "stagnating",
]

Confidence = Literal["low","medium","high"]
@dataclass
class ConvergenceReport:
    observed_order: Optional[float]
    classification: ConvergenceClass
    notes: List[str]
    confidence:Confidence = "low"


def _safe_log(x: float) -> Optional[float]:
    if x is None or x <= 0 or math.isnan(x) or math.isinf(x):
        return None
    return math.log(x)


def estimate_observed_order(errors: List[Optional[float]]) -> Optional[float]:
    """
    Estimate observed order p from step errors:
        p ≈ log(e_{n+1}/e_n) / log(e_n/e_{n-1})
    Needs at least 3 positive errors.
    """
    vals = [e for e in errors if e is not None and e > 0]
    if len(vals) < 3:
        return None

    e_nm1, e_n, e_np1 = vals[-3], vals[-2], vals[-1]

    num = _safe_log(e_np1 / e_n)
    den = _safe_log(e_n / e_nm1)
    if num is None or den is None or den == 0:
        return None

    p = num / den
    if math.isnan(p) or math.isinf(p):
        return None
    return float(p)


def classify_convergence(result: SolverResult) -> ConvergenceReport:
    """
    Uses residual + step error history to classify convergence behavior.
    This is heuristic but pedagogically useful.
    """
    notes: List[str] = []

    # Basic status-based notes
    if result.status == "converged":
        notes.append("Solver reports convergence.")
    elif result.status == "derivative_zero":
        notes.append("Derivative near zero; Newton-type methods may fail. Try bisection or secant.")
    elif result.status == "bad_bracket":
        notes.append("Invalid bracket; ensure f(a) and f(b) have opposite signs.")
    elif result.status == "stagnation":
        notes.append("Stagnation detected; try a different initial guess or method.")
    elif result.status == "max_iter":
        notes.append("Max iterations hit; may need better initial guess or hybrid method.")
    elif result.status in ("nan_or_inf", "error"):
        notes.append("Numerical evaluation failed; check function domain and inputs.")

    # Analyze residual trend
    res = result.residual_history
    if len(res) >= 5:
        # crude divergence detection: last residual much larger than early residual median
        early = res[: max(2, len(res)//3)]
        late = res[-max(2, len(res)//3):]
        early_med = sorted(early)[len(early)//2]
        late_med = sorted(late)[len(late)//2]
        if late_med > 10 * early_med:
            return ConvergenceReport(
                observed_order=None,
                classification="diverging",
                notes=notes + ["Residuals increased significantly; likely diverging."],
            )
    

    # Estimate observed order from step errors
    p = estimate_observed_order(result.step_error_history)

    # Classification from p if available
    if p is None:
        # If converged but p missing, still useful
        if result.status == "converged":
            return ConvergenceReport(None, "unknown", notes + ["Insufficient data to estimate observed order."])
        # If not converged, unknown
        return ConvergenceReport(None, "unknown", notes)

    # Pedagogical buckets
    if p < 0.8:
        cls: ConvergenceClass = "unknown"
        notes.append(f"Observed order ≈ {p:.3f} (unusual/unstable estimate).")
    elif 0.8 <= p < 1.2:
        cls = "linear"
        notes.append(f"Observed order ≈ {p:.3f} (linear convergence).")
    elif 1.2 <= p < 1.7:
        cls = "superlinear"
        notes.append(f"Observed order ≈ {p:.3f} (superlinear convergence).")
    elif 1.7 <= p < 2.3:
        cls = "quadratic"
        notes.append(f"Observed order ≈ {p:.3f} (quadratic convergence).")
    else:
        cls = "super quadratic"
        notes.append(f"Observed order ≈ {p:.3f} (super quadratic or better convergence).")

    return ConvergenceReport(observed_order=p, classification=cls, notes=notes)