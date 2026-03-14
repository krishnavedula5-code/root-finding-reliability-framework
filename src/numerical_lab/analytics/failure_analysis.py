from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt


FAILURE_STATUS_NAMES = {
    "max_iter",
    "derivative_zero",
    "stagnation",
    "nan_or_inf",
    "bad_bracket",
    "error",
    "failed",
}

BOOLEAN_FAILURE_FLAGS = {
    "has_derivative_zero": "derivative_zero_flag_count",
    "has_stagnation": "stagnation_flag_count",
    "has_nonfinite": "nonfinite_flag_count",
    "has_bad_bracket": "bad_bracket_flag_count",
}

STATUS_COLOR = {
    "converged": "green",
    "max_iter": "red",
    "derivative_zero": "orange",
    "stagnation": "purple",
    "nan_or_inf": "black",
    "bad_bracket": "brown",
    "error": "gray",
    "failed": "red",
    "unknown": "blue",
}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    text = str(value).strip().lower()
    return text in {"true", "1", "yes", "y"}


def _load_rows(records_csv: Path) -> List[Dict[str, str]]:
    with open(records_csv, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _normalize_status(row: Dict[str, str]) -> str:
    status = (row.get("status") or "").strip().lower()
    stop_reason = (row.get("stop_reason") or "").strip().lower()

    if status:
        return status

    if stop_reason in {"tol_f", "tol_x", "tol_bracket", "converged"}:
        return "converged"
    if stop_reason in {"max_iter", "max_iterations"}:
        return "max_iter"
    if stop_reason in {"derivative_zero", "zero_derivative"}:
        return "derivative_zero"
    if stop_reason in {"stagnation"}:
        return "stagnation"
    if stop_reason in {"nan_or_inf", "nonfinite", "non_finite"}:
        return "nan_or_inf"
    if stop_reason in {"bad_bracket"}:
        return "bad_bracket"
    if stop_reason in {"error", "exception"}:
        return "error"

    return "unknown"


def _is_failure_status(status: str) -> bool:
    return status in FAILURE_STATUS_NAMES


def _plot_failure_map(
    *,
    method: str,
    rows: List[Dict[str, str]],
    output_dir: Path,
) -> str | None:
    """
    1D failure map:
    x-axis = x0
    y-axis = 0 (constant strip)
    point color = normalized status
    """
    if not rows:
        return None

    grouped_x: Dict[str, List[float]] = defaultdict(list)
    grouped_y: Dict[str, List[float]] = defaultdict(list)

    for row in rows:
        x0 = row.get("x0")
        if x0 is None or str(x0).strip() == "":
            continue

        x = _safe_float(x0)
        status = _normalize_status(row)
        grouped_x[status].append(x)
        grouped_y[status].append(0.0)

    total_points = sum(len(v) for v in grouped_x.values())
    if total_points == 0:
        return None

    fig, ax = plt.subplots(figsize=(10, 2.6))

    ordered_statuses = [
        "converged",
        "max_iter",
        "derivative_zero",
        "stagnation",
        "nan_or_inf",
        "bad_bracket",
        "error",
        "failed",
        "unknown",
    ]

    plotted_any = False
    for status in ordered_statuses:
        xs = grouped_x.get(status, [])
        ys = grouped_y.get(status, [])
        if not xs:
            continue

        ax.scatter(
            xs,
            ys,
            s=28,
            alpha=0.85,
            label=f"{status} ({len(xs)})",
            color=STATUS_COLOR.get(status, "blue"),
            edgecolors="none",
        )
        plotted_any = True

    if not plotted_any:
        plt.close(fig)
        return None

    ax.set_title(f"Failure map for {method}")
    ax.set_xlabel("Initial guess x0")
    ax.set_yticks([])
    ax.set_ylim(-0.5, 0.5)
    ax.grid(True, axis="x", alpha=0.25)

    handles, labels = ax.get_legend_handles_labels()
    if handles:
        ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.28), ncol=3, frameon=False)

    fig.tight_layout()

    output_path = output_dir / f"failure_map_{method}.png"
    fig.savefig(output_path, dpi=160, bbox_inches="tight")
    plt.close(fig)

    return output_path.name


def _plot_failure_density(
    *,
    method: str,
    rows: List[Dict[str, str]],
    output_dir: Path,
    bins: int = 30,
) -> str | None:
    """
    1D failure density plot:
    x-axis = x0
    y-axis = failure count per bin

    This uses only failure-status rows. If there are no failures,
    it still generates a valid flat plot so the artifact pipeline
    remains consistent across methods.
    """
    xs_all: List[float] = []
    xs_fail: List[float] = []

    for row in rows:
        x0 = row.get("x0")
        if x0 is None or str(x0).strip() == "":
            continue

        x = _safe_float(x0)
        xs_all.append(x)

        status = _normalize_status(row)
        if status != "converged":
            xs_fail.append(x)

    if not xs_all:
        return None

    x_min = min(xs_all)
    x_max = max(xs_all)

    if x_min == x_max:
        x_min -= 0.5
        x_max += 0.5

    fig, ax = plt.subplots(figsize=(10, 3.2))

    if xs_fail:
        ax.hist(xs_fail, bins=bins, range=(x_min, x_max), alpha=0.9)
        ax.set_title(f"Failure density for {method}")
        ax.set_ylabel("Failure count")
    else:
        # Keep artifact generation consistent even for no-failure runs.
        ax.hist([], bins=bins, range=(x_min, x_max))
        ax.set_title(f"Failure density for {method} (no failures)")
        ax.set_ylabel("Failure count")

    ax.set_xlabel("Initial guess x0")
    ax.set_xlim(x_min, x_max)
    ax.grid(True, axis="y", alpha=0.25)

    fig.tight_layout()

    output_path = output_dir / f"failure_density_{method}.png"
    fig.savefig(output_path, dpi=160, bbox_inches="tight")
    plt.close(fig)

    return output_path.name


