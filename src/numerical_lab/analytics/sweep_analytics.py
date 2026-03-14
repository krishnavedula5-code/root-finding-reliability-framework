from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, median
from typing import Any

from numerical_lab.analytics.root_coverage import (
    compute_root_coverage,
    save_root_coverage_summary,
    plot_root_coverage,
)

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt


_STATUS_COLOR = {
    "converged": "green",
    "max_iter": "red",
    "derivative_zero": "orange",
    "stagnation": "purple",
    "bad_bracket": "brown",
    "nan_or_inf": "black",
    "error": "gray",
    "unknown": "blue",
}

SCALAR_FAILURE_METHODS = {"newton", "secant"}


def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _safe_int(x: Any, default: int = 0) -> int:
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return default


def _normalize_status(row: dict) -> str:
    return str(row.get("status", "")).strip().lower() or "unknown"


def _is_converged(row: dict) -> bool:
    return _normalize_status(row) == "converged"


def _extract_iterations(row: dict) -> int:
    return _safe_int(row.get("iterations", row.get("iters", 0)), default=0)


def _extract_x0(row: dict) -> float | None:
    for key in ("x0", "initial_x", "initial_guess", "start"):
        if key in row:
            try:
                return float(row[key])
            except (TypeError, ValueError):
                return None
    return None


def _extract_root(row: dict) -> float | None:
    for key in ("final_root", "root", "x_star", "solution", "final_x", "x"):
        if key in row:
            try:
                return float(row[key])
            except (TypeError, ValueError):
                return None
    return None


def _get_method_rows(rows: list[dict], method: str) -> list[dict]:
    return [
        r for r in rows
        if str(r.get("method", "")).strip().lower() == method.strip().lower()
    ]


def _percentile_nearest_rank(values: list[int], q: float) -> int:
    if not values:
        return 0
    if q <= 0:
        return values[0]
    if q >= 100:
        return values[-1]

    xs = sorted(values)
    rank = math.ceil((q / 100.0) * len(xs))
    rank = max(1, min(rank, len(xs)))
    return xs[rank - 1]


def compute_method_summary(rows: list[dict], method: str) -> dict:
    method_rows = _get_method_rows(rows, method)

    total_runs = len(method_rows)
    converged_rows = [r for r in method_rows if _is_converged(r)]
    success_iters = [_extract_iterations(r) for r in converged_rows]

    success_count = len(converged_rows)
    failure_count = total_runs - success_count
    success_rate = (success_count / total_runs) if total_runs > 0 else 0.0

    return {
        "method": method,
        "success_rate": success_rate,
        "mean_iter": round(mean(success_iters), 4) if success_iters else 0.0,
        "median_iter": median(success_iters) if success_iters else 0,
        "p95_iter": _percentile_nearest_rank(success_iters, 95) if success_iters else 0,
        "max_iter": max(success_iters) if success_iters else 0,
        "failure_count": failure_count,
    }


def _get_success_iterations(rows: list[dict], method: str) -> list[int]:
    method_rows = _get_method_rows(rows, method)
    success_iters = [
        _extract_iterations(r)
        for r in method_rows
        if _is_converged(r)
    ]
    return sorted(success_iters)


def _cluster_roots(root_values: list[float], cluster_tol: float) -> list[list[float]]:
    xs = [x for x in sorted(root_values) if math.isfinite(x)]
    if not xs:
        return []

    clusters: list[list[float]] = [[xs[0]]]

    for x in xs[1:]:
        current_cluster = clusters[-1]
        cluster_center = sum(current_cluster) / len(current_cluster)

        if abs(x - cluster_center) <= cluster_tol:
            current_cluster.append(x)
        else:
            clusters.append([x])

    return clusters


def _cluster_center(cluster: list[float]) -> float:
    return sum(cluster) / len(cluster)


def _cluster_label(cluster: list[float]) -> str:
    center = _cluster_center(cluster)
    return f"{center:.6f}"


