from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        v = float(value)
        if not math.isfinite(v):
            return None
        return v
    except (TypeError, ValueError):
        return None


def _merge_tol(a: float, b: float, abs_tol: float, rel_tol: float) -> float:
    scale = max(1.0, abs(a), abs(b))
    return max(abs_tol, rel_tol * scale)


def _is_close_value(a: float, b: float, abs_tol: float, rel_tol: float) -> bool:
    return abs(a - b) <= _merge_tol(a, b, abs_tol=abs_tol, rel_tol=rel_tol)


def _cluster_center(cluster: list[float]) -> float:
    xs = sorted(x for x in cluster if math.isfinite(x))
    if not xs:
        return 0.0

    n = len(xs)
    mid = n // 2
    if n % 2 == 1:
        return xs[mid]
    return 0.5 * (xs[mid - 1] + xs[mid])


def cluster_values(
    values: list[float],
    tol: float = 1e-6,
    rel_tol: float | None = None,
) -> list[float]:
    """
    Cluster nearby terminal root values into distinct detected roots.
    Returns clustered root centers.

    Rules:
    - discard non-finite values
    - use tolerance-aware 1D merging
    - cluster representative = median(cluster)
    - tol is treated as absolute tolerance
    """
    xs = sorted(v for v in values if v is not None and math.isfinite(v))
    if not xs:
        return []

    abs_tol = max(float(tol), 0.0)
    rel_tol = max(float(rel_tol if rel_tol is not None else tol), 1e-12)

    clusters: list[list[float]] = [[xs[0]]]

    for v in xs[1:]:
        current = clusters[-1]
        center = _cluster_center(current)

        if _is_close_value(v, center, abs_tol=abs_tol, rel_tol=rel_tol):
            current.append(v)
        else:
            clusters.append([v])

    return [_cluster_center(cluster) for cluster in clusters]


def _extract_final_root(row: dict[str, Any]) -> float | None:
    """
    Important:
    Do NOT fall back to generic 'x', because in sweep records that may refer
    to an initialization/sample coordinate rather than the converged root.
    """
    for key in ("final_root", "root", "x_star", "solution", "final_x"):
        value = _safe_float(row.get(key))
        if value is not None:
            return value
    return None


def _is_in_domain(
    x: float,
    domain: list[float] | tuple[float, float] | None,
    tol: float,
) -> bool:
    if domain is None or len(domain) != 2:
        return True

    a = _safe_float(domain[0])
    b = _safe_float(domain[1])
    if a is None or b is None:
        return True

    lo = min(a, b)
    hi = max(a, b)
    return (lo - tol) <= x <= (hi + tol)


def _partition_by_domain(
    roots: list[float],
    domain: list[float] | tuple[float, float] | None,
    tol: float,
) -> tuple[list[float], list[float]]:
    in_domain = []
    out_of_domain = []

    for x in roots:
        if _is_in_domain(x, domain, tol=tol):
            in_domain.append(x)
        else:
            out_of_domain.append(x)

    return in_domain, out_of_domain


def match_to_global_roots(
    local_roots: list[float],
    global_roots: list[float],
    tol: float = 1e-6,
    rel_tol: float | None = None,
) -> list[float]:
    """
    Match local clustered roots to a global detected root set.
    Returns unique matched global roots.
    """
    abs_tol = max(float(tol), 0.0)
    rel_tol = max(float(rel_tol if rel_tol is not None else tol), 1e-12)

    matched: list[float] = []

    for r in local_roots:
        if not math.isfinite(r):
            continue

        best_match = None
        best_dist = None

        for g in global_roots:
            if not math.isfinite(g):
                continue

            dist = abs(r - g)
            local_tol = _merge_tol(r, g, abs_tol=abs_tol, rel_tol=rel_tol)

            if dist <= local_tol and (best_dist is None or dist < best_dist):
                best_match = g
                best_dist = dist

        if best_match is not None:
            matched.append(best_match)

    return sorted(set(matched))


