from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List
from numerical_lab.analytics.audit_consistency import audit_consistency
from numerical_lab.analytics.interpretation_confidence import (
    build_method_interpretation_confidence,
)


BRACKET_METHODS = {"bisection", "brent", "hybrid", "safeguarded_newton"}
OPEN_METHODS = {"newton", "secant"}


def _safe_get(d: Dict[str, Any], *keys: str, default: Any = None) -> Any:
    cur: Any = d
    for key in keys:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur


def _get_newton_pathology(expectations: Dict[str, Any]) -> Dict[str, Any]:
    data = _safe_get(expectations, "analytic_checks", "newton_pathology", default={})
    return data if isinstance(data, dict) else {}


def _classify_match(expected: str, observed: str, status: str) -> Dict[str, str]:
    return {
        "status": status,
        "expected": expected,
        "observed": observed,
    }


def _root_coverage_interpretation(
    expectations: Dict[str, Any],
    analytics: Dict[str, Any],
    failure_analysis: Dict[str, Any],
) -> Dict[str, Any]:
    expected_root_count = _safe_get(
        expectations, "analytic_checks", "root_candidate_count", default=0
    )

    sign_change_count = _safe_get(
        expectations, "analytic_checks", "sign_change_interval_count", default=0
    )

    raw_sign_change_count = _safe_get(
        expectations,
        "analytic_checks",
        "raw_sign_change_interval_count",
        default=sign_change_count,
    )

    root_coverage_data = analytics.get("root_coverage_data") or {}
    methods_summary = root_coverage_data.get("solvers") or {}

    per_method: Dict[str, Any] = {}
    comparison_notes: List[str] = []

    for method, info in methods_summary.items():
        discovered = int(info.get("roots_found", 0))
        coverage_ratio = info.get("coverage", None)

        if method in OPEN_METHODS:
            if expected_root_count > 0:
                if discovered >= expected_root_count:
                    per_method[method] = _classify_match(
                        expected=f"Open method could plausibly access about {expected_root_count} root candidate region(s).",
                        observed=f"{method} discovered {discovered} root(s), coverage={coverage_ratio}.",
                        status="matched",
                    )
                else:
                    per_method[method] = _classify_match(
                        expected=f"Open method could plausibly access about {expected_root_count} root candidate region(s).",
                        observed=f"{method} discovered only {discovered} root(s), coverage={coverage_ratio}.",
                        status="partial",
                    )
            else:
                per_method[method] = _classify_match(
                    expected="Open-method root coverage was analytically unclear.",
                    observed=f"{method} discovered {discovered} root(s), coverage={coverage_ratio}.",
                    status="observed_only",
                )

        elif method in BRACKET_METHODS:
            if expected_root_count > sign_change_count:
                if discovered <= sign_change_count:
                    per_method[method] = _classify_match(
                        expected=(
                            f"Bracket method was expected to access at most about {sign_change_count} sign-change-accessible root region(s) "
                            f"(raw sampled detection found {raw_sign_change_count}), "
                            f"with possible undercoverage relative to {expected_root_count} total root candidates."
                        ),
                        observed=f"{method} discovered {discovered} root(s), coverage={coverage_ratio}.",
                        status="matched",
                    )
                else:
                    per_method[method] = _classify_match(
                        expected=(
                            f"Bracket method was expected to be limited by {sign_change_count} sign-change interval(s) "
                            f"(raw sampled detection found {raw_sign_change_count})."
                        ),
                        observed=f"{method} discovered {discovered} root(s), exceeding the expected sign-change-limited count.",
                        status="unexpected",
                    )
            else:
                per_method[method] = _classify_match(
                    expected=(
                        f"Bracket method had about {sign_change_count} sign-change interval(s) available "
                        f"(raw sampled detection found {raw_sign_change_count})."
                    ),
                    observed=f"{method} discovered {discovered} root(s), coverage={coverage_ratio}.",
                    status="matched" if discovered <= max(sign_change_count, 1) else "unexpected",
                )

        else:
            per_method[method] = _classify_match(
                expected="No method-family-specific coverage expectation was available.",
                observed=f"{method} discovered {discovered} root(s), coverage={coverage_ratio}.",
                status="observed_only",
            )

    open_successes = []
    bracket_successes = []

    for method, item in per_method.items():
        if method in OPEN_METHODS and item["status"] == "matched":
            open_successes.append(method)
        if method in BRACKET_METHODS and item["status"] == "matched":
            bracket_successes.append(method)

    if open_successes:
        comparison_notes.append(
            f"Open methods {', '.join(sorted(open_successes))} behaved consistently with the analytic expectation that they can access more than just sign-change-isolated roots."
        )

    if bracket_successes and expected_root_count > sign_change_count:
        comparison_notes.append(
            f"Bracket-family methods {', '.join(sorted(bracket_successes))} behaved consistently with the structural sign-change limitation inferred from the problem definition."
        )

    return {
        "expected_root_candidate_count": expected_root_count,
        "expected_sign_change_interval_count": sign_change_count,
        "raw_sign_change_interval_count": raw_sign_change_count,
        "per_method": per_method,
        "comparison_notes": comparison_notes,
    }