def _build_root_label_map(root_values: list[float], cluster_tol: float) -> dict[float, str]:
    """
    Build a mapping from each raw root value to its clustered root label.
    """
    clusters = _cluster_roots(root_values, cluster_tol=cluster_tol)
    label_map: dict[float, str] = {}

    for cluster in clusters:
        label = _cluster_label(cluster)
        for x in cluster:
            label_map[x] = label

    return label_map


def _canonicalize_root_values(root_values: list[float], cluster_tol: float) -> tuple[list[list[float]], dict[float, str]]:
    """
    Return both clusters and raw-root -> cluster-label mapping.
    """
    xs = [x for x in root_values if math.isfinite(x)]
    clusters = _cluster_roots(xs, cluster_tol=cluster_tol)
    label_map: dict[float, str] = {}

    for cluster in clusters:
        label = _cluster_label(cluster)
        for x in cluster:
            label_map[x] = label

    return clusters, label_map


def compute_basin_entropy(rows: list[dict], method: str, cluster_tol: float) -> dict:
    method_rows = _get_method_rows(rows, method)

    converged_rows = [r for r in method_rows if _is_converged(r)]

    root_values = []
    for row in converged_rows:
        root_value = _extract_root(row)
        if root_value is None or not math.isfinite(root_value):
            continue
        root_values.append(root_value)

    clusters, _ = _canonicalize_root_values(root_values, cluster_tol=cluster_tol)

    if not clusters:
        return {
            "method": method,
            "entropy": 0.0,
            "num_basins": 0,
            "total_converged": 0,
            "cluster_tol": cluster_tol,
            "basin_counts": {},
            "basin_probabilities": {},
        }

    basin_counts = {
        _cluster_label(cluster): len(cluster)
        for cluster in clusters
    }

    total = sum(basin_counts.values())
    basin_probabilities = {
        label: count / total
        for label, count in basin_counts.items()
    }

    entropy = -sum(
        p * math.log(p)
        for p in basin_probabilities.values()
        if p > 0
    )
    entropy = max(0.0, entropy)

    return {
        "method": method,
        "entropy": round(entropy, 8),
        "num_basins": len(clusters),
        "total_converged": total,
        "cluster_tol": cluster_tol,
        "basin_counts": basin_counts,
        "basin_probabilities": basin_probabilities,
    }


def compute_root_basin_statistics(
    rows: list[dict],
    method: str,
    cluster_tol: float,
) -> dict:
    method_rows = _get_method_rows(rows, method)
    converged_rows = [r for r in method_rows if _is_converged(r)]

    root_values = []
    for row in converged_rows:
        root_value = _extract_root(row)
        if root_value is None or not math.isfinite(root_value):
            continue
        root_values.append(root_value)

    clusters, _ = _canonicalize_root_values(root_values, cluster_tol=cluster_tol)

    basin_counts = {
        _cluster_label(cluster): len(cluster)
        for cluster in clusters
    }

    total_runs = len(method_rows)
    total_converged = len(converged_rows)
    failure_count = total_runs - total_converged
    failure_share = (failure_count / total_runs) if total_runs > 0 else 0.0

    basin_probabilities = {}
    if total_converged > 0:
        basin_probabilities = {
            root_label: count / total_converged
            for root_label, count in basin_counts.items()
        }

    dominant_root = None
    dominant_share = 0.0
    if basin_probabilities:
        dominant_root = max(basin_probabilities, key=basin_probabilities.get)
        dominant_share = basin_probabilities[dominant_root]

    per_root_rows = []
    for root_label in sorted(basin_counts.keys(), key=lambda x: float(x)):
        per_root_rows.append({
            "method": method,
            "root": root_label,
            "basin_count": basin_counts[root_label],
            "basin_share": basin_probabilities.get(root_label, 0.0),
            "total_converged": total_converged,
            "failure_count": failure_count,
            "failure_share": failure_share,
        })

    return {
        "method": method,
        "cluster_tol": cluster_tol,
        "total_runs": total_runs,
        "total_converged": total_converged,
        "failure_count": failure_count,
        "failure_share": round(failure_share, 8),
        "num_basins": len(basin_counts),
        "dominant_root": dominant_root,
        "dominant_share": round(dominant_share, 8) if dominant_root is not None else 0.0,
        "basin_counts": basin_counts,
        "basin_probabilities": basin_probabilities,
        "per_root_rows": per_root_rows,
    }


