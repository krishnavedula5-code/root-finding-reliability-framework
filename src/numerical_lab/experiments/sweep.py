from __future__ import annotations

import csv
import json
import math
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from numerical_lab.expr.safe_eval import compile_expr
from numerical_lab.methods.bisection import BisectionSolver
from numerical_lab.methods.hybrid import HybridBisectionNewtonSolver
from numerical_lab.methods.newton import NewtonSolver
from numerical_lab.methods.safeguarded_newton import SafeguardedNewtonSolver
from numerical_lab.methods.secant import SecantSolver
from numerical_lab.experiments.discover_roots import RootCluster, discover_roots
from numerical_lab.analytics.sweep_analytics import generate_sweep_analytics


# -----------------------------
# Problem specification
# -----------------------------


@dataclass
class SweepProblem:
    problem_id: str
    expr: str
    dexpr: Optional[str]
    scalar_range: Tuple[float, float]
    secant_range: Tuple[float, float]
    bracket_search_range: Tuple[float, float]
    known_roots: Optional[List[float]] = None


# -----------------------------
# Flat run result
# -----------------------------


@dataclass
class SweepRunRecord:
    problem_id: str
    method: str
    run_index: int

    x0: Optional[float] = None
    x1: Optional[float] = None
    a: Optional[float] = None
    b: Optional[float] = None

    status: Optional[str] = None
    stop_reason: Optional[str] = None
    iterations: Optional[int] = None
    root: Optional[float] = None
    root_id: Optional[int] = None
    abs_f_final: Optional[float] = None

    convergence_label: Optional[str] = None
    stability_label: Optional[str] = None

    event_count: int = 0
    event_types: Optional[List[str]] = None

    has_derivative_zero: bool = False
    has_stagnation: bool = False
    has_nonfinite: bool = False
    has_bad_bracket: bool = False

    error_message: Optional[str] = None


# -----------------------------
# Supported methods
# -----------------------------


SUPPORTED_METHODS = {
    "newton",
    "secant",
    "bisection",
    "hybrid",
    "safeguarded_newton",
}


# -----------------------------
# Utilities
# -----------------------------


def linspace(a: float, b: float, n: int) -> List[float]:
    if n <= 1:
        return [float(a)]
    step = (b - a) / (n - 1)
    return [a + i * step for i in range(n)]


def safe_float(x: Any) -> Optional[float]:
    try:
        y = float(x)
        if math.isfinite(y):
            return y
        return None
    except Exception:
        return None


def normalize_methods(methods: Optional[Sequence[str]]) -> List[str]:
    if not methods:
        return ["newton", "secant", "bisection", "hybrid", "safeguarded_newton"]

    out: List[str] = []
    seen = set()

    for m in methods:
        name = str(m).strip()
        if name in SUPPORTED_METHODS and name not in seen:
            seen.add(name)
            out.append(name)

    return out


def parse_range_like(
    value: Any,
    *,
    fallback_min: float,
    fallback_max: float,
) -> Tuple[float, float]:
    """
    Accepts:
    - tuple/list: [xmin, xmax]
    - dict: {"x_min": ..., "x_max": ...}
    - None -> fallback
    """
    if value is None:
        return float(fallback_min), float(fallback_max)

    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return float(value[0]), float(value[1])

    if isinstance(value, dict):
        x_min = value.get("x_min", fallback_min)
        x_max = value.get("x_max", fallback_max)
        return float(x_min), float(x_max)

    return float(fallback_min), float(fallback_max)


def extract_events(result: Any) -> List[dict]:
    events = getattr(result, "events", None)
    if events is None:
        return []
    if isinstance(events, list):
        return events
    return []


def extract_iterations(result: Any) -> Optional[int]:
    val = getattr(result, "iterations", None)
    if val is not None:
        try:
            return int(val)
        except Exception:
            pass

    trace = getattr(result, "trace", None)
    if isinstance(trace, list):
        return len(trace)

    history = getattr(result, "history", None)
    if isinstance(history, list):
        return len(history)

    return None


def extract_root(result: Any) -> Optional[float]:
    for field in ("root", "x", "x_star"):
        if hasattr(result, field):
            return safe_float(getattr(result, field))
    return None


