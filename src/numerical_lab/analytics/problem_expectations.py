from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple


@dataclass
class AnalyticPoint:
    x: float
    value: float


def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _make_scalar_callable(expr: str) -> Callable[[float], float]:
    allowed_names = {
        name: getattr(math, name)
        for name in dir(math)
        if not name.startswith("_")
    }
    allowed_names["abs"] = abs

    def f(x: float) -> float:
        env = dict(allowed_names)
        env["x"] = x
        return eval(expr, {"__builtins__": {}}, env)

    return f


def _linspace(a: float, b: float, n: int) -> List[float]:
    if n <= 1:
        return [a]
    step = (b - a) / (n - 1)
    return [a + i * step for i in range(n)]


def _safe_eval_grid(
    f: Callable[[float], float],
    xs: Sequence[float],
) -> List[AnalyticPoint]:
    out: List[AnalyticPoint] = []
    for x in xs:
        try:
            y = f(float(x))
            if isinstance(y, complex):
                continue
            y = float(y)
            if math.isfinite(y):
                out.append(AnalyticPoint(x=float(x), value=y))
        except Exception:
            continue
    return out


def _sign(v: float, tol: float = 1e-12) -> int:
    if abs(v) <= tol:
        return 0
    return 1 if v > 0 else -1


def _detect_sign_change_intervals(
    points: Sequence[AnalyticPoint],
    tol: float = 1e-12,
) -> List[Tuple[float, float]]:
    intervals: List[Tuple[float, float]] = []
    if len(points) < 2:
        return intervals

    n = len(points)

    for i in range(n - 1):
        p0 = points[i]
        p1 = points[i + 1]
        s0 = _sign(p0.value, tol=tol)
        s1 = _sign(p1.value, tol=tol)

        # Standard strict sign change
        if s0 != 0 and s1 != 0 and s0 != s1:
            intervals.append((p0.x, p1.x))
            continue

        # Handle exact/near-exact root hits on the grid.
        # Only count as sign-change relevant if the nearest nonzero
        # sample on the left and right have opposite signs.
        if s0 == 0 or s1 == 0:
            left_sign = None
            right_sign = None

            # search left
            j = i
            while j >= 0:
                sj = _sign(points[j].value, tol=tol)
                if sj != 0:
                    left_sign = sj
                    break
                j -= 1

            # search right
            j = i + 1
            while j < n:
                sj = _sign(points[j].value, tol=tol)
                if sj != 0:
                    right_sign = sj
                    break
                j += 1

            if left_sign is not None and right_sign is not None and left_sign != right_sign:
                intervals.append((p0.x, p1.x))

    return intervals

def _cluster_intervals(
    intervals: Sequence[Tuple[float, float]],
    tol: float,
) -> List[Tuple[float, float]]:
    if not intervals:
        return []

    mids = sorted((0.5 * (a + b), (a, b)) for a, b in intervals)
    clusters: List[List[Tuple[float, float]]] = [[mids[0][1]]]
    last_mid = mids[0][0]

    for mid, interval in mids[1:]:
        if abs(mid - last_mid) <= tol:
            clusters[-1].append(interval)
        else:
            clusters.append([interval])
        last_mid = mid

    merged: List[Tuple[float, float]] = []
    for cluster in clusters:
        a = min(iv[0] for iv in cluster)
        b = max(iv[1] for iv in cluster)
        merged.append((a, b))

    return merged

def _detect_near_zero_points(
    points: Sequence[AnalyticPoint],
    threshold: float,
) -> List[float]:
    xs: List[float] = []
    for p in points:
        if abs(p.value) <= threshold:
            xs.append(p.x)
    return xs


def _cluster_points(xs: Sequence[float], tol: float) -> List[float]:
    xs_sorted = sorted(float(x) for x in xs)
    if not xs_sorted:
        return []

    clusters: List[List[float]] = [[xs_sorted[0]]]
    for x in xs_sorted[1:]:
        if abs(x - clusters[-1][-1]) <= tol:
            clusters[-1].append(x)
        else:
            clusters.append([x])

    return [sum(cluster) / len(cluster) for cluster in clusters]