def save_root_basin_statistics(
    rows: list[dict],
    methods: list[str],
    outpath: str | Path,
    cluster_tol: float,
) -> dict:
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    method_rows = [
        compute_root_basin_statistics(rows, method, cluster_tol=cluster_tol)
        for method in methods
    ]

    per_root_table = []
    summary_table = []

    for method_payload in method_rows:
        per_root_table.extend(method_payload.get("per_root_rows", []))
        summary_table.append({
            "method": method_payload["method"],
            "num_basins": method_payload["num_basins"],
            "dominant_root": method_payload["dominant_root"],
            "dominant_share": method_payload["dominant_share"],
            "total_converged": method_payload["total_converged"],
            "failure_count": method_payload["failure_count"],
            "failure_share": method_payload["failure_share"],
        })

    payload = {
        "cluster_tol": cluster_tol,
        "methods": method_rows,
        "per_root_table": per_root_table,
        "summary_table": summary_table,
    }

    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    return payload


def save_root_basin_statistics_plot(
    root_basin_stats_data: dict,
    method: str,
    outpath: str | Path,
) -> str | None:
    """
    Save an explicit root basin statistics plot for one method.
    This is the publication-friendly artifact name.
    """
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    method_payloads = root_basin_stats_data.get("methods", []) or []
    method_payload = None
    for payload in method_payloads:
        if str(payload.get("method", "")).strip().lower() == method.strip().lower():
            method_payload = payload
            break

    if not method_payload:
        return None

    basin_counts = method_payload.get("basin_counts", {}) or {}
    if not basin_counts:
        return None

    labels = sorted(basin_counts.keys(), key=lambda x: float(x))
    counts = [basin_counts[label] for label in labels]

    fig, ax = plt.subplots(figsize=(6, 4))
    ax.bar(range(len(labels)), counts)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=45)
    ax.set_xlabel("Clustered Root")
    ax.set_ylabel("Number of Converged Initializations")
    ax.set_title(f"Root Basin Size Distribution — {method}")

    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return str(outpath)


def plot_root_basin_distribution(rows, method, outdir, cluster_tol=1e-6):
    """
    Plot how many initial conditions converge to each clustered root.
    This reveals basin size dominance.

    Kept for backward compatibility with the older artifact name:
    basin_root_distribution_<method>.png
    """
    root_values = []

    for r in rows:
        if str(r.get("method", "")).strip().lower() != method.strip().lower():
            continue

        if str(r.get("status", "")).strip().lower() != "converged":
            continue

        root = _extract_root(r)
        if root is None or not math.isfinite(root):
            continue

        root_values.append(root)

    if not root_values:
        return None

    clusters, _ = _canonicalize_root_values(root_values, cluster_tol=cluster_tol)

    basin_counts = {
        _cluster_label(cluster): len(cluster)
        for cluster in clusters
    }

    labels = sorted(basin_counts.keys(), key=lambda x: float(x))
    counts = [basin_counts[label] for label in labels]

    plt.figure(figsize=(6, 4))
    plt.bar(range(len(labels)), counts)
    plt.xticks(range(len(labels)), labels, rotation=45)
    plt.xlabel("Clustered Root")
    plt.ylabel("Number of Converged Initializations")
    plt.title(f"Basin Size Distribution — {method}")

    plt.tight_layout()

    outpath = outdir / f"basin_root_distribution_{method}.png"
    plt.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close()

    return outpath.name