def extract_abs_f_final(result: Any) -> Optional[float]:
    best_fx = getattr(result, "best_fx", None)
    if best_fx is not None:
        val = safe_float(best_fx)
        if val is not None:
            return abs(val)

    records = getattr(result, "records", None)
    if isinstance(records, list) and records:
        last = records[-1]

        residual = getattr(last, "residual", None)
        if residual is not None:
            val = safe_float(residual)
            if val is not None:
                return abs(val)

        fx = getattr(last, "fx", None)
        if fx is not None:
            val = safe_float(fx)
            if val is not None:
                return abs(val)

    for field in ("abs_f_final", "final_abs_f", "residual", "fx"):
        if hasattr(result, field):
            val = safe_float(getattr(result, field))
            if val is not None:
                return abs(val)

    return None


def extract_status(result: Any) -> Optional[str]:
    val = getattr(result, "status", None)
    return str(val) if val is not None else None


def extract_stop_reason(result: Any) -> Optional[str]:
    val = getattr(result, "stop_reason", None)
    return str(val) if val is not None else None


def extract_label(result: Any, name: str) -> Optional[str]:
    val = getattr(result, name, None)
    return str(val) if val is not None else None


def event_flags(events: Sequence[dict]) -> Dict[str, bool]:
    names = []
    for e in events:
        if isinstance(e, dict):
            t = e.get("type")
            if t is not None:
                names.append(str(t))

    name_set = set(names)
    return {
        "has_derivative_zero": "DERIVATIVE_ZERO" in name_set,
        "has_stagnation": "STAGNATION" in name_set,
        "has_nonfinite": "NONFINITE" in name_set,
        "has_bad_bracket": "BAD_BRACKET" in name_set,
    }


def event_type_list(events: Sequence[dict]) -> List[str]:
    out: List[str] = []
    for e in events:
        if isinstance(e, dict):
            t = e.get("type")
            if t is not None:
                out.append(str(t))
    return sorted(set(out))


def maybe_match_known_root(
    root: Optional[float],
    known_roots: Optional[List[float]],
    tol: float = 1e-6,
) -> Optional[float]:
    if root is None or not known_roots:
        return None
    for r in known_roots:
        if abs(root - r) <= tol:
            return float(r)
    return None


def assign_root_id(
    root: Optional[float],
    clusters: Optional[List[RootCluster]],
    tol: float = 1e-4,
) -> Optional[int]:
    if root is None or not clusters:
        return None

    best_cluster = None
    best_dist = None

    for c in clusters:
        d = abs(root - c.center)
        if best_dist is None or d < best_dist:
            best_dist = d
            best_cluster = c

    if best_cluster is None:
        return None

    if best_dist is not None and best_dist <= tol:
        return int(best_cluster.root_id)

    return None


def create_sweep_folder(base: str | Path = "outputs/sweeps") -> Tuple[str, Path]:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    sweep_id = f"sweep_{ts}"

    path = Path(base) / sweep_id
    path.mkdir(parents=True, exist_ok=True)

    return sweep_id, path


# -----------------------------
# Benchmark definitions
# -----------------------------


DEFAULT_PROBLEMS: List[SweepProblem] = [
    SweepProblem(
        problem_id="p1",
        expr="x**3 - 2*x + 2",
        dexpr="3*x**2 - 2",
        scalar_range=(-4.0, 4.0),
        secant_range=(-4.0, 4.0),
        bracket_search_range=(-4.0, 4.0),
    ),
    SweepProblem(
        problem_id="p2",
        expr="x**3 - x - 2",
        dexpr="3*x**2 - 1",
        scalar_range=(-4.0, 4.0),
        secant_range=(-4.0, 4.0),
        bracket_search_range=(-4.0, 4.0),
    ),
    SweepProblem(
        problem_id="p3",
        expr="cos(x) - x",
        dexpr="-sin(x) - 1",
        scalar_range=(-4.0, 4.0),
        secant_range=(-4.0, 4.0),
        bracket_search_range=(-4.0, 4.0),
    ),
    SweepProblem(
        problem_id="p4",
        expr="(x-1)**2 * (x+2)",
        dexpr="2*(x-1)*(x+2) + (x-1)**2",
        scalar_range=(-4.0, 4.0),
        secant_range=(-4.0, 4.0),
        bracket_search_range=(-4.0, 4.0),
    ),
]