def generate_failure_statistics(records_csv: str | Path, output_dir: str | Path) -> Dict[str, Any]:
    """
    Read sweep records.csv and generate per-method failure statistics.

    Outputs:
        output_dir / "failure_statistics.json"
        output_dir / "failure_map_<method>.png"
        output_dir / "failure_density_<method>.png"

    Returns:
        The generated statistics dictionary.
    """
    records_csv = Path(records_csv)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = _load_rows(records_csv)

    per_method: Dict[str, Dict[str, Any]] = {}
    status_counter_by_method: Dict[str, Counter] = defaultdict(Counter)
    stop_reason_counter_by_method: Dict[str, Counter] = defaultdict(Counter)
    rows_by_method: Dict[str, List[Dict[str, str]]] = defaultdict(list)

    for row in rows:
        method = (row.get("method") or "unknown").strip().lower()
        status = _normalize_status(row)
        stop_reason = (row.get("stop_reason") or "").strip() or "unknown"

        rows_by_method[method].append(row)

        if method not in per_method:
            per_method[method] = {
                "method": method,
                "total_runs": 0,
                "converged_runs": 0,
                "failed_runs": 0,
                "success_rate": 0.0,
                "failure_rate": 0.0,
                "mean_iterations_all": 0.0,
                "mean_iterations_converged": 0.0,
                "status_counts": {},
                "stop_reason_counts": {},
                "failure_counts": {
                    "max_iter": 0,
                    "derivative_zero": 0,
                    "stagnation": 0,
                    "nan_or_inf": 0,
                    "bad_bracket": 0,
                    "error": 0,
                    "failed": 0,
                    "unknown": 0,
                },
                "flag_counts": {
                    "derivative_zero_flag_count": 0,
                    "stagnation_flag_count": 0,
                    "nonfinite_flag_count": 0,
                    "bad_bracket_flag_count": 0,
                },
                "root_convergence_counts": {},
                "artifacts": {
                    "failure_map": None,
                    "failure_density": None,
                },
            }

        stats = per_method[method]
        stats["total_runs"] += 1

        iterations = _safe_int(row.get("iterations"), default=0)
        stats.setdefault("_iterations_all", []).append(iterations)

        if status == "converged":
            stats["converged_runs"] += 1
            stats.setdefault("_iterations_converged", []).append(iterations)
        else:
            stats["failed_runs"] += 1

        status_counter_by_method[method][status] += 1
        stop_reason_counter_by_method[method][stop_reason] += 1

        if _is_failure_status(status):
            stats["failure_counts"][status] = stats["failure_counts"].get(status, 0) + 1
        elif status != "converged":
            stats["failure_counts"]["unknown"] += 1

        for field_name, target_name in BOOLEAN_FAILURE_FLAGS.items():
            if _to_bool(row.get(field_name)):
                stats["flag_counts"][target_name] += 1

        if status == "converged":
            root_id = (row.get("root_id") or "").strip()
            root_key = root_id if root_id != "" else "unknown_root"
            root_counts = stats["root_convergence_counts"]
            root_counts[root_key] = root_counts.get(root_key, 0) + 1

    summary: Dict[str, Any] = {
        "records_csv": str(records_csv),
        "total_rows": len(rows),
        "methods": {},
    }

    for method, stats in per_method.items():
        total_runs = stats["total_runs"]
        converged_runs = stats["converged_runs"]
        failed_runs = stats["failed_runs"]

        iterations_all = stats.pop("_iterations_all", [])
        iterations_converged = stats.pop("_iterations_converged", [])

        stats["success_rate"] = (converged_runs / total_runs) if total_runs else 0.0
        stats["failure_rate"] = (failed_runs / total_runs) if total_runs else 0.0
        stats["mean_iterations_all"] = (
            sum(iterations_all) / len(iterations_all) if iterations_all else 0.0
        )
        stats["mean_iterations_converged"] = (
            sum(iterations_converged) / len(iterations_converged) if iterations_converged else 0.0
        )

        stats["status_counts"] = dict(status_counter_by_method[method])
        stats["stop_reason_counts"] = dict(stop_reason_counter_by_method[method])

        failure_map_name = _plot_failure_map(
            method=method,
            rows=rows_by_method.get(method, []),
            output_dir=output_dir,
        )
        stats["artifacts"]["failure_map"] = failure_map_name

        failure_density_name = _plot_failure_density(
            method=method,
            rows=rows_by_method.get(method, []),
            output_dir=output_dir,
            bins=30,
        )
        stats["artifacts"]["failure_density"] = failure_density_name

        summary["methods"][method] = stats

    output_path = output_dir / "failure_statistics.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    return summary


if __name__ == "__main__":
    default_records = Path("outputs/sweeps/latest/records.csv")
    default_output = Path("outputs/sweeps/latest/analytics")

    if default_records.exists():
        result = generate_failure_statistics(default_records, default_output)
        print(json.dumps(result, indent=2))
    else:
        print(f"Records file not found: {default_records}")