def save_iteration_histogram(rows: list[dict], method: str, outpath: str | Path) -> str:
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    values = _get_success_iterations(rows, method)

    fig, ax = plt.subplots(figsize=(8, 5))
    if values:
        bins = min(30, max(1, len(set(values))))
        ax.hist(values, bins=bins)
        ax.set_xlabel("Iterations")
        ax.set_ylabel("Frequency")
        ax.set_title(f"Iteration Histogram — {method}")
        ax.grid(True, alpha=0.3)
    else:
        ax.text(0.5, 0.5, "No converged runs", ha="center", va="center", transform=ax.transAxes)
        ax.set_title(f"Iteration Histogram — {method}")
        ax.set_axis_off()

    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return str(outpath)


def save_iteration_ccdf(rows: list[dict], method: str, outpath: str | Path) -> str:
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    values = _get_success_iterations(rows, method)

    fig, ax = plt.subplots(figsize=(8, 5))
    if values:
        unique_k = sorted(set(values))
        n = len(values)
        ccdf = [sum(v >= k for v in values) / n for k in unique_k]

        ax.step(unique_k, ccdf, where="post")
        ax.set_xlabel("Iterations")
        ax.set_ylabel("P(K ≥ k)")
        ax.set_title(f"Iteration CCDF — {method}")
        ax.set_yscale("log")
        ax.grid(True, alpha=0.3)
    else:
        ax.text(0.5, 0.5, "No converged runs", ha="center", va="center", transform=ax.transAxes)
        ax.set_title(f"Iteration CCDF — {method}")
        ax.set_axis_off()

    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return str(outpath)


def save_failure_region_plot(
    rows: list[dict],
    method: str,
    outpath: str | Path,
) -> str | None:
    """
    Save a 1D failure-region plot for scalar-initialization methods only.
    x-axis: initialization x0
    color: solver status
    """
    method_norm = method.strip().lower()
    if method_norm not in SCALAR_FAILURE_METHODS:
        return None

    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    method_rows = _get_method_rows(rows, method_norm)

    xs = []
    ys = []
    colors = []

    for row in method_rows:
        x0 = _extract_x0(row)
        if x0 is None:
            continue

        status = _normalize_status(row)
        color = _STATUS_COLOR.get(status, "blue")

        xs.append(x0)
        ys.append(0.0)
        colors.append(color)

    fig, ax = plt.subplots(figsize=(8, 3.2))

    if xs:
        ax.scatter(xs, ys, c=colors, s=20, alpha=0.85)
        ax.set_xlabel("Initial guess x0", labelpad=8)
        ax.set_yticks([])
        ax.set_title(f"Failure Region — {method}")
        ax.grid(True, axis="x", alpha=0.3)
        ax.margins(y=0.4)

        present_statuses = sorted({
            _normalize_status(r)
            for r in method_rows
            if _extract_x0(r) is not None
        })

        handles = [
            plt.Line2D(
                [0], [0],
                marker="o",
                linestyle="",
                markersize=6,
                markerfacecolor=_STATUS_COLOR.get(status, "blue"),
                markeredgecolor=_STATUS_COLOR.get(status, "blue"),
                label=status,
            )
            for status in present_statuses
        ]
        if handles:
            ax.legend(
                handles=handles,
                loc="upper center",
                bbox_to_anchor=(0.5, -0.30),
                ncol=min(3, len(handles)),
                frameon=True,
                fontsize=9,
                handletextpad=0.5,
                columnspacing=1.2,
            )

        fig.subplots_adjust(bottom=0.34)
    else:
        ax.text(
            0.5,
            0.5,
            "No scalar x0 data available",
            ha="center",
            va="center",
            transform=ax.transAxes,
        )
        ax.set_title(f"Failure Region — {method}")
        ax.set_axis_off()

    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return str(outpath)