DEFAULT_PROBLEM_MAP: Dict[str, SweepProblem] = {
    p.problem_id: p for p in DEFAULT_PROBLEMS
}


def get_default_problem(problem_id: Optional[str]) -> SweepProblem:
    pid = str(problem_id or "p4").strip()
    if pid not in DEFAULT_PROBLEM_MAP:
        raise ValueError(f"Unknown benchmark problem_id: {pid}")
    return DEFAULT_PROBLEM_MAP[pid]


def build_custom_problem(
    *,
    expr: str,
    dexpr: Optional[str],
    x_min: Optional[float] = None,
    x_max: Optional[float] = None,
    scalar_range: Any = None,
    secant_range: Any = None,
    bracket_search_range: Any = None,
    problem_id: str = "custom",
) -> SweepProblem:
    expr_clean = str(expr or "").strip()
    dexpr_clean = str(dexpr).strip() if dexpr is not None and str(dexpr).strip() else None

    if not expr_clean:
        raise ValueError("Custom problem requires expr.")

    fallback_min = float(-4.0 if x_min is None else x_min)
    fallback_max = float(4.0 if x_max is None else x_max)

    scalar_rng = parse_range_like(
        scalar_range,
        fallback_min=fallback_min,
        fallback_max=fallback_max,
    )
    secant_rng = parse_range_like(
        secant_range,
        fallback_min=scalar_rng[0],
        fallback_max=scalar_rng[1],
    )
    bracket_rng = parse_range_like(
        bracket_search_range,
        fallback_min=scalar_rng[0],
        fallback_max=scalar_rng[1],
    )

    if scalar_rng[0] >= scalar_rng[1]:
        raise ValueError("Custom scalar range must satisfy x_min < x_max.")

    if secant_rng[0] >= secant_rng[1]:
        raise ValueError("Custom secant range must satisfy x_min < x_max.")

    if bracket_rng[0] >= bracket_rng[1]:
        raise ValueError("Custom bracket search range must satisfy x_min < x_max.")

    return SweepProblem(
        problem_id=problem_id,
        expr=expr_clean,
        dexpr=dexpr_clean,
        scalar_range=scalar_rng,
        secant_range=secant_rng,
        bracket_search_range=bracket_rng,
    )


# -----------------------------
# Bracket generation
# -----------------------------


def find_sign_change_brackets(
    f: Callable[[float], float],
    x_min: float,
    x_max: float,
    grid_size: int = 2000,
    max_brackets: int = 1000,
) -> List[Tuple[float, float]]:
    xs = linspace(x_min, x_max, grid_size)
    brackets: List[Tuple[float, float]] = []

    window_sizes = [2, 3, 5, 9, 17, 33]
    seen = set()

    for w in window_sizes:
        for i in range(0, len(xs) - w):
            a = xs[i]
            b = xs[i + w]

            try:
                fa = f(a)
                fb = f(b)
            except Exception:
                continue

            if not (math.isfinite(fa) and math.isfinite(fb)):
                continue

            if fa == 0.0 or fb == 0.0 or fa * fb < 0.0:
                key = (round(a, 12), round(b, 12))
                if key not in seen:
                    seen.add(key)
                    brackets.append((a, b))

            if len(brackets) >= max_brackets:
                return brackets

    return brackets


# -----------------------------
# Solver runners
# -----------------------------


def run_newton(
    f: Callable[[float], float],
    df: Callable[[float], float],
    x0: float,
    tol: float,
    max_iter: int,
) -> Any:
    solver = NewtonSolver(f=f, df=df, x0=x0, tol=tol, max_iter=max_iter)
    return solver.solve()


def run_safeguarded_newton(
    f: Callable[[float], float],
    df: Callable[[float], float],
    x0: float,
    a: float,
    b: float,
    tol: float,
    max_iter: int,
) -> Any:
    solver = SafeguardedNewtonSolver(
        f=f, df=df, x0=x0, a=a, b=b, tol=tol, max_iter=max_iter
    )
    return solver.solve()