def _detect_critical_points(
    df_points: Sequence[AnalyticPoint],
    tol: float = 1e-10,
    cluster_tol: float = 1e-2,
) -> List[float]:
    if len(df_points) < 2:
        return []

    candidates: List[float] = []

    # near-zero derivative values
    candidates.extend(_detect_near_zero_points(df_points, threshold=tol))

    # derivative sign changes
    for p0, p1 in zip(df_points[:-1], df_points[1:]):
        s0 = _sign(p0.value, tol=tol)
        s1 = _sign(p1.value, tol=tol)
        if s0 == 0 or s1 == 0:
            continue
        if s0 != s1:
            candidates.append(0.5 * (p0.x + p1.x))

    return _cluster_points(candidates, tol=cluster_tol)


def _estimate_root_candidates(
    f_points: Sequence[AnalyticPoint],
    tol: float = 1e-8,
    cluster_tol: float = 1e-2,
) -> List[float]:
    candidates: List[float] = []

    # direct near-zero hits
    candidates.extend(_detect_near_zero_points(f_points, threshold=tol))

    # sign-change midpoints
    for a, b in _detect_sign_change_intervals(f_points, tol=tol):
        candidates.append(0.5 * (a + b))

    return _cluster_points(candidates, tol=cluster_tol)


def _approx_symmetry(
    f: Callable[[float], float],
    a: float,
    b: float,
    n: int = 101,
    tol: float = 1e-6,
) -> Dict[str, Any]:
    # Only meaningful if interval is roughly symmetric about zero.
    if abs(a + b) > 1e-8:
        return {
            "interval_symmetric_about_zero": False,
            "symmetry_type": "none",
            "notes": ["Domain is not symmetric about zero, so even/odd symmetry check is limited."],
        }

    xs = _linspace(a, b, n)
    even_resid = []
    odd_resid = []

    for x in xs:
        try:
            fx = f(x)
            fnx = f(-x)
            if not (math.isfinite(fx) and math.isfinite(fnx)):
                continue
            even_resid.append(abs(fx - fnx))
            odd_resid.append(abs(fx + fnx))
        except Exception:
            continue

    if not even_resid or not odd_resid:
        return {
            "interval_symmetric_about_zero": True,
            "symmetry_type": "unknown",
            "notes": ["Could not evaluate symmetry reliably on the sampled grid."],
        }

    even_max = max(even_resid)
    odd_max = max(odd_resid)

    if even_max <= tol and even_max < odd_max:
        sym = "even"
    elif odd_max <= tol and odd_max < even_max:
        sym = "odd"
    else:
        sym = "none"

    notes = []
    if sym == "even":
        notes.append("Function appears approximately even on the sampled domain: f(x) ≈ f(-x).")
    elif sym == "odd":
        notes.append("Function appears approximately odd on the sampled domain: f(x) ≈ -f(-x).")
    else:
        notes.append("Function does not appear approximately even or odd on the sampled domain.")

    return {
        "interval_symmetric_about_zero": True,
        "symmetry_type": sym,
        "even_residual_max": even_max,
        "odd_residual_max": odd_max,
        "notes": notes,
    }


def _newton_pathology_scan(
    f_points: Sequence[AnalyticPoint],
    df_points: Sequence[AnalyticPoint],
    derivative_small_tol: float = 1e-8,
    jump_large_threshold: float = 10.0,
    cluster_tol: float = 1e-2,
) -> Dict[str, Any]:
    if not f_points or not df_points or len(f_points) != len(df_points):
        return {
            "available": False,
            "notes": ["Newton pathology scan unavailable because derivative samples are missing or misaligned."],
        }

    derivative_small_xs: List[float] = []
    jump_risk_xs: List[float] = []
    explicit_examples: List[Dict[str, float]] = []

    for fp, dfp in zip(f_points, df_points):
        if abs(dfp.value) <= derivative_small_tol:
            derivative_small_xs.append(fp.x)
            continue

        jump_factor = abs(fp.value / dfp.value)
        if jump_factor >= jump_large_threshold:
            jump_risk_xs.append(fp.x)
            if len(explicit_examples) < 8:
                explicit_examples.append(
                    {
                        "x": fp.x,
                        "f_x": fp.value,
                        "df_x": dfp.value,
                        "abs_f_over_df": jump_factor,
                    }
                )

    derivative_small_clusters = _cluster_points(derivative_small_xs, tol=cluster_tol)
    jump_risk_clusters = _cluster_points(jump_risk_xs, tol=cluster_tol)

    notes: List[str] = []
    if derivative_small_clusters:
        notes.append(
            "Derivative-based methods may be pathological near points where |f'(x)| is very small, because the Newton update x - f(x)/f'(x) becomes undefined or unstable."
        )
    if jump_risk_clusters:
        notes.append(
            "Large values of |f(x)/f'(x)| were detected on the sampled domain, indicating regions where Newton-type steps may become unusually large."
        )
    if not notes:
        notes.append(
            "No strong Newton-step pathology indicator was found on the sampled grid at the current thresholds."
        )

    return {
        "available": True,
        "derivative_small_tol": derivative_small_tol,
        "jump_large_threshold": jump_large_threshold,
        "derivative_small_points": derivative_small_clusters,
        "large_newton_jump_points": jump_risk_clusters,
        "explicit_jump_examples": explicit_examples,
        "notes": notes,
    }


