from __future__ import annotations

import math
from collections import Counter, defaultdict
from statistics import mean, median
from typing import Any, Dict, List, Optional


def _safe_float(x: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _normal_95_half_width(p: float, n: int) -> float:
    if n <= 0:
        return 0.0
    return 1.96 * math.sqrt(max(p * (1.0 - p), 0.0) / n)


def _cluster_sorted_values(values: List[float], tol: float) -> List[List[float]]:
    if not values:
        return []

    vals = sorted(values)
    clusters: List[List[float]] = [[vals[0]]]

    for v in vals[1:]:
        if abs(v - clusters[-1][-1]) <= tol:
            clusters[-1].append(v)
        else:
            clusters.append([v])

    return clusters


def _cluster_root_counts(rows: List[Dict[str, Any]], tol: float) -> Dict[str, int]:
    numeric_roots: List[float] = []
    non_numeric_counter = Counter()

    for r in rows:
        root_val = r.get("root")
        if root_val is None or root_val == "":
            non_numeric_counter["unknown"] += 1
            continue

        root_float = _safe_float(root_val)
        if root_float is None:
            non_numeric_counter[str(root_val)] += 1
        else:
            numeric_roots.append(root_float)

    clustered_counter: Dict[str, int] = {}

    for cluster in _cluster_sorted_values(numeric_roots, tol):
        center = sum(cluster) / len(cluster)
        label = f"{round(center, 3):g}"
        clustered_counter[label] = len(cluster)

    for k, v in non_numeric_counter.items():
        clustered_counter[k] = clustered_counter.get(k, 0) + v

    return clustered_counter


def summarize_monte_carlo_records(
    rows: List[Dict[str, Any]],
    root_cluster_tol: float = 1e-3,
) -> Dict[str, Any]:
    """
    Build per-method Monte Carlo summary statistics.

    Expected row fields include:
    - method
    - status
    - iterations
    - root
    - report_label
    - stability_label
    """

    by_method: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        method = str(row.get("method", "unknown"))
        by_method[method].append(row)

    methods_summary: Dict[str, Any] = {}

    for method, method_rows in by_method.items():
        n = len(method_rows)
        converged_rows = [
            r for r in method_rows
            if str(r.get("status", "")).lower() == "converged"
        ]
        failures = [
            r for r in method_rows
            if str(r.get("status", "")).lower() != "converged"
        ]

        success_count = len(converged_rows)
        failure_count = len(failures)
        p = success_count / n if n > 0 else 0.0
        hw = _normal_95_half_width(p, n)

        converged_iterations = [
            _safe_float(r.get("iterations"))
            for r in converged_rows
            if _safe_float(r.get("iterations")) is not None
        ]

        all_iterations = [
            _safe_float(r.get("iterations"))
            for r in method_rows
            if _safe_float(r.get("iterations")) is not None
        ]

        status_counts = Counter(str(r.get("status", "unknown")) for r in method_rows)
        report_counts = Counter(str(r.get("report_label", "unknown")) for r in method_rows)
        stability_counts = Counter(str(r.get("stability_label", "unknown")) for r in method_rows)

        root_counter = _cluster_root_counts(converged_rows, tol=root_cluster_tol)

        methods_summary[method] = {
            "samples": n,
            "success_count": success_count,
            "failure_count": failure_count,
            "success_probability": p,
            "confidence_interval_95": [
                max(0.0, p - hw),
                min(1.0, p + hw),
            ],
            "mean_iterations_converged": (
                mean(converged_iterations) if converged_iterations else None
            ),
            "median_iterations_converged": (
                median(converged_iterations) if converged_iterations else None
            ),
            "mean_iterations_all": mean(all_iterations) if all_iterations else None,
            "median_iterations_all": median(all_iterations) if all_iterations else None,
            "status_counts": dict(status_counts),
            "report_counts": dict(report_counts),
            "stability_counts": dict(stability_counts),
            "root_counts": dict(root_counter),
            "root_coverage_count": len(root_counter),
            "root_cluster_tol": root_cluster_tol,
        }

    overall = {
        "n_methods": len(methods_summary),
        "root_cluster_tol": root_cluster_tol,
        "methods": methods_summary,
    }

    return overall