def run_secant(
    f: Callable[[float], float],
    x0: float,
    x1: float,
    tol: float,
    max_iter: int,
) -> Any:
    solver = SecantSolver(f=f, x0=x0, x1=x1, tol=tol, max_iter=max_iter)
    return solver.solve()


def run_bisection(
    f: Callable[[float], float],
    a: float,
    b: float,
    tol: float,
    max_iter: int,
) -> Any:
    solver = BisectionSolver(f=f, a=a, b=b, tol=tol, max_iter=max_iter)
    return solver.solve()


def run_hybrid(
    f: Callable[[float], float],
    df: Callable[[float], float],
    a: float,
    b: float,
    tol: float,
    max_iter: int,
) -> Any:
    solver = HybridBisectionNewtonSolver(
        f=f, df=df, a=a, b=b, tol=tol, max_iter=max_iter
    )
    return solver.solve()


# -----------------------------
# Record conversion
# -----------------------------


def result_to_record(
    problem: SweepProblem,
    method: str,
    run_index: int,
    result: Any,
    *,
    x0: Optional[float] = None,
    x1: Optional[float] = None,
    a: Optional[float] = None,
    b: Optional[float] = None,
    error_message: Optional[str] = None,
    clusters: Optional[List[RootCluster]] = None,
) -> SweepRunRecord:
    events = extract_events(result) if result is not None else []
    flags = event_flags(events)
    root_value = extract_root(result) if result is not None else None
    assigned_root_id = assign_root_id(root_value, clusters)

    return SweepRunRecord(
        problem_id=problem.problem_id,
        method=method,
        run_index=run_index,
        x0=x0,
        x1=x1,
        a=a,
        b=b,
        status=extract_status(result) if result is not None else "error",
        stop_reason=extract_stop_reason(result) if result is not None else None,
        iterations=extract_iterations(result) if result is not None else None,
        root=root_value,
        root_id=assigned_root_id,
        abs_f_final=extract_abs_f_final(result) if result is not None else None,
        convergence_label=extract_label(result, "convergence_class")
        if result is not None
        else None,
        stability_label=extract_label(result, "stability_label")
        if result is not None
        else None,
        event_count=len(events),
        event_types=event_type_list(events),
        has_derivative_zero=flags["has_derivative_zero"],
        has_stagnation=flags["has_stagnation"],
        has_nonfinite=flags["has_nonfinite"],
        has_bad_bracket=flags["has_bad_bracket"],
        error_message=error_message,
    )


# -----------------------------
# Sweep execution
# -----------------------------


