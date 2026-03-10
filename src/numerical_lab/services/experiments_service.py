from __future__ import annotations

import csv
import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple
from dataclasses import asdict

from numerical_lab.analytics.sweep_analytics import generate_sweep_analytics
from numerical_lab.services.experiment_jobs import update_job
from numerical_lab.experiments import sweep as sweep_module
from numerical_lab.experiments import detect_basin_boundaries as boundary_module


def _find_problem(problem_id: str):
    return sweep_module.get_default_problem(problem_id)


def _parse_range(
    value: Any,
    *,
    fallback_min: float = -4.0,
    fallback_max: float = 4.0,
) -> Tuple[float, float]:
    """
    Accepts:
    - list/tuple: [xmin, xmax]
    - dict: {"x_min": ..., "x_max": ...}
    - None: fallback range
    """
    if value is None:
        return float(fallback_min), float(fallback_max)

    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return float(value[0]), float(value[1])

    if isinstance(value, dict):
        x_min = value.get("x_min", fallback_min)
        x_max = value.get("x_max", fallback_max)
        return float(x_min), float(x_max)

    raise ValueError("Range must be either a 2-element list/tuple or a dict with x_min/x_max")


def _build_custom_problem(payload: Dict[str, Any]):
    expr = str(payload.get("expr", "")).strip()
    if not expr:
        raise ValueError("Custom problem requires expr")

    raw_dexpr = payload.get("dexpr", None)
    dexpr = str(raw_dexpr).strip() if raw_dexpr is not None and str(raw_dexpr).strip() else None

    x_min = payload.get("x_min", -4.0)
    x_max = payload.get("x_max", 4.0)

    scalar_range = _parse_range(
        payload.get("scalar_range"),
        fallback_min=float(x_min),
        fallback_max=float(x_max),
    )

    secant_range = _parse_range(
        payload.get("secant_range"),
        fallback_min=scalar_range[0],
        fallback_max=scalar_range[1],
    )

    bracket_search_range = _parse_range(
        payload.get("bracket_search_range"),
        fallback_min=scalar_range[0],
        fallback_max=scalar_range[1],
    )

    if scalar_range[0] >= scalar_range[1]:
        raise ValueError("scalar_range must satisfy x_min < x_max")

    if secant_range[0] >= secant_range[1]:
        raise ValueError("secant_range must satisfy x_min < x_max")

    if bracket_search_range[0] >= bracket_search_range[1]:
        raise ValueError("bracket_search_range must satisfy x_min < x_max")

    return sweep_module.SweepProblem(
        problem_id="custom",
        expr=expr,
        dexpr=dexpr,
        scalar_range=scalar_range,
        secant_range=secant_range,
        bracket_search_range=bracket_search_range,
    )


def _create_job_output_folder(base: str = "outputs/sweeps") -> Path:
    base_path = Path(base)
    base_path.mkdir(parents=True, exist_ok=True)

    ts = time.strftime("%Y%m%d_%H%M%S")
    folder = base_path / f"sweep_{ts}"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _compute_cluster_tol(problem, n_points: int, tol: float) -> float:
    try:
        a, b = problem.scalar_range
        a = float(a)
        b = float(b)
        if n_points >= 2:
            grid_spacing = abs(b - a) / (n_points - 1)
        else:
            grid_spacing = abs(b - a)
    except Exception:
        grid_spacing = 0.0

    return max(10.0 * float(tol), 0.25 * float(grid_spacing))