def match_to_known_roots(
    detected_roots: list[float],
    known_roots: list[float],
    tol: float = 1e-6,
    rel_tol: float | None = None,
) -> dict[str, Any]:
    """
    One-to-one greedy matching between detected in-domain roots and known roots.
    """
    abs_tol = max(float(tol), 0.0)
    rel_tol = max(float(rel_tol if rel_tol is not None else tol), 1e-12)

    detected = sorted(x for x in detected_roots if math.isfinite(x))
    known = sorted(x for x in known_roots if math.isfinite(x))

    matched_pairs: list[dict[str, float]] = []
    unmatched_detected: list[float] = []
    used_known: set[int] = set()

    for d in detected:
        best_j = None
        best_dist = None

        for j, k in enumerate(known):
            if j in used_known:
                continue

            dist = abs(d - k)
            local_tol = _merge_tol(d, k, abs_tol=abs_tol, rel_tol=rel_tol)

            if dist <= local_tol and (best_dist is None or dist < best_dist):
                best_j = j
                best_dist = dist

        if best_j is None:
            unmatched_detected.append(d)
        else:
            used_known.add(best_j)
            matched_pairs.append(
                {
                    "detected_root": d,
                    "known_root": known[best_j],
                    "abs_error": abs(d - known[best_j]),
                }
            )

    unmatched_known = [k for j, k in enumerate(known) if j not in used_known]

    return {
        "matched_pairs": matched_pairs,
        "matched_count": len(matched_pairs),
        "unmatched_detected": unmatched_detected,
        "unmatched_known": unmatched_known,
        "detected_count": len(detected),
        "known_count": len(known),
    }


def compute_root_coverage(
    rows: list[dict[str, Any]],
    tol: float = 1e-6,
    domain: list[float] | tuple[float, float] | None = None,
    known_roots: list[float] | None = None,
) -> dict[str, Any]:
    """
    Compute experiment-level root coverage for each solver.

    Exposes two layers:
    1. True solver behavior:
       - all_detected_roots
       - in_domain_detected_roots
       - out_of_domain_detected_roots
    2. Benchmark evaluation:
       - benchmark_matched_roots
       - benchmark coverage based only on in-domain roots
    """
    all_converged_roots: list[float] = []
    per_solver_roots: dict[str, list[float]] = defaultdict(list)

    for row in rows:
        method = str(row.get("method", "unknown")).strip().lower()
        status = str(row.get("status", "")).strip().lower()

        if status != "converged":
            continue

        final_root = _extract_final_root(row)
        if final_root is None:
            continue

        all_converged_roots.append(final_root)
        per_solver_roots[method].append(final_root)

    global_roots_all = cluster_values(all_converged_roots, tol=tol)
    global_in_domain_roots, global_out_of_domain_roots = _partition_by_domain(
        global_roots_all,
        domain=domain,
        tol=tol,
    )

    benchmark_total_roots = len(known_roots or [])
    in_domain_total_roots_detected = len(global_in_domain_roots)

    result: dict[str, Any] = {
        "tolerance": tol,
        "domain": list(domain) if domain is not None else None,
        "known_roots": list(known_roots or []),
        "global_behavior": {
            "all_detected_roots": global_roots_all,
            "all_detected_root_count": len(global_roots_all),
            "in_domain_detected_roots": global_in_domain_roots,
            "in_domain_detected_root_count": len(global_in_domain_roots),
            "out_of_domain_detected_roots": global_out_of_domain_roots,
            "out_of_domain_detected_root_count": len(global_out_of_domain_roots),
        },
        "benchmark_evaluation": {
            "known_root_count": benchmark_total_roots,
            "in_domain_detected_root_count": in_domain_total_roots_detected,
        },
        "solvers": {},
    }

    all_methods = sorted({str(row.get("method", "unknown")).strip().lower() for row in rows})

    for method in all_methods:
        local_raw_roots = per_solver_roots.get(method, [])
        local_all_roots = cluster_values(local_raw_roots, tol=tol)
        local_in_domain_roots, local_out_of_domain_roots = _partition_by_domain(
            local_all_roots,
            domain=domain,
            tol=tol,
        )

        matched_global_all = match_to_global_roots(local_all_roots, global_roots_all, tol=tol)
        matched_global_in_domain = match_to_global_roots(
            local_in_domain_roots,
            global_in_domain_roots,
            tol=tol,
        )

        benchmark_match = None
        benchmark_matched_roots: list[float] = []
        benchmark_coverage = None

        if known_roots is not None:
            benchmark_match = match_to_known_roots(
                detected_roots=local_in_domain_roots,
                known_roots=known_roots,
                tol=tol,
            )
            benchmark_matched_roots = [
                pair["known_root"] for pair in benchmark_match["matched_pairs"]
            ]
            benchmark_coverage = (
                benchmark_match["matched_count"] / len(known_roots)
                if len(known_roots) > 0
                else 0.0
            )

        result["solvers"][method] = {
            "true_behavior": {
                "all_detected_roots": local_all_roots,
                "all_detected_root_count": len(local_all_roots),
                "in_domain_detected_roots": local_in_domain_roots,
                "in_domain_detected_root_count": len(local_in_domain_roots),
                "out_of_domain_detected_roots": local_out_of_domain_roots,
                "out_of_domain_detected_root_count": len(local_out_of_domain_roots),
                "excursion_detected": len(local_out_of_domain_roots) > 0,
                "domain_faithfulness": (
                    len(local_in_domain_roots) / len(local_all_roots)
                    if len(local_all_roots) > 0
                    else 1.0
                ),
                "matched_global_all_roots": matched_global_all,
                "matched_global_in_domain_roots": matched_global_in_domain,
                "local_raw_converged_count": len(local_raw_roots),
            },
            "benchmark_evaluation": {
                "benchmark_matched_roots": benchmark_matched_roots,
                "benchmark_matched_count": (
                    benchmark_match["matched_count"] if benchmark_match is not None else None
                ),
                "benchmark_known_root_count": len(known_roots) if known_roots is not None else None,
                "benchmark_coverage": benchmark_coverage,
                "unmatched_detected_in_domain_roots": (
                    benchmark_match["unmatched_detected"] if benchmark_match is not None else []
                ),
                "unmatched_known_roots": (
                    benchmark_match["unmatched_known"] if benchmark_match is not None else []
                ),
                "matching_details": benchmark_match,
            },
        }

    return result


