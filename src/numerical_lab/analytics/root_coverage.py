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


def match_to_global_roots(
    local_roots: list[float],
    global_roots: list[float],
    tol: float = 1e-6,
    rel_tol: float | None = None,
) -> list[float]:
    """
    Match local clustered roots to the global detected root set.
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


def compute_root_coverage(rows: list[dict[str, Any]], tol: float = 1e-6) -> dict[str, Any]:
    """
    Compute experiment-level root coverage for each solver.

    Global roots:
        clustered from all converged terminal roots across all methods.

    Solver roots:
        clustered from converged terminal roots for that solver only.

    Important:
    Do NOT fall back to generic 'x', because in sweep records it may refer
    to an initialization/sample coordinate rather than the converged root.
    """
    all_converged_roots: list[float] = []
    per_solver_roots: dict[str, list[float]] = defaultdict(list)

    for row in rows:
        method = str(row.get("method", "unknown")).strip().lower()
        status = str(row.get("status", "")).strip().lower()

        if status != "converged":
            continue

        final_root = None
        for key in ("final_root", "root", "x_star", "solution", "final_x"):
            final_root = _safe_float(row.get(key))
            if final_root is not None:
                break

        if final_root is None:
            continue

        all_converged_roots.append(final_root)
        per_solver_roots[method].append(final_root)

    global_roots = cluster_values(all_converged_roots, tol=tol)
    total_roots = len(global_roots)

    result: dict[str, Any] = {
        "total_roots_detected": total_roots,
        "global_roots": global_roots,
        "tolerance": tol,
        "solvers": {},
    }

    all_methods = sorted({str(row.get("method", "unknown")).strip().lower() for row in rows})

    for method in all_methods:
        local_raw_roots = per_solver_roots.get(method, [])
        local_clusters = cluster_values(local_raw_roots, tol=tol)
        matched_roots = match_to_global_roots(local_clusters, global_roots, tol=tol)

        roots_found = len(matched_roots)
        coverage = (roots_found / total_roots) if total_roots > 0 else 0.0

        result["solvers"][method] = {
            "roots_found": roots_found,
            "total_roots": total_roots,
            "coverage": coverage,
            "found_roots": matched_roots,
            "local_clustered_roots": local_clusters,
            "local_raw_converged_count": len(local_raw_roots),
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
    Save a bar chart of root coverage by solver.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    solvers_payload = summary.get("solvers", {}) or {}
    if not solvers_payload:
        return None

    solvers = list(solvers_payload.keys())
    coverages = [float(solvers_payload[s].get("coverage", 0.0)) for s in solvers]
    labels = [
        f'{solvers_payload[s].get("roots_found", 0)}/{solvers_payload[s].get("total_roots", 0)}'
        for s in solvers
    ]

    fig, ax = plt.subplots(figsize=(8, 5))
    bars = ax.bar(solvers, coverages)

    ax.set_ylim(0.0, 1.05)
    ax.set_xlabel("Solver")
    ax.set_ylabel("Root Coverage")
    ax.set_title("Root Coverage by Solver")
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