def _failure_interpretation(
    expectations: Dict[str, Any],
    failure_analysis: Dict[str, Any],
) -> Dict[str, Any]:
    methods = failure_analysis.get("methods") or {}
    expectation_notes = _safe_get(
        expectations, "section_expectations", "failure_diagnostics", "notes", default=[]
    )

    per_method: Dict[str, Any] = {}
    global_notes: List[str] = []

    any_failures = False

    for method, info in methods.items():
        failure_rate = float(info.get("failure_rate", 0.0))
        failed_runs = int(info.get("failed_runs", 0))
        total_runs = int(info.get("total_runs", 0))

        if failed_runs > 0:
            any_failures = True
            per_method[method] = {
                "status": "observed_failures",
                "message": f"{method} had {failed_runs} failed run(s) out of {total_runs}, with failure_rate={failure_rate:.4f}.",
                "failure_counts": info.get("failure_counts", {}),
            }
        else:
            per_method[method] = {
                "status": "no_observed_failures",
                "message": f"{method} had no observed failures in this experiment.",
                "failure_counts": info.get("failure_counts", {}),
            }

    if any_failures:
        global_notes.append(
            "Observed failures should be compared against the analytically identified pathology regions and sign-change limitations."
        )
    else:
        global_notes.append(
            "No observed failures occurred in this run, so analytically predicted pathologies did not manifest as outright failure under the sampled experiment design."
        )
        if expectation_notes:
            global_notes.append(
                "This does not invalidate the analytic warnings; it only means those pathologies did not produce explicit failures on the current sample."
            )

    return {
        "expectation_notes": expectation_notes,
        "per_method": per_method,
        "global_notes": global_notes,
    }


def _basin_statistics_interpretation(
    expectations: Dict[str, Any],
    analytics: Dict[str, Any],
) -> Dict[str, Any]:
    root_basin_statistics_data = analytics.get("root_basin_statistics_data") or {}
    methods_summary = root_basin_statistics_data.get("methods") or []
    section_notes = _safe_get(
        expectations, "section_expectations", "root_basin_statistics", "notes", default=[]
    )

    per_method: Dict[str, Any] = {}
    for info in methods_summary:
        method = info.get("method", "unknown")
        dominant_root = info.get("dominant_root")
        dominant_share = info.get("dominant_share")
        basin_probabilities = info.get("basin_probabilities") or {}

        if dominant_root is not None and dominant_share is not None:
            per_method[method] = {
                "status": "interpreted",
                "message": (
                    f"{method} has dominant root {dominant_root} with basin share {dominant_share:.4f}, "
                    f"indicating uneven attractor accessibility."
                ),
                "root_shares": basin_probabilities,
            }
        else:
            per_method[method] = {
                "status": "unavailable",
                "message": f"No dominant-root basin summary was available for {method}.",
                "root_shares": basin_probabilities,
            }

    return {
        "expectation_notes": section_notes,
        "per_method": per_method,
    }