def save_root_coverage_summary(output_path: str | Path, summary: dict[str, Any]) -> str:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    return str(output_path)


def plot_root_coverage(summary: dict[str, Any], output_path: str | Path) -> str | None:
    """
    Save a bar chart of benchmark root coverage by solver.

    If benchmark coverage is available, use that.
    Otherwise fall back to in-domain/global detected coverage.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    solvers_payload = summary.get("solvers", {}) or {}
    if not solvers_payload:
        return None

    solvers = list(solvers_payload.keys())

    coverages = []
    labels = []

    for solver in solvers:
        payload = solvers_payload[solver]
        bench = payload.get("benchmark_evaluation", {}) or {}
        true_behavior = payload.get("true_behavior", {}) or {}

        benchmark_coverage = bench.get("benchmark_coverage", None)
        benchmark_matched_count = bench.get("benchmark_matched_count", None)
        benchmark_known_root_count = bench.get("benchmark_known_root_count", None)

        if (
            benchmark_coverage is not None
            and benchmark_matched_count is not None
            and benchmark_known_root_count is not None
        ):
            coverages.append(float(benchmark_coverage))
            labels.append(f"{benchmark_matched_count}/{benchmark_known_root_count}")
        else:
            in_domain_count = int(true_behavior.get("in_domain_detected_root_count", 0))
            global_in_domain_count = int(
                summary.get("global_behavior", {}).get("in_domain_detected_root_count", 0)
            )
            fallback_cov = (
                in_domain_count / global_in_domain_count
                if global_in_domain_count > 0
                else 0.0
            )
            coverages.append(float(fallback_cov))
            labels.append(f"{in_domain_count}/{global_in_domain_count}")

    fig, ax = plt.subplots(figsize=(8, 5))
    bars = ax.bar(solvers, coverages)

    ax.set_ylim(0.0, 1.05)
    ax.set_xlabel("Solver")
    ax.set_ylabel("Benchmark Root Coverage")
    ax.set_title("Benchmark Root Coverage by Solver")
    ax.grid(True, axis="y", alpha=0.3)

    for bar, label in zip(bars, labels):
        x = bar.get_x() + bar.get_width() / 2.0
        y = bar.get_height()
        ax.text(
            x,
            min(y + 0.02, 1.03),
            label,
            ha="center",
            va="bottom",
            fontsize=9,
        )

    fig.tight_layout()
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    return str(output_path)