def save_initialization_histogram(
    rows: list[dict],
    method: str,
    outpath: str | Path,
) -> str | None:
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    method_rows = _get_method_rows(rows, method)
    xs = []

    for row in method_rows:
        x0 = _extract_x0(row)
        if x0 is not None and math.isfinite(x0):
            xs.append(x0)

    fig, ax = plt.subplots(figsize=(8, 5))

    if not xs:
        plt.close(fig)
        return None

    bins = min(30, max(5, int(math.sqrt(len(xs)))))
    ax.hist(xs, bins=bins)
    ax.set_xlabel("Initial guess x0")
    ax.set_ylabel("Frequency")
    ax.set_title(f"Initialization Histogram — {method}")
    ax.grid(True, alpha=0.3)

    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return str(outpath)


def save_initial_x_vs_root_plot(
    rows: list[dict],
    method: str,
    outpath: str | Path,
) -> str | None:
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    method_rows = _get_method_rows(rows, method)

    xs = []
    ys = []

    for row in method_rows:
        if not _is_converged(row):
            continue

        x0 = _extract_x0(row)
        root = _extract_root(row)

        if x0 is None or root is None:
            continue
        if not (math.isfinite(x0) and math.isfinite(root)):
            continue

        xs.append(x0)
        ys.append(root)

    fig, ax = plt.subplots(figsize=(8, 5))

    if not xs:
        plt.close(fig)
        return None

    ax.scatter(xs, ys, s=20, alpha=0.8)
    ax.set_xlabel("Initial guess x0")
    ax.set_ylabel("Converged root")
    ax.set_title(f"Initial Guess vs Converged Root — {method}")
    ax.grid(True, alpha=0.3)

    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return str(outpath)


def save_initial_x_vs_iterations_plot(
    rows: list[dict],
    method: str,
    outpath: str | Path,
) -> str | None:
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    method_rows = _get_method_rows(rows, method)

    xs = []
    ys = []
    colors = []

    for row in method_rows:
        x0 = _extract_x0(row)
        iterations = _extract_iterations(row)
        status = _normalize_status(row)

        if x0 is None:
            continue
        if not math.isfinite(x0):
            continue

        xs.append(x0)
        ys.append(iterations)
        colors.append(_STATUS_COLOR.get(status, "blue"))

    fig, ax = plt.subplots(figsize=(8, 5))

    if not xs:
        plt.close(fig)
        return None

    ax.scatter(xs, ys, c=colors, s=20, alpha=0.8)
    ax.set_xlabel("Initial guess x0")
    ax.set_ylabel("Iterations")
    ax.set_title(f"Initial Guess vs Iterations — {method}")
    ax.grid(True, alpha=0.3)

    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return str(outpath)


def _is_dominated(point: dict, all_points: list[dict], tol: float = 1e-12) -> bool:
    x = point["x"]
    y = point["y"]

    for other in all_points:
        if other["method"] == point["method"]:
            continue

        ox = other["x"]
        oy = other["y"]

        no_worse = (ox <= x + tol) and (oy <= y + tol)
        strictly_better = (ox < x - tol) or (oy < y - tol)

        if no_worse and strictly_better:
            return True

    return False


def _compute_pareto_partition(summary_rows: list[dict], x_key: str) -> tuple[list[dict], list[dict]]:
    points = []

    for row in summary_rows:
        method = str(row.get("method", "")).strip()
        x = _safe_float(row.get(x_key), default=float("nan"))
        success_rate = _safe_float(row.get("success_rate"), default=0.0)
        y = 1.0 - success_rate

        if not math.isfinite(x):
            continue

        points.append({
            "method": method,
            "x": x,
            "y": y,
        })

    frontier = []
    dominated = []

    for point in points:
        if _is_dominated(point, points):
            dominated.append(point)
        else:
            frontier.append(point)

    return frontier, dominated