def run_problem_sweeps(
    problem: SweepProblem,
    *,
    methods: Optional[Sequence[str]] = None,
    scalar_points: int = 1000,
    secant_points: Optional[int] = None,
    bracket_points: Optional[int] = None,
    scalar_initial_points: Optional[Sequence[float]] = None,
    secant_initial_points: Optional[Sequence[float]] = None,
    # bracket_initial_points reserved for future bracket-sampling support.
    # Current implementation still uses sign-change bracket discovery on bracket_search_range.
    bracket_initial_points: Optional[Sequence[float]] = None,
    tol: float = 1e-10,
    max_iter: int = 100,
) -> List[SweepRunRecord]:
    methods_to_run = normalize_methods(methods)
    if not methods_to_run:
        raise ValueError("No valid methods selected.")

    if secant_points is None:
        secant_points = scalar_points
    if bracket_points is None:
        bracket_points = scalar_points

    if scalar_initial_points is None:
        x_min, x_max = problem.scalar_range
        scalar_initial_points = linspace(x_min, x_max, scalar_points)
    else:
        scalar_initial_points = [float(x) for x in scalar_initial_points]

    if secant_initial_points is None:
        s_min, s_max = problem.secant_range
        secant_initial_points = linspace(s_min, s_max, secant_points + 1)
    else:
        secant_initial_points = [float(x) for x in secant_initial_points]
    # bracket_initial_points reserved for future bracket-sampling support.
    # Current implementation still uses sign-change bracket discovery on bracket_search_range.
    if bracket_initial_points is not None:
        bracket_initial_points = [float(x) for x in bracket_initial_points]

    f = compile_expr(problem.expr)
    df = compile_expr(problem.dexpr) if problem.dexpr else None
    discovered_clusters: Optional[List[RootCluster]] = None

    root_discovery_n = max(len(scalar_initial_points), 2)

    if problem.dexpr is not None and any(
        m in methods_to_run for m in ("newton", "hybrid", "safeguarded_newton")
    ):
        discovered_clusters = discover_roots(
            expr=problem.expr,
            dexpr=problem.dexpr,
            xmin=problem.scalar_range[0],
            xmax=problem.scalar_range[1],
            n=root_discovery_n,
            tol=tol,
            max_iter=max_iter,
            cluster_tol=1e-4,
            residual_tol=1e-8,
        )

    records: List[SweepRunRecord] = []

    if "newton" in methods_to_run:
        for i, x0 in enumerate(scalar_initial_points):
            if df is not None:
                try:
                    res = run_newton(f, df, x0=x0, tol=tol, max_iter=max_iter)
                    records.append(
                        result_to_record(
                            problem,
                            "newton",
                            i,
                            res,
                            x0=x0,
                            clusters=discovered_clusters,
                        )
                    )
                except Exception as exc:
                    records.append(
                        result_to_record(
                            problem,
                            "newton",
                            i,
                            None,
                            x0=x0,
                            error_message=str(exc),
                            clusters=discovered_clusters,
                        )
                    )

    if "secant" in methods_to_run:
        if len(secant_initial_points) < 2:
            raise ValueError("Secant requires at least two initial points.")

        for i in range(len(secant_initial_points) - 1):
            x0, x1 = secant_initial_points[i], secant_initial_points[i + 1]
            try:
                res = run_secant(f, x0=x0, x1=x1, tol=tol, max_iter=max_iter)
                records.append(
                    result_to_record(
                        problem,
                        "secant",
                        i,
                        res,
                        x0=x0,
                        x1=x1,
                        clusters=discovered_clusters,
                    )
                )
            except Exception as exc:
                records.append(
                    result_to_record(
                        problem,
                        "secant",
                        i,
                        None,
                        x0=x0,
                        x1=x1,
                        error_message=str(exc),
                        clusters=discovered_clusters,
                    )
                )
    # Note:
    # Bracketing-based methods currently use sign-change bracket discovery over
    # problem.bracket_search_range. They do not yet consume bracket_initial_points
    # or Monte Carlo-style sampled bracket seeds.
    need_brackets = any(
        m in methods_to_run for m in ("bisection", "hybrid", "safeguarded_newton")
    )

    if need_brackets:
        b_min, b_max = problem.bracket_search_range
        brackets = find_sign_change_brackets(
            f=f,
            x_min=b_min,
            x_max=b_max,
            grid_size=max(2000, bracket_points * 3),
            max_brackets=bracket_points,
        )

        for i, (a, b) in enumerate(brackets):
            if "bisection" in methods_to_run:
                try:
                    res = run_bisection(f, a=a, b=b, tol=tol, max_iter=max_iter)
                    records.append(
                        result_to_record(
                            problem,
                            "bisection",
                            i,
                            res,
                            a=a,
                            b=b,
                            clusters=discovered_clusters,
                        )
                    )
                except Exception as exc:
                    records.append(
                        result_to_record(
                            problem,
                            "bisection",
                            i,
                            None,
                            a=a,
                            b=b,
                            error_message=str(exc),
                            clusters=discovered_clusters,
                        )
                    )

            if df is not None:
                x0_mid = 0.5 * (a + b)

                if "hybrid" in methods_to_run:
                    try:
                        res = run_hybrid(f, df, a=a, b=b, tol=tol, max_iter=max_iter)
                        records.append(
                            result_to_record(
                                problem,
                                "hybrid",
                                i,
                                res,
                                x0=x0_mid,
                                a=a,
                                b=b,
                                clusters=discovered_clusters,
                            )
                        )
                    except Exception as exc:
                        records.append(
                            result_to_record(
                                problem,
                                "hybrid",
                                i,
                                None,
                                x0=x0_mid,
                                a=a,
                                b=b,
                                error_message=str(exc),
                                clusters=discovered_clusters,
                            )
                        )

                if "safeguarded_newton" in methods_to_run:
                    try:
                        res = run_safeguarded_newton(
                            f, df, x0=x0_mid, a=a, b=b, tol=tol, max_iter=max_iter
                        )
                        records.append(
                            result_to_record(
                                problem,
                                "safeguarded_newton",
                                i,
                                res,
                                x0=x0_mid,
                                a=a,
                                b=b,
                                clusters=discovered_clusters,
                            )
                        )
                    except Exception as exc:
                        records.append(
                            result_to_record(
                                problem,
                                "safeguarded_newton",
                                i,
                                None,
                                x0=x0_mid,
                                a=a,
                                b=b,
                                error_message=str(exc),
                                clusters=discovered_clusters,
                            )
                        )

    return records