def run_sweep_job(job_id: str, payload: Dict[str, Any]) -> None:
    try:
        update_job(
            job_id,
            status="running",
            started_at=time.time(),
            progress=0.05,
            message="Starting sweep",
        )

        problem_mode = str(payload.get("problem_mode", "benchmark")).strip().lower()
        boundary_method = str(payload.get("boundary_method", "newton")).strip().lower()

        n_points = int(payload.get("n_points", 100))
        max_iter = int(payload.get("max_iter", 100))
        tol = float(payload.get("tol", 1e-10))
        methods_requested = sweep_module.normalize_methods(payload.get("methods"))

        print("DEBUG CWD:", Path.cwd())
        print("DEBUG PAYLOAD:", payload)

        if problem_mode == "custom":
            problem = _build_custom_problem(payload)
        else:
            problem_id = payload.get("problem_id") or "p4"
            problem = _find_problem(problem_id)

        print("DEBUG SELECTED PROBLEM:", problem.problem_id, problem.expr)

        update_job(
            job_id,
            progress=0.15,
            message=f"Running problem sweep for {problem.problem_id}",
        )

        records = sweep_module.run_problem_sweeps(
            problem=problem,
            methods=methods_requested,
            scalar_points=n_points,
            secant_points=n_points,
            bracket_points=n_points,
            tol=tol,
            max_iter=max_iter,
        )

        update_job(
            job_id,
            progress=0.55,
            message="Sweep finished, saving outputs",
        )

        sweep_path = _create_job_output_folder()

        records_csv_path = sweep_path / "records.csv"
        records_json_path = sweep_path / "records.json"
        summary_json_path = sweep_path / "summary.json"
        metadata_json_path = sweep_path / "metadata.json"

        sweep_module.records_to_csv(records, records_csv_path)
        sweep_module.records_to_json(records, records_json_path)

        summary = sweep_module.summarize_records(records, max_iter=max_iter)
        sweep_module.summary_to_json(summary, summary_json_path)

        methods_present = sorted({r.method for r in records if getattr(r, "method", None)})
        methods_to_use = [m for m in methods_requested if m in methods_present]
        if not methods_to_use:
            methods_to_use = methods_present

        cluster_tol = _compute_cluster_tol(problem, n_points=n_points, tol=tol)

        analytics_dir = sweep_path / problem.problem_id
        analytics = generate_sweep_analytics(
            rows=[asdict(r) for r in records],
            methods=methods_to_use,
            outdir=analytics_dir,
            cluster_tol=cluster_tol,
        )

        metadata = {
            "problem_mode": problem_mode,
            "problem_id": problem.problem_id,
            "expr": problem.expr,
            "dexpr": problem.dexpr,
            "scalar_range": list(problem.scalar_range),
            "secant_range": list(problem.secant_range),
            "bracket_search_range": list(problem.bracket_search_range),
            "n_points": n_points,
            "tol": tol,
            "max_iter": max_iter,
            "methods_requested": methods_requested,
            "methods_used": methods_to_use,
            "cluster_tol": cluster_tol,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        with open(metadata_json_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)

        update_job(
            job_id,
            progress=0.75,
            message="Detecting basin boundaries",
        )

        boundaries = []
        boundary_summary = None
        boundary_cluster_tol = None
        raw_boundaries = []
        if hasattr(boundary_module, "detect_boundaries"):
            with open(records_csv_path, newline="", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))

            subset = [
                r
                for r in rows
                if (r.get("problem_id") or "").strip().lower() == str(problem.problem_id).lower()
                and (r.get("method") or "").strip().lower() == str(boundary_method).lower()
            ]
            boundaries_info = boundary_module.detect_boundaries(subset, return_mode="full")
            boundaries = boundaries_info["clustered"]
            boundary_summary = boundaries_info["summary"]
            boundary_cluster_tol = boundaries_info["cluster_tol"]
            raw_boundaries = boundaries_info["raw"]
            update_job(
                job_id,
                progress=0.9,
                message="Generating basin map",
            )

            try:
                from numerical_lab.experiments.plot_basin_map import (
                    plot_basin_map,
                    load_rows,
                    extract_problem_method_rows,
                )

                rows = load_rows(records_csv_path)
                matched = extract_problem_method_rows(rows, problem.problem_id, boundary_method)

                if matched:
                    plot_basin_map(
                        rows=matched,
                        problem_id=problem.problem_id,
                        method=boundary_method,
                        output_dir=sweep_path,
                    )
            except Exception as e:
                print(f"[warn] basin map generation failed: {e}")

        basin_map_path = sweep_path / f"basin_map_{problem.problem_id}_{boundary_method}.png"
        if not basin_map_path.exists():
            fallback_basin_map = sweep_path / "basin_map.png"
            basin_map_path = fallback_basin_map if fallback_basin_map.exists() else None

        analytics_base_url = f"/outputs/sweeps/{sweep_path.name}/{problem.problem_id}"

        result = {
            "latest_sweep_dir": str(sweep_path).replace("\\", "/"),
            "records_csv": f"/outputs/sweeps/{sweep_path.name}/records.csv",
            "records_json": f"/outputs/sweeps/{sweep_path.name}/records.json",
            "summary_json": f"/outputs/sweeps/{sweep_path.name}/summary.json",
            "metadata_json": f"/outputs/sweeps/{sweep_path.name}/metadata.json",
            "problem_mode": problem_mode,
            "problem_id": problem.problem_id,
            "boundary_method": boundary_method,
            "boundaries": boundaries,
            "boundary_summary": boundary_summary,
            "boundary_cluster_tol": boundary_cluster_tol,
            "raw_boundaries": raw_boundaries,
            "artifacts": {
                "basin_map": (
                    f"/outputs/sweeps/{sweep_path.name}/{basin_map_path.name}"
                    if basin_map_path is not None and basin_map_path.exists()
                    else None
                ),
                "analytics": {
                    problem.problem_id: {
                        "histogram": {
                            method: f"{analytics_base_url}/iterations_histogram_{method}.png"
                            for method in analytics.get("histogram", {}).keys()
                        },
                        "ccdf": {
                            method: f"{analytics_base_url}/iterations_ccdf_{method}.png"
                            for method in analytics.get("ccdf", {}).keys()
                        },
                        "failure_region": {
                            method: f"{analytics_base_url}/failure_region_{method}.png"
                            for method in analytics.get("failure_region", {}).keys()
                        },
                        "pareto": {
                            "mean_vs_failure": f"{analytics_base_url}/pareto_mean_vs_failure.png"
                            if analytics.get("pareto", {}).get("mean_vs_failure")
                            else None,
                            "median_vs_failure": f"{analytics_base_url}/pareto_median_vs_failure.png"
                            if analytics.get("pareto", {}).get("median_vs_failure")
                            else None,
                        },
                        "basin_entropy": f"{analytics_base_url}/basin_entropy.json"
                        if analytics.get("basin_entropy")
                        else None,
                        "basin_entropy_data": analytics.get("basin_entropy_data"),
                        "basin_distribution": {
                            method: f"{analytics_base_url}/basin_distribution_{method}.png"
                            for method in analytics.get("basin_distribution", {}).keys()
                        },
                        "comparison_summary": f"{analytics_base_url}/comparison_summary.json"
                        if analytics.get("comparison_summary")
                        else None,
                        "comparison_summary_data": analytics.get("comparison_summary_data"),
                    }
                },
            },
        }

        update_job(
            job_id,
            status="completed",
            finished_at=time.time(),
            progress=1.0,
            message="Experiment completed",
            result=result,
        )

    except Exception as e:
        update_job(
            job_id,
            status="failed",
            finished_at=time.time(),
            error=str(e),
            message="Experiment failed",
        )


def start_sweep_job(job_id: str, payload: Dict[str, Any]) -> None:
    t = threading.Thread(target=run_sweep_job, args=(job_id, payload), daemon=True)
    t.start()