def _plot_pareto_tradeoff(
    summary_rows: list[dict],
    x_key: str,
    outpath: str | Path,
    title: str,
    xlabel: str,
) -> str:
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    fig, ax = plt.subplots(figsize=(8, 5))

    frontier, dominated = _compute_pareto_partition(summary_rows, x_key=x_key)

    if dominated:
        dx = [p["x"] for p in dominated]
        dy = [p["y"] for p in dominated]
        ax.scatter(dx, dy, s=70, alpha=0.45, color="gray", label="Dominated")

        for p in dominated:
            ax.annotate(
                p["method"],
                (p["x"], p["y"]),
                textcoords="offset points",
                xytext=(6, 6),
                color="dimgray",
            )

    if frontier:
        fx = [p["x"] for p in frontier]
        fy = [p["y"] for p in frontier]
        ax.scatter(fx, fy, s=90, alpha=0.95, color="crimson", label="Pareto frontier")

        for p in frontier:
            ax.annotate(
                p["method"],
                (p["x"], p["y"]),
                textcoords="offset points",
                xytext=(6, 6),
                color="crimson",
                fontweight="bold",
            )

        frontier_sorted = sorted(frontier, key=lambda p: (p["x"], p["y"]))
        if len(frontier_sorted) >= 2:
            ax.plot(
                [p["x"] for p in frontier_sorted],
                [p["y"] for p in frontier_sorted],
                linestyle="--",
                linewidth=1.4,
                alpha=0.7,
                color="crimson",
            )

    if frontier or dominated:
        ax.set_xlabel(xlabel)
        ax.set_ylabel("Failure Rate")
        ax.set_title(title)
        ax.grid(True, alpha=0.3)
        ax.legend()

        ys = [p["y"] for p in frontier + dominated]
        ymin = min(ys) if ys else 0.0
        ymax = max(ys) if ys else 0.0

        if ymin == ymax:
            pad = 0.05
            ax.set_ylim(max(0.0, ymin - pad), min(1.0, ymax + pad))
        else:
            pad = max(0.02, 0.1 * (ymax - ymin))
            ax.set_ylim(max(0.0, ymin - pad), min(1.0, ymax + pad))
    else:
        ax.text(0.5, 0.5, "No Pareto data available", ha="center", va="center", transform=ax.transAxes)
        ax.set_title(title)
        ax.set_axis_off()

    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return str(outpath)


def save_pareto_mean_vs_failure(summary_rows: list[dict], outpath: str | Path) -> str:
    return _plot_pareto_tradeoff(
        summary_rows=summary_rows,
        x_key="mean_iter",
        outpath=outpath,
        title="Pareto Tradeoff — Mean Iterations vs Failure Rate",
        xlabel="Mean Iterations",
    )


def save_pareto_median_vs_failure(summary_rows: list[dict], outpath: str | Path) -> str:
    return _plot_pareto_tradeoff(
        summary_rows=summary_rows,
        x_key="median_iter",
        outpath=outpath,
        title="Pareto Tradeoff — Median Iterations vs Failure Rate",
        xlabel="Median Iterations",
    )


def save_basin_entropy_summary(
    rows: list[dict],
    methods: list[str],
    outpath: str | Path,
    cluster_tol: float,
) -> dict:
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "cluster_tol": cluster_tol,
        "methods": [
            compute_basin_entropy(rows, method, cluster_tol=cluster_tol)
            for method in methods
        ],
    }

    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    return payload


def save_basin_entropy_comparison_plot(
    entropy_data: dict,
    outpath: str | Path,
) -> str:
    """
    Save a global basin entropy comparison plot across methods.
    x-axis: method
    y-axis: entropy
    """
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    rows = entropy_data.get("methods", []) or []
    methods = [str(row.get("method", "")) for row in rows]
    entropies = [_safe_float(row.get("entropy"), default=0.0) for row in rows]

    fig, ax = plt.subplots(figsize=(8.5, 5))

    if methods:
        bars = ax.bar(methods, entropies)
        ax.set_xlabel("Method")
        ax.set_ylabel("Basin Entropy")
        ax.set_title("Basin Entropy Comparison")
        ax.grid(True, axis="y", alpha=0.3)

        max_entropy = max(entropies) if entropies else 0.0
        upper = max(0.1, max_entropy * 1.15 if max_entropy > 0 else 1.0)
        ax.set_ylim(0, upper)

        for bar, value in zip(bars, entropies):
            ax.text(
                bar.get_x() + bar.get_width() / 2.0,
                bar.get_height() + upper * 0.02,
                f"{value:.4f}",
                ha="center",
                va="bottom",
                fontsize=9,
            )

        plt.setp(ax.get_xticklabels(), rotation=20, ha="right")
    else:
        ax.text(
            0.5,
            0.5,
            "No basin entropy data available",
            ha="center",
            va="center",
            transform=ax.transAxes,
        )
        ax.set_title("Basin Entropy Comparison")
        ax.set_axis_off()

    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return str(outpath)