def _bracket_method_expectations(
    root_candidates: Sequence[float],
    sign_change_intervals: Sequence[Tuple[float, float]],
) -> Dict[str, Any]:
    notes: List[str] = []

    if sign_change_intervals:
        notes.append(
            f"Detected {len(sign_change_intervals)} sign-change interval(s) on the sampled domain, so bracket methods should be able to target at least those roots associated with sign changes."
        )
    else:
        notes.append(
            "No sign-change intervals were detected on the sampled domain, so pure bracket methods may have no accessible targets under sign-change-based initialization."
        )

    if root_candidates and len(root_candidates) > len(sign_change_intervals):
        notes.append(
            "There appear to be more root candidates than sign-change intervals. This suggests that some roots may be invisible to sign-change-based bracket methods, for example near even-multiplicity roots."
        )

    return {
        "sign_change_interval_count": len(sign_change_intervals),
        "sign_change_intervals": [list(iv) for iv in sign_change_intervals],
        "notes": notes,
    }


def build_problem_expectations(
    *,
    expr: str,
    dexpr: Optional[str],
    scalar_range: Tuple[float, float],
    bracket_search_range: Optional[Tuple[float, float]] = None,
    methods: Optional[Sequence[str]] = None,
    sample_points: int = 801,
) -> Dict[str, Any]:
    methods = list(methods or [])
    a, b = float(scalar_range[0]), float(scalar_range[1])
    bracket_range = bracket_search_range if bracket_search_range is not None else scalar_range

    f = _make_scalar_callable(expr)
    df = _make_scalar_callable(dexpr) if dexpr else None

    xs = _linspace(a, b, sample_points)
    f_points = _safe_eval_grid(f, xs)

    df_points: List[AnalyticPoint] = []
    if df is not None:
        df_points = _safe_eval_grid(df, xs)

    domain_width = abs(b - a)
    cluster_tol = max(1e-3, 0.01 * domain_width)
    zero_threshold = 1e-6
    derivative_small_tol = 1e-8

    root_candidates = _estimate_root_candidates(
        f_points,
        tol=zero_threshold,
        cluster_tol=cluster_tol,
    )
    sign_change_intervals = _cluster_intervals(
        _detect_sign_change_intervals(f_points, tol=zero_threshold),
        tol=cluster_tol,
    )
    critical_points = _detect_critical_points(
        df_points,
        tol=derivative_small_tol,
        cluster_tol=cluster_tol,
    ) if df_points else []

    symmetry = _approx_symmetry(f, a, b)

    newton_scan = _newton_pathology_scan(
        f_points=f_points,
        df_points=df_points,
        derivative_small_tol=derivative_small_tol,
        jump_large_threshold=max(5.0, 0.5 * domain_width),
        cluster_tol=cluster_tol,
    ) if df_points else {
        "available": False,
        "notes": ["Newton pathology scan unavailable because no derivative expression was provided."],
    }

    bracket_expectations = _bracket_method_expectations(
        root_candidates=root_candidates,
        sign_change_intervals=sign_change_intervals,
    )

    problem_summary_notes: List[str] = []
    if root_candidates:
        problem_summary_notes.append(
            f"Approximate root candidate count on sampled domain: {len(root_candidates)}."
        )
    else:
        problem_summary_notes.append(
            "No clear root candidates were detected on the sampled domain at the current sampling resolution."
        )

    if critical_points:
        problem_summary_notes.append(
            f"Approximate critical point count from derivative sampling: {len(critical_points)}."
        )

    if symmetry.get("notes"):
        problem_summary_notes.extend(symmetry["notes"])

    method_expectations: Dict[str, Dict[str, Any]] = {}

    for method in methods:
        m = str(method).strip().lower()
        notes: List[str] = []
        explicit_checks: List[str] = []

        if m in {"newton", "safeguarded_newton", "hybrid"}:
            if df is None:
                notes.append(
                    "Derivative-based expectation analysis is limited because no derivative expression was provided."
                )
            else:
                notes.append(
                    "Derivative-based behavior should be interpreted using the Newton update x_{k+1} = x_k - f(x_k)/f'(x_k)."
                )
                if critical_points:
                    notes.append(
                        f"Approximate derivative-critical locations were detected near {critical_points}."
                    )
                if newton_scan.get("derivative_small_points"):
                    notes.append(
                        f"Small-derivative pathology candidates were detected near {newton_scan['derivative_small_points']}."
                    )
                if newton_scan.get("large_newton_jump_points"):
                    notes.append(
                        f"Large Newton-step indicators |f/f'| were detected near {newton_scan['large_newton_jump_points']}."
                    )

                for example in newton_scan.get("explicit_jump_examples", [])[:5]:
                    explicit_checks.append(
                        f"At x={example['x']:.6g}, f(x)={example['f_x']:.6g}, f'(x)={example['df_x']:.6g}, |f/f'|={example['abs_f_over_df']:.6g}."
                    )

        if m == "secant":
            notes.append(
                "Secant behavior may become unstable when successive function values are nearly equal, because the secant denominator f(x_n) - f(x_{n-1}) becomes small."
            )
            if critical_points:
                notes.append(
                    "Flat or low-slope regions inferred from derivative-critical locations may also create secant-slope instability."
                )

        if m in {"bisection", "brent", "hybrid", "safeguarded_newton"}:
            notes.extend(bracket_expectations["notes"])

        if not notes:
            notes.append("No method-specific analytic expectation was generated for this method.")

        method_expectations[m] = {
            "method": m,
            "notes": notes,
            "explicit_checks": explicit_checks,
        }

    section_expectations = {
        "problem_summary": {
            "notes": problem_summary_notes,
        },
        "basin_map": {
            "notes": [
                (
                    f"Multiple attractor regions may occur because approximately {len(root_candidates)} root candidate(s) were detected."
                    if root_candidates
                    else "A single dominant or failure-dominated basin is plausible because no clear multi-root structure was detected from sampled sign information."
                ),
                (
                    "Derivative-based methods may show sharper basin transitions near derivative-critical regions."
                    if critical_points
                    else "No derivative-critical region was identified from sampled derivative data."
                ),
            ],
        },
        "failure_diagnostics": {
            "notes": (
                newton_scan.get("notes", [])
                + bracket_expectations.get("notes", [])
            ),
        },
        "root_coverage": {
            "notes": [
                (
                    f"Open methods may access approximately {len(root_candidates)} candidate root region(s) on the sampled domain."
                    if root_candidates
                    else "Open-method root coverage is analytically unclear because no stable root candidates were sampled."
                ),
                (
                    f"Bracket methods have only {len(sign_change_intervals)} detected sign-change interval(s), so their accessible coverage may be structurally smaller than that of open methods."
                ),
            ],
        },
        "root_basin_statistics": {
            "notes": [
                (
                    "If one root lies in a wider monotonic attraction region, a dominant basin share is expected."
                ),
                (
                    "If the function were strongly symmetric on the domain, more balanced basin shares could be expected."
                    if symmetry.get("symmetry_type") in {"even", "odd"}
                    else "No strong global symmetry was detected, so strongly balanced basin shares are not guaranteed."
                ),
            ],
        },
    }

    return {
        "problem_summary": {
            "expr": expr,
            "dexpr_provided": dexpr is not None and str(dexpr).strip() != "",
            "scalar_range": [a, b],
            "bracket_search_range": [float(bracket_range[0]), float(bracket_range[1])],
            "sample_points": sample_points,
        },
        "analytic_checks": {
            "root_candidates": root_candidates,
            "root_candidate_count": len(root_candidates),
            "sign_change_intervals": [list(iv) for iv in sign_change_intervals],
            "sign_change_interval_count": len(sign_change_intervals),
            "critical_points": critical_points,
            "critical_point_count": len(critical_points),
            "symmetry": symmetry,
            "newton_pathology_scan": newton_scan,
        },
        "method_expectations": method_expectations,
        "section_expectations": section_expectations,
    }