# -----------------------------
# Export helpers
# -----------------------------


def records_to_csv(records: Sequence[SweepRunRecord], path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    rows = []
    for r in records:
        d = asdict(r)
        d["event_types"] = json.dumps(d["event_types"] or [])
        rows.append(d)

    if not rows:
        return

    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def records_to_json(records: Sequence[SweepRunRecord], path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    payload = [asdict(r) for r in records]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


# -----------------------------
# Summary stats
# -----------------------------


def mean_or_none(vals: Sequence[Optional[float]]) -> Optional[float]:
    clean = [v for v in vals if v is not None]
    if not clean:
        return None
    return sum(clean) / len(clean)


def quantile(sorted_vals: Sequence[float], q: float) -> Optional[float]:
    if not sorted_vals:
        return None
    if q <= 0:
        return sorted_vals[0]
    if q >= 1:
        return sorted_vals[-1]

    idx = q * (len(sorted_vals) - 1)
    lo = math.floor(idx)
    hi = math.ceil(idx)

    if lo == hi:
        return sorted_vals[lo]

    w = idx - lo
    return sorted_vals[lo] * (1 - w) + sorted_vals[hi] * w


def summarize_records(
    records: Sequence[SweepRunRecord],
    max_iter: int = 100,
) -> Dict[str, Any]:
    by_key: Dict[Tuple[str, str], List[SweepRunRecord]] = {}
    for r in records:
        by_key.setdefault((r.problem_id, r.method), []).append(r)

    out: Dict[str, Any] = {}

    for (problem_id, method), group in by_key.items():
        total = len(group)
        success = [r for r in group if r.status == "converged"]
        failures = [r for r in group if r.status != "converged"]

        iters_all = sorted([r.iterations for r in group if r.iterations is not None])
        iters_success = sorted(
            [r.iterations for r in success if r.iterations is not None]
        )

        residuals_all = sorted(
            [r.abs_f_final for r in group if r.abs_f_final is not None]
        )
        residuals_success = sorted(
            [r.abs_f_final for r in success if r.abs_f_final is not None]
        )

        status_counts: Dict[str, int] = {}
        for r in group:
            k = r.status or "unknown"
            status_counts[k] = status_counts.get(k, 0) + 1

        cap_hits_all = sum(
            1 for r in group if r.iterations is not None and r.iterations >= max_iter
        )
        cap_hits_success = sum(
            1 for r in success if r.iterations is not None and r.iterations >= max_iter
        )

        key = f"{problem_id}:{method}"
        out[key] = {
            "problem_id": problem_id,
            "method": method,
            "n_total": total,
            "n_success": len(success),
            "n_failure": len(failures),
            "success_rate": (len(success) / total) if total else None,
            "failure_rate": (len(failures) / total) if total else None,
            "status_counts": status_counts,
            "iterations_all": {
                "mean": mean_or_none(iters_all),
                "min": min(iters_all) if iters_all else None,
                "median": quantile(iters_all, 0.5),
                "p90": quantile(iters_all, 0.9),
                "p95": quantile(iters_all, 0.95),
                "p99": quantile(iters_all, 0.99),
                "max": max(iters_all) if iters_all else None,
            },
            "iterations_success_only": {
                "mean": mean_or_none(iters_success),
                "min": min(iters_success) if iters_success else None,
                "median": quantile(iters_success, 0.5),
                "p90": quantile(iters_success, 0.9),
                "p95": quantile(iters_success, 0.95),
                "p99": quantile(iters_success, 0.99),
                "max": max(iters_success) if iters_success else None,
            },
            "cap_hit_rates": {
                "all_runs": (cap_hits_all / total) if total else None,
                "success_only": (cap_hits_success / len(success)) if success else None,
            },
            "residuals_all": {
                "mean": mean_or_none(residuals_all),
                "min": min(residuals_all) if residuals_all else None,
                "median": quantile(residuals_all, 0.5),
                "p90": quantile(residuals_all, 0.9),
                "p95": quantile(residuals_all, 0.95),
                "p99": quantile(residuals_all, 0.99),
                "max": max(residuals_all) if residuals_all else None,
            },
            "residuals_success_only": {
                "mean": mean_or_none(residuals_success),
                "min": min(residuals_success) if residuals_success else None,
                "median": quantile(residuals_success, 0.5),
                "p90": quantile(residuals_success, 0.9),
                "p95": quantile(residuals_success, 0.95),
                "p99": quantile(residuals_success, 0.99),
                "max": max(residuals_success) if residuals_success else None,
            },
            "event_flags": {
                "derivative_zero_rate": (
                    sum(r.has_derivative_zero for r in group) / total if total else None
                ),
                "stagnation_rate": (
                    sum(r.has_stagnation for r in group) / total if total else None
                ),
                "nonfinite_rate": (
                    sum(r.has_nonfinite for r in group) / total if total else None
                ),
                "bad_bracket_rate": (
                    sum(r.has_bad_bracket for r in group) / total if total else None
                ),
            },
        }

    return out


def summary_to_json(summary: Dict[str, Any], path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2), encoding="utf-8")


# -----------------------------
# High-level experiment runner
# -----------------------------


def run_single_sweep_experiment(
    *,
    problem_mode: str = "benchmark",
    problem_id: Optional[str] = None,
    expr: Optional[str] = None,
    dexpr: Optional[str] = None,
    x_min: Optional[float] = None,
    x_max: Optional[float] = None,
    scalar_range: Any = None,
    secant_range: Any = None,
    bracket_search_range: Any = None,
    methods: Optional[Sequence[str]] = None,
    n_points: int = 100,
    tol: float = 1e-10,
    max_iter: int = 100,
    output_dir: str | Path = "outputs/sweeps",
) -> Dict[str, Any]:
    mode = str(problem_mode or "benchmark").strip().lower()
    selected_methods = normalize_methods(methods)

    if not selected_methods:
        raise ValueError("No valid methods selected.")

    if mode == "custom":
        problem = build_custom_problem(
            expr=str(expr or "").strip(),
            dexpr=dexpr,
            x_min=x_min,
            x_max=x_max,
            scalar_range=scalar_range,
            secant_range=secant_range,
            bracket_search_range=bracket_search_range,
            problem_id="custom",
        )
    else:
        problem = get_default_problem(problem_id)

    sweep_id, sweep_path = create_sweep_folder(base=output_dir)

    records = run_problem_sweeps(
        problem,
        methods=selected_methods,
        scalar_points=int(n_points),
        secant_points=int(n_points),
        bracket_points=int(n_points),
        tol=float(tol),
        max_iter=int(max_iter),
    )

    records_csv_path = sweep_path / "records.csv"
    records_json_path = sweep_path / "records.json"
    summary_json_path = sweep_path / "summary.json"
    metadata_json_path = sweep_path / "metadata.json"

    records_to_csv(records, records_csv_path)
    records_to_json(records, records_json_path)

    summary = summarize_records(records, max_iter=int(max_iter))
    summary_to_json(summary, summary_json_path)

    methods_present = sorted({r.method for r in records if r.method})
    analytics_dir = sweep_path / problem.problem_id

    analytics_manifest = {
        problem.problem_id: generate_sweep_analytics(
            rows=[asdict(r) for r in records],
            methods=methods_present,
            outdir=analytics_dir,
        )
    }

    metadata = {
        "sweep_id": sweep_id,
        "created_at": datetime.now().isoformat(),
        "problem_mode": mode,
        "problem_id": problem.problem_id,
        "expr": problem.expr,
        "dexpr": problem.dexpr,
        "scalar_range": list(problem.scalar_range),
        "secant_range": list(problem.secant_range),
        "bracket_search_range": list(problem.bracket_search_range),
        "n_points": int(n_points),
        "tol": float(tol),
        "max_iter": int(max_iter),
        "methods": selected_methods,
    }

    metadata_json_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    basin_map = None
    analytics_block = analytics_manifest.get(problem.problem_id, {})
    if isinstance(analytics_block, dict):
        basin_map = analytics_block.get("basin_map")

    return {
        "sweep_id": sweep_id,
        "latest_sweep_dir": str(sweep_path).replace("\\", "/"),
        "problem_mode": mode,
        "problem_id": problem.problem_id,
        "expr": problem.expr,
        "dexpr": problem.dexpr,
        "methods": selected_methods,
        "records_csv": f"/{records_csv_path.as_posix()}",
        "records_json": f"/{records_json_path.as_posix()}",
        "summary_json": f"/{summary_json_path.as_posix()}",
        "metadata_json": f"/{metadata_json_path.as_posix()}",
        "artifacts": {
            "basin_map": basin_map,
            "analytics": analytics_manifest,
        },
        "boundaries": [],
        "summary": summary,
        "metadata": metadata,
    }


# -----------------------------
# Main runner for defaults
# -----------------------------


def run_all_default_sweeps(
    output_dir: str | Path = "outputs/sweeps",
    *,
    scalar_points: int = 1000,
    secant_points: int = 1000,
    bracket_points: int = 1000,
    tol: float = 1e-10,
    max_iter: int = 100,
) -> Dict[str, Any]:
    sweep_id, sweep_path = create_sweep_folder(base=output_dir)
    print("Running sweep:", sweep_id)

    all_records: List[SweepRunRecord] = []
    analytics_manifest: Dict[str, Any] = {}

    for problem in DEFAULT_PROBLEMS:
        records = run_problem_sweeps(
            problem,
            methods=["newton", "secant", "bisection", "hybrid", "safeguarded_newton"],
            scalar_points=scalar_points,
            secant_points=secant_points,
            bracket_points=bracket_points,
            tol=tol,
            max_iter=max_iter,
        )
        all_records.extend(records)

        problem_csv = sweep_path / f"{problem.problem_id}_runs.csv"
        problem_json = sweep_path / f"{problem.problem_id}_runs.json"
        records_to_csv(records, problem_csv)
        records_to_json(records, problem_json)

        methods_present = sorted({r.method for r in records if r.method})
        analytics_dir = sweep_path / problem.problem_id

        analytics_manifest[problem.problem_id] = generate_sweep_analytics(
            rows=[asdict(r) for r in records],
            methods=methods_present,
            outdir=analytics_dir,
        )

    summary = summarize_records(all_records, max_iter=max_iter)
    records_to_csv(all_records, sweep_path / "records.csv")
    records_to_json(all_records, sweep_path / "records.json")
    summary_to_json(summary, sweep_path / "summary.json")

    metadata = {
        "sweep_id": sweep_id,
        "created_at": datetime.now().isoformat(),
        "scalar_points": scalar_points,
        "secant_points": secant_points,
        "bracket_points": bracket_points,
        "tol": tol,
        "max_iter": max_iter,
        "problems": [p.problem_id for p in DEFAULT_PROBLEMS],
    }

    with open(sweep_path / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    return {
        "summary": summary,
        "analytics": analytics_manifest,
        "metadata": metadata,
        "sweep_id": sweep_id,
        "sweep_path": str(sweep_path),
    }


if __name__ == "__main__":
    result = run_single_sweep_experiment(
        problem_mode="benchmark",
        problem_id="p4",
        methods=["newton", "secant", "bisection", "hybrid", "safeguarded_newton"],
        n_points=100,
        tol=1e-10,
        max_iter=100,
        output_dir="outputs/sweeps",
    )
    print("DONE")
    print(json.dumps(result["metadata"], indent=2))