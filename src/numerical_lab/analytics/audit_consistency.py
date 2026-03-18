from __future__ import annotations

from typing import Any, Dict, List, Optional


def _safe_float(x: Any) -> Optional[float]:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _add_issue(
    issues: List[Dict[str, Any]],
    code: str,
    severity: str,
    message: str,
) -> None:
    issues.append(
        {
            "code": code,
            "severity": severity,
            "message": message,
        }
    )


def _final_status(issues: List[Dict[str, Any]]) -> str:
    if any(i.get("severity") == "suspicious" for i in issues):
        return "suspicious"
    if any(i.get("severity") == "warning" for i in issues):
        return "warning"
    return "ok"


def audit_consistency(
    *,
    benchmark_id: Optional[str],
    benchmark_name: Optional[str],
    benchmark_category: Optional[str],
    known_roots: Optional[List[float]],
    comparison_summary_data: Optional[Dict[str, Any]],
    root_coverage_data: Optional[Dict[str, Any]],
    root_basin_statistics_data: Optional[Dict[str, Any]],
    basin_entropy_data: Optional[Dict[str, Any]],
    failure_statistics_data: Optional[Dict[str, Any]],
    interpretation_summary_data: Optional[Dict[str, Any]],
    problem_expectations_data: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    issues: List[Dict[str, Any]] = []

    known_roots = known_roots or []

    # ---------------------------------------------------------
    # A. comparison summary sanity
    # ---------------------------------------------------------
    methods = (comparison_summary_data or {}).get("methods", []) or []
    success_rates: List[float] = []

    for row in methods:
        method = row.get("method", "unknown")

        sr = _safe_float(row.get("success_rate"))
        if sr is not None:
            success_rates.append(sr)
            if sr < 0 or sr > 1:
                _add_issue(
                    issues,
                    "success_rate_out_of_range",
                    "suspicious",
                    f"{method} has success_rate={sr}, outside [0,1].",
                )

        failure_count = _safe_float(row.get("failure_count"))
        if failure_count is not None and failure_count < 0:
            _add_issue(
                issues,
                "negative_failure_count",
                "suspicious",
                f"{method} has negative failure_count={failure_count}.",
            )

        mean_iter = _safe_float(row.get("mean_iter"))
        if mean_iter is not None and mean_iter < 0:
            _add_issue(
                issues,
                "negative_mean_iterations",
                "suspicious",
                f"{method} has negative mean_iter={mean_iter}.",
            )

    if success_rates and len(success_rates) > 1:
        if max(success_rates) - min(success_rates) < 1e-12:
            _add_issue(
                issues,
                "ranking_degenerate",
                "warning",
                "All methods have essentially identical success rates; ranking by success alone is not informative.",
            )

    # ---------------------------------------------------------
    # B. root coverage sanity
    # ---------------------------------------------------------
    global_roots = (root_coverage_data or {}).get("global_roots", []) or []
    solver_cov = (root_coverage_data or {}).get("solvers", {}) or {}

    # NEW: benchmark-vs-detected root count consistency
    if isinstance(known_roots, list) and known_roots:
        detected_count = len(global_roots)
        expected_count = len(known_roots)

        if detected_count > expected_count * 2:
            _add_issue(
                issues,
                "excess_root_detection",
                "suspicious",
                f"Detected {detected_count} roots, but benchmark specifies {expected_count} known roots. This suggests root clustering or grouping issues.",
            )
        elif detected_count > expected_count:
            _add_issue(
                issues,
                "root_overcount",
                "warning",
                f"Detected {detected_count} roots vs {expected_count} expected. Possible minor clustering fragmentation.",
            )

    for solver, info in solver_cov.items():
        coverage = _safe_float(info.get("coverage"))
        roots_found = info.get("roots_found")
        total_roots = info.get("total_roots")

        if coverage is not None and (coverage < 0 or coverage > 1):
            _add_issue(
                issues,
                "coverage_out_of_range",
                "suspicious",
                f"{solver} has coverage={coverage}, outside [0,1].",
            )

        if isinstance(roots_found, int) and isinstance(total_roots, int):
            if roots_found > total_roots:
                _add_issue(
                    issues,
                    "roots_found_exceeds_total_roots",
                    "suspicious",
                    f"{solver} reports roots_found={roots_found} > total_roots={total_roots}.",
                )

    # single-root benchmark fragmentation checks
    entropy_methods = (basin_entropy_data or {}).get("methods", []) or []
    if len(known_roots) == 1:
        for row in entropy_methods:
            method = row.get("method", "unknown")
            num_basins = row.get("num_basins")
            entropy = _safe_float(row.get("entropy"))

            if isinstance(num_basins, int) and num_basins > 1:
                _add_issue(
                    issues,
                    "single_root_multiple_basins",
                    "warning",
                    f"{method} shows num_basins={num_basins} for a benchmark with one known root.",
                )

            if entropy is not None and entropy > 1e-6:
                _add_issue(
                    issues,
                    "single_root_positive_entropy",
                    "warning",
                    f"{method} shows entropy={entropy:.6g} for a benchmark with one known root.",
                )

    # ---------------------------------------------------------
    # C. structural applicability checks
    # ---------------------------------------------------------
    interpretation = interpretation_summary_data or {}
    top_summary = interpretation.get("top_summary", []) or []
    top_text = " ".join(str(x) for x in top_summary).lower()

    if benchmark_id and str(benchmark_id).startswith("multi_"):
        if (
            "linear" not in top_text
            and "repeated root" not in top_text
            and "multiplicity" not in top_text
        ):
            _add_issue(
                issues,
                "missing_repeated_root_interpretation",
                "warning",
                "Repeated-root benchmark detected, but interpretation does not explicitly mention repeated-root effects or degraded Newton convergence.",
            )

    # ---------------------------------------------------------
    # D. analytic-vs-observed mismatch
    # ---------------------------------------------------------
    newton_path = (
        (interpretation_summary_data or {}).get("newton_pathology_interpretation")
        or {}
    )
    newton_message = str(newton_path.get("message", "")).lower()

    if "high" in newton_message:
        newton_row = next((r for r in methods if r.get("method") == "newton"), None)
        if newton_row is not None:
            sr = _safe_float(newton_row.get("success_rate"))
            failures = _safe_float(newton_row.get("failure_count"))
            if sr == 1.0 and failures == 0:
                _add_issue(
                    issues,
                    "analytic_observed_newton_mismatch",
                    "warning",
                    "Analytic Newton risk is high, but observed Newton runs show perfect success; interpretation should frame this as a mismatch, not direct instability evidence.",
                )

    # ---------------------------------------------------------
    # E. interpretation overclaiming
    # ---------------------------------------------------------
    failure_interp = (
        (interpretation_summary_data or {}).get("failure_interpretation") or {}
    )
    global_notes = failure_interp.get("global_notes", []) or []
    global_failure_text = " ".join(str(x) for x in global_notes).lower()

    no_failures_all = True
    for row in methods:
        fc = _safe_float(row.get("failure_count"))
        if fc is None or fc > 0:
            no_failures_all = False
            break

    if no_failures_all and any(
        token in global_failure_text
        for token in ["instability", "unstable", "pathological", "stagnation"]
    ):
        _add_issue(
            issues,
            "interpretation_not_conditioned",
            "warning",
            "Interpretation uses instability/pathology language despite zero observed failures across methods.",
        )

    status = _final_status(issues)

    if status == "ok":
        summary = "No major consistency issues detected."
    elif status == "warning":
        summary = "Results are numerically plausible, but some interpretation, applicability, or ranking issues require caution."
    else:
        summary = "One or more suspicious internal inconsistencies were detected."

    return {
        "status": status,
        "issues": issues,
        "summary": summary,
        "benchmark_id": benchmark_id,
        "benchmark_name": benchmark_name,
        "benchmark_category": benchmark_category,
        "known_root_count": len(known_roots),
        "global_root_count_detected": len(global_roots),
    }