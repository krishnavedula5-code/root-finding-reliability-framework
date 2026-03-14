from __future__ import annotations

import json
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
        return float(value)
    except (TypeError, ValueError):
        return None


def cluster_values(values: list[float], tol: float = 1e-6) -> list[float]:
    """
    Cluster nearby terminal root values into distinct detected roots.
    Returns cluster centers.
    """
    xs = sorted(v for v in values if v is not None)
    if not xs:
        return []

    clusters: list[list[float]] = [[xs[0]]]

    for v in xs[1:]:
        current = clusters[-1]
        center = sum(current) / len(current)

        if abs(v - center) <= tol:
            current.append(v)
        else:
            clusters.append([v])

    return [sum(cluster) / len(cluster) for cluster in clusters]


def match_to_global_roots(
    local_roots: list[float],
    global_roots: list[float],
    tol: float = 1e-6,
) -> list[float]:
    """
    Match local clustered roots to the global detected root set.
    Returns unique matched global roots.
    """
    matched: list[float] = []

    for r in local_roots:
        best_match = None
        best_dist = None

        for g in global_roots:
            dist = abs(r - g)
            if dist <= tol and (best_dist is None or dist < best_dist):
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
    """
    all_converged_roots: list[float] = []
    per_solver_roots: dict[str, list[float]] = defaultdict(list)

    for row in rows:
        method = str(row.get("method", "unknown")).strip().lower()
        status = str(row.get("status", "")).strip().lower()

        if status != "converged":
            continue

        final_root = None
        for key in ("final_root", "root", "x_star", "solution", "final_x", "x"):
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

    for method in sorted(per_solver_roots.keys()):
        local_clusters = cluster_values(per_solver_roots[method], tol=tol)
        matched_roots = match_to_global_roots(local_clusters, global_roots, tol=tol)

        roots_found = len(matched_roots)
        coverage = (roots_found / total_roots) if total_roots > 0 else 0.0

        result["solvers"][method] = {
            "roots_found": roots_found,
            "total_roots": total_roots,
            "coverage": coverage,
            "found_roots": matched_roots,
            "local_clustered_roots": local_clusters,
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