def save_basin_distribution_plot(
    entropy_row: dict,
    outpath: str | Path,
) -> str:
    """
    Save a per-method basin distribution chart using basin_probabilities.
    Uses horizontal bars to avoid label overlap.
    """
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    probs = entropy_row.get("basin_probabilities", {}) or {}
    method = entropy_row.get("method", "method")

    fig, ax = plt.subplots(figsize=(8, 4.8))

    if probs:
        labels = list(probs.keys())
        values = [float(probs[k]) for k in labels]
        y = list(range(len(labels)))

        ax.barh(y, values)
        ax.set_yticks(y)
        ax.set_yticklabels(labels, fontsize=10)
        ax.set_xlim(0, 1.0)
        ax.set_xlabel("Basin Probability")
        ax.set_ylabel("Root Basin")
        ax.set_title(f"Basin Distribution — {method}")
        ax.grid(True, axis="x", alpha=0.3)

        for i, v in enumerate(values):
            ax.text(
                min(v + 0.02, 0.98),
                i,
                f"{v:.2f}",
                va="center",
                ha="left" if v < 0.9 else "right",
                fontsize=9,
            )

        ax.invert_yaxis()
        fig.subplots_adjust(left=0.22, bottom=0.16)
    else:
        ax.text(
            0.5,
            0.5,
            "No basin probability data available",
            ha="center",
            va="center",
            transform=ax.transAxes,
        )
        ax.set_title(f"Basin Distribution — {method}")
        ax.set_axis_off()

    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return str(outpath)


def save_comparison_summary(
    rows: list[dict],
    methods: list[str],
    outpath: str | Path,
) -> dict:
    outpath = Path(outpath)
    outpath.parent.mkdir(parents=True, exist_ok=True)

    method_set = {m.strip().lower() for m in methods}

    filtered_rows = [
        r for r in rows
        if str(r.get("method", "")).strip().lower() in method_set
    ]

    payload = {
        "total_runs": len(filtered_rows),
        "methods": [compute_method_summary(rows, method) for method in methods],
    }

    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    return payload