def _newton_pathology_interpretation(
    expectations: Dict[str, Any],
    failure_analysis: Dict[str, Any],
) -> Dict[str, Any]:
    pathology = _get_newton_pathology(expectations)

    if not pathology:
        return {
            "status": "unavailable",
            "message": "No analytic Newton pathology summary was available.",
            "details": {},
            "comparison_to_observed": [],
            "confidence": {},
        }

    derivative_degeneracy = pathology.get("derivative_degeneracy") or {}
    step_risk = pathology.get("step_risk") or {}
    critical_density = pathology.get("critical_point_density") or {}
    instability_regions = pathology.get("instability_regions") or {}

    risk_score = pathology.get("expected_newton_risk_score")
    risk_band = pathology.get("expected_newton_risk_band", "unknown")

    deg_frac = float(derivative_degeneracy.get("degenerate_fraction", 0.0))
    high_step_frac = float(step_risk.get("high_step_fraction", 0.0))
    instability_frac = float(instability_regions.get("instability_fraction", 0.0))
    critical_count = int(critical_density.get("critical_point_count_estimate", 0))

    methods = failure_analysis.get("methods") or {}
    newton_failure_info = methods.get("newton") or {}
    total_runs = int(newton_failure_info.get("total_runs", 0))
    failed_runs = int(newton_failure_info.get("failed_runs", 0))
    failure_rate = (
        float(newton_failure_info.get("failure_rate", 0.0))
        if total_runs > 0
        else 0.0
    )
    success_fraction = 0.0
    if total_runs > 0:
        success_fraction = max(0.0, min(1.0, (total_runs - failed_runs) / total_runs))

    unknown_fraction = 0.0
    failure_counts = newton_failure_info.get("failure_counts", {}) or {}
    if total_runs > 0 and isinstance(failure_counts, dict):
        unknown_count = int(failure_counts.get("unknown", 0))
        unknown_fraction = max(0.0, min(1.0, unknown_count / total_runs))

    comparison_to_observed: List[str] = []

    if total_runs > 0:
        if risk_band == "high" and failure_rate > 0:
            comparison_to_observed.append(
                "Observed Newton failures are consistent with the analytically predicted high-risk structure."
            )
        elif risk_band == "high" and failure_rate == 0:
            comparison_to_observed.append(
                "Analytic Newton risk was high, but no explicit Newton failures were observed on the sampled runs."
            )
        elif risk_band == "low" and failure_rate == 0:
            comparison_to_observed.append(
                "Observed Newton behavior is consistent with the analytically predicted low-risk structure."
            )
        elif risk_band == "low" and failure_rate > 0:
            comparison_to_observed.append(
                "Observed Newton failures were stronger than expected from the analytic low-risk prediction."
            )
        else:
            comparison_to_observed.append(
                "Observed Newton behavior shows partial agreement with the analytic pathology estimate."
            )

    confidence: Dict[str, Any] = {}
    if total_runs > 0:
        confidence = build_method_interpretation_confidence(
            predicted_risk_band=risk_band,
            observed_failure_fraction=failure_rate,
            observed_success_fraction=success_fraction,
            sample_count=total_runs,
            unknown_fraction=unknown_fraction,
        )

        confidence_band = confidence.get("confidence_band", "unknown")
        agreement_label = confidence.get("agreement_label", "unknown")
        mismatch = confidence.get("mismatch_severity")

        comparison_to_observed.append(
            f"Confidence in the Newton interpretation is {confidence_band}, with {agreement_label} analytic-observed agreement"
            + (f" (mismatch={mismatch:.4f})." if isinstance(mismatch, (int, float)) else ".")
        )

    message = (
        f"Analytic Newton scan classified the domain as {risk_band} risk "
        f"(score={risk_score}) with derivative degeneracy fraction={deg_frac:.4f}, "
        f"high-step fraction={high_step_frac:.4f}, instability fraction={instability_frac:.4f}, "
        f"and estimated critical-point count={critical_count}."
    )

    return {
        "status": "interpreted",
        "message": message,
        "details": pathology,
        "comparison_to_observed": comparison_to_observed,
        "confidence": confidence,
    }