def generate_sweep_analytics(
    rows: list[dict],
    methods: list[str],
    outdir: str | Path,
    cluster_tol: float,
) -> dict:
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    histogram = {}
    ccdf = {}
    failure_region = {}
    initialization_histogram = {}
    initial_x_vs_root = {}
    initial_x_vs_iterations = {}

    for method in methods:
        hist_path = outdir / f"iterations_histogram_{method}.png"
        ccdf_path = outdir / f"iterations_ccdf_{method}.png"

        save_iteration_histogram(rows, method, hist_path)
        save_iteration_ccdf(rows, method, ccdf_path)

        histogram[method] = str(hist_path)
        ccdf[method] = str(ccdf_path)

        failure_path = outdir / f"failure_region_{method}.png"
        saved_failure_path = save_failure_region_plot(rows, method, failure_path)
        if saved_failure_path is not None:
            failure_region[method] = saved_failure_path

        init_hist_path = outdir / f"initialization_histogram_{method}.png"
        init_root_path = outdir / f"initial_x_vs_root_{method}.png"
        init_iter_path = outdir / f"initial_x_vs_iterations_{method}.png"

        saved_init_hist = save_initialization_histogram(rows, method, init_hist_path)
        saved_init_root = save_initial_x_vs_root_plot(rows, method, init_root_path)
        saved_init_iter = save_initial_x_vs_iterations_plot(rows, method, init_iter_path)

        if saved_init_hist is not None:
            initialization_histogram[method] = saved_init_hist

        if saved_init_root is not None:
            initial_x_vs_root[method] = saved_init_root

        if saved_init_iter is not None:
            initial_x_vs_iterations[method] = saved_init_iter

    summary_path = outdir / "comparison_summary.json"
    summary_data = save_comparison_summary(rows, methods, summary_path)

    pareto_mean_path = outdir / "pareto_mean_vs_failure.png"
    pareto_median_path = outdir / "pareto_median_vs_failure.png"

    save_pareto_mean_vs_failure(summary_data["methods"], pareto_mean_path)
    save_pareto_median_vs_failure(summary_data["methods"], pareto_median_path)

    entropy_path = outdir / "basin_entropy.json"
    entropy_data = save_basin_entropy_summary(
        rows,
        methods,
        entropy_path,
        cluster_tol=cluster_tol,
    )

    basin_entropy_plot_path = outdir / "basin_entropy_comparison.png"
    save_basin_entropy_comparison_plot(entropy_data, basin_entropy_plot_path)

    root_basin_stats_path = outdir / "root_basin_statistics.json"
    root_basin_stats_data = save_root_basin_statistics(
        rows,
        methods,
        root_basin_stats_path,
        cluster_tol=cluster_tol,
    )

    root_basin_statistics_plot = {}
    for method in methods:
        plot_path = outdir / f"root_basin_statistics_{method}.png"
        saved_plot = save_root_basin_statistics_plot(
            root_basin_stats_data,
            method,
            plot_path,
        )
        if saved_plot is not None:
            root_basin_statistics_plot[method] = saved_plot

    basin_distribution = {}
    for entropy_row in entropy_data.get("methods", []):
        method = str(entropy_row.get("method", "")).strip()
        if not method:
            continue
        dist_path = outdir / f"basin_distribution_{method}.png"
        save_basin_distribution_plot(entropy_row, dist_path)
        basin_distribution[method] = str(dist_path)

    root_distribution = {}
    for method in methods:
        path = plot_root_basin_distribution(rows, method, outdir, cluster_tol)
        if path:
            root_distribution[method] = path

    # ---------------------------------------------------------
    # Root coverage metric
    # ---------------------------------------------------------
    root_coverage_path = outdir / "root_coverage_summary.json"
    root_coverage_plot_path = outdir / "root_coverage_comparison.png"

    root_coverage_data = compute_root_coverage(rows, tol=cluster_tol)
    save_root_coverage_summary(root_coverage_path, root_coverage_data)
    plot_root_coverage(root_coverage_data, root_coverage_plot_path)

    return {
        "histogram": histogram,
        "ccdf": ccdf,
        "failure_region": failure_region,
        "initialization_histogram": initialization_histogram,
        "initial_x_vs_root": initial_x_vs_root,
        "initial_x_vs_iterations": initial_x_vs_iterations,
        "pareto": {
            "mean_vs_failure": str(pareto_mean_path),
            "median_vs_failure": str(pareto_median_path),
        },
        "basin_entropy": str(entropy_path),
        "basin_entropy_data": entropy_data,
        "basin_entropy_plot": str(basin_entropy_plot_path),
        "basin_distribution": basin_distribution,
        "comparison_summary": str(summary_path),
        "comparison_summary_data": summary_data,
        "basin_root_distribution": root_distribution,
        "root_basin_statistics": str(root_basin_stats_path),
        "root_basin_statistics_data": root_basin_stats_data,
        "root_basin_statistics_plot": root_basin_statistics_plot,
        "root_coverage_summary": str(root_coverage_path),
        "root_coverage_data": root_coverage_data,
        "root_coverage_plot": str(root_coverage_plot_path),
    }