def _comparison_summary(
    expectations: Dict[str, Any],
    analytics: Dict[str, Any],
    failure_analysis: Dict[str, Any],
    root_coverage_interpretation: Dict[str, Any],
) -> Dict[str, Any]:
    comparison_data = analytics.get("comparison_summary_data") or {}
    method_rows = comparison_data.get("methods") or []

    notes: List[str] = []

    if method_rows:
        fastest_method = None
        fastest_mean = None

        for info in method_rows:
            method = info.get("method")
            mean_iter = info.get("mean_iter")
            if method is None or mean_iter is None:
                continue
            if fastest_mean is None or mean_iter < fastest_mean:
                fastest_mean = mean_iter
                fastest_method = method

        if fastest_method is not None:
            notes.append(
                f"{fastest_method} had the lowest reported mean iteration count among the compared methods."
            )

    coverage_notes = root_coverage_interpretation.get("comparison_notes") or []
    notes.extend(coverage_notes)

    if not notes:
        notes.append("No strong multi-method comparison conclusion was generated.")

    return {
        "notes": notes,
        "comparison_data": comparison_data,
    }


def build_interpretation_summary(
    *,
    expectations: Dict[str, Any],
    analytics: Dict[str, Any],
    failure_analysis: Dict[str, Any],
    metadata: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    metadata = metadata or {}

    numerical_derivative = bool(metadata.get("numerical_derivative", False))
    derivative_mode = "numerical" if numerical_derivative else "analytic"

    problem_type = str(
        expectations.get("problem_type")
        or metadata.get("problem_type")
        or "custom"
    ).strip().lower()

    benchmark_id = metadata.get("benchmark_id") or metadata.get("problem_id")
    benchmark_name = metadata.get("benchmark_name")
    benchmark_category = metadata.get("benchmark_category")

    analytic_notes = expectations.get("analytic_notes") or metadata.get("analytic_notes")
    known_roots = expectations.get("known_roots") or metadata.get("known_roots") or []
    expected_root_count = len(known_roots) if isinstance(known_roots, list) else 0

    root_cov = _root_coverage_interpretation(
        expectations=expectations,
        analytics=analytics,
        failure_analysis=failure_analysis,
    )

    failure_interp = _failure_interpretation(
        expectations=expectations,
        failure_analysis=failure_analysis,
    )

    newton_pathology_interp = _newton_pathology_interpretation(
        expectations=expectations,
        failure_analysis=failure_analysis,
    )

    basin_interp = _basin_statistics_interpretation(
        expectations=expectations,
        analytics=analytics,
    )

    comparison = _comparison_summary(
        expectations=expectations,
        analytics=analytics,
        failure_analysis=failure_analysis,
        root_coverage_interpretation=root_cov,
    )

    top_summary: List[str] = []

    if numerical_derivative:
        top_summary.append(
            "Derivative-based methods (Newton-family solvers) used numerical derivative approximation rather than analytic derivatives."
        )
    else:
        top_summary.append(
            "Derivative-based methods used analytic derivatives supplied by the problem definition."
        )

    newton_pathology_status = newton_pathology_interp.get("status")
    if newton_pathology_status == "interpreted":
        pathology_details = newton_pathology_interp.get("details") or {}
        risk_band = pathology_details.get("expected_newton_risk_band", "unknown")
        risk_score = pathology_details.get("expected_newton_risk_score")
        instability_regions = pathology_details.get("instability_regions") or {}
        instability_fraction = float(instability_regions.get("instability_fraction", 0.0))

        top_summary.append(
            f"Analytic Newton pathology scan classified the problem domain as {risk_band} risk"
            + (f" (score={risk_score})." if risk_score is not None else ".")
        )
        top_summary.append(
            f"Predicted Newton instability regions cover about {instability_fraction:.4f} of the analyzed domain."
        )

        confidence = newton_pathology_interp.get("confidence") or {}
        if confidence:
            confidence_band = confidence.get("confidence_band", "unknown")
            agreement_label = confidence.get("agreement_label", "unknown")
            top_summary.append(
                f"Confidence in the Newton interpretation is {confidence_band}, with {agreement_label} agreement between analytic risk prediction and observed outcomes."
            )

        for note in newton_pathology_interp.get("comparison_to_observed", [])[:2]:
            if "Confidence in the Newton interpretation" not in note:
                top_summary.append(note)

    if problem_type == "benchmark":
        if benchmark_name:
            if benchmark_category:
                top_summary.append(
                    f"This experiment used benchmark {benchmark_id} ({benchmark_name}) from the {benchmark_category} category."
                )
            else:
                top_summary.append(
                    f"This experiment used benchmark {benchmark_id} ({benchmark_name})."
                )

        if expected_root_count > 0:
            top_summary.append(
                f"The benchmark metadata specifies {expected_root_count} known real root(s), so root coverage should be interpreted against that reference set."
            )

        if analytic_notes:
            top_summary.append(
                f"Analytic expectation from benchmark definition: {analytic_notes}"
            )

        if benchmark_category == "multiple_roots":
            top_summary.append(
                "Because this is a multiple-root benchmark, Newton-family methods are analytically expected to lose their ideal quadratic local convergence near repeated roots."
            )

        elif benchmark_category == "oscillatory":
            top_summary.append(
                "Because this is an oscillatory benchmark with multiple roots, basin fragmentation and incomplete root coverage are analytically plausible, especially for local open methods."
            )

        elif benchmark_category == "pathological":
            top_summary.append(
                "Because this is a pathological benchmark, instability, oscillation, or sensitivity to initialization should be treated as expected structural behavior rather than implementation error."
            )

        elif benchmark_category == "polynomial" and expected_root_count >= 3:
            top_summary.append(
                "Because this polynomial benchmark has several known roots, basin partitioning and multi-root coverage differences between methods are expected."
            )

        elif benchmark_category == "transcendental":
            top_summary.append(
                "Because this is a transcendental benchmark, solver behavior should be interpreted relative to the benchmark's known nonlinear structure rather than only algebraic intuition."
            )

    expected_roots_symbolic = _safe_get(
        expectations, "analytic_checks", "root_candidate_count", default=0
    )
    sign_change_roots = _safe_get(
        expectations, "analytic_checks", "sign_change_interval_count", default=0
    )

    if expected_roots_symbolic and sign_change_roots < expected_roots_symbolic:
        top_summary.append(
            f"The symbolic problem analysis suggests about {expected_roots_symbolic} root candidate(s), but only {sign_change_roots} sign-change-accessible root region(s), so bracket-family methods are analytically expected to have structurally smaller coverage."
        )

    failure_global = failure_interp.get("global_notes") or []
    top_summary.extend(failure_global[:2])

    comparison_notes = comparison.get("notes") or []
    top_summary.extend(comparison_notes[:3])

    # ---------------------------------------------------------
    # Audit layer integration
    # ---------------------------------------------------------
    audit_data = audit_consistency(
        benchmark_id=benchmark_id,
        benchmark_name=benchmark_name,
        benchmark_category=benchmark_category,
        known_roots=known_roots if isinstance(known_roots, list) else [],
        comparison_summary_data=analytics.get("comparison_summary_data"),
        root_coverage_data=analytics.get("root_coverage_data"),
        root_basin_statistics_data=analytics.get("root_basin_statistics_data"),
        basin_entropy_data=analytics.get("basin_entropy_data"),
        failure_statistics_data=analytics.get("failure_statistics_data"),
        interpretation_summary_data={
            "problem_type": problem_type,
            "benchmark_id": benchmark_id,
            "benchmark_name": benchmark_name,
            "benchmark_category": benchmark_category,
            "derivative_mode": derivative_mode,
            "top_summary": top_summary,
            "root_coverage_interpretation": root_cov,
            "failure_interpretation": failure_interp,
            "newton_pathology_interpretation": newton_pathology_interp,
            "root_basin_statistics_interpretation": basin_interp,
            "comparison_interpretation": comparison,
        },
        problem_expectations_data=expectations,
    )

    audit_status = audit_data.get("status", "ok")
    audit_summary = audit_data.get("summary", "")

    if audit_status == "warning":
        for issue in audit_data.get("issues", []):
            if issue.get("code") == "analytic_observed_newton_mismatch":
                top_summary.append(
                    "Note: Analytic instability indicators for Newton methods were not observed empirically in this experiment; this suggests that the predicted pathology regions did not significantly affect convergence for the sampled initial conditions."
                )

    if audit_status == "ok":
        top_summary.append(f"Consistency audit status: OK. {audit_summary}")
    elif audit_status == "warning":
        top_summary.append(f"Consistency audit status: WARNING. {audit_summary}")
    else:
        top_summary.append(f"Consistency audit status: SUSPICIOUS. {audit_summary}")

    return {
        "problem_type": problem_type,
        "benchmark_id": benchmark_id,
        "benchmark_name": benchmark_name,
        "benchmark_category": benchmark_category,
        "derivative_mode": derivative_mode,
        "top_summary": top_summary,
        "root_coverage_interpretation": root_cov,
        "failure_interpretation": failure_interp,
        "newton_pathology_interpretation": newton_pathology_interp,
        "root_basin_statistics_interpretation": basin_interp,
        "comparison_interpretation": comparison,
        "audit_consistency": audit_data,
    }


def save_interpretation_summary(
    *,
    output_dir: str | Path,
    interpretation: Dict[str, Any],
) -> Dict[str, str]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    json_path = output_dir / "interpretation_summary.json"
    txt_path = output_dir / "interpretation_summary.txt"

    # ---------------------------------------------------------
    # Save main interpretation JSON
    # ---------------------------------------------------------
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(interpretation, f, indent=2)

    # ---------------------------------------------------------
    # Save main interpretation TXT
    # ---------------------------------------------------------
    lines: List[str] = []
    for line in interpretation.get("top_summary", []):
        lines.append(f"- {line}")

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).strip() + "\n")

    # ---------------------------------------------------------
    # Audit layer saving (NEW)
    # ---------------------------------------------------------
    audit = interpretation.get("audit_consistency") or {}

    audit_json_path = output_dir / "audit_consistency.json"
    audit_txt_path = output_dir / "audit_consistency.txt"

    # Save audit JSON
    with open(audit_json_path, "w", encoding="utf-8") as f:
        json.dump(audit, f, indent=2)

    # Save audit TXT
    audit_lines: List[str] = []

    status = audit.get("status", "unknown")
    summary = audit.get("summary", "")

    audit_lines.append(f"Status: {status}")
    audit_lines.append(f"Summary: {summary}")
    audit_lines.append("")

    issues = audit.get("issues", []) or []
    if issues:
        audit_lines.append("Issues:")
        for issue in issues:
            audit_lines.append(
                f"- [{issue.get('severity', 'warning')}] "
                f"{issue.get('code', 'unknown')}: "
                f"{issue.get('message', '')}"
            )
    else:
        audit_lines.append("No issues detected.")

    with open(audit_txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(audit_lines).strip() + "\n")

    return {
        "json_path": str(json_path),
        "txt_path": str(txt_path),
        "audit_json_path": str(audit_json_path),
        "audit_txt_path": str(audit_txt_path),
    }