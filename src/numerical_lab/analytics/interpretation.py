from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List


BRACKET_METHODS = {"bisection", "brent", "hybrid", "safeguarded_newton"}
OPEN_METHODS = {"newton", "secant"}


def _safe_get(d: Dict[str, Any], *keys: str, default: Any = None) -> Any:
    cur: Any = d
    for key in keys:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur


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

    root_coverage_data = analytics.get("root_coverage_data") or {}
    methods_summary = root_coverage_data.get("solvers") or {}

    per_method: Dict[str, Any] = {}
    comparison_notes: List[str] = []

    for method, info in methods_summary.items():
        discovered = int(info.get("roots_found", 0))
        total_roots = int(info.get("total_roots", expected_root_count or 0))
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
                            f"Bracket method was expected to access at most about {sign_change_count} sign-change-accessible root region(s), "
                            f"with possible undercoverage relative to {expected_root_count} total root candidates."
                        ),
                        observed=f"{method} discovered {discovered} root(s), coverage={coverage_ratio}.",
                        status="matched",
                    )
                else:
                    per_method[method] = _classify_match(
                        expected=(
                            f"Bracket method was expected to be limited by {sign_change_count} sign-change interval(s)."
                        ),
                        observed=f"{method} discovered {discovered} root(s), exceeding the expected sign-change-limited count.",
                        status="unexpected",
                    )
            else:
                per_method[method] = _classify_match(
                    expected=f"Bracket method had about {sign_change_count} sign-change interval(s) available.",
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
) -> Dict[str, Any]:
    root_cov = _root_coverage_interpretation(
        expectations=expectations,
        analytics=analytics,
        failure_analysis=failure_analysis,
    )
    failure_interp = _failure_interpretation(
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

    expected_roots = _safe_get(expectations, "analytic_checks", "root_candidate_count", default=0)
    sign_change_roots = _safe_get(expectations, "analytic_checks", "sign_change_interval_count", default=0)

    if expected_roots and sign_change_roots < expected_roots:
        top_summary.append(
            f"The problem definition suggests about {expected_roots} root candidate(s), but only {sign_change_roots} sign-change-accessible root region(s), so bracket-family methods are analytically expected to have structurally smaller coverage."
        )

    failure_global = failure_interp.get("global_notes") or []
    top_summary.extend(failure_global[:2])

    top_summary.extend((comparison.get("notes") or [])[:3])

    return {
        "top_summary": top_summary,
        "root_coverage_interpretation": root_cov,
        "failure_interpretation": failure_interp,
        "root_basin_statistics_interpretation": basin_interp,
        "comparison_interpretation": comparison,
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

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(interpretation, f, indent=2)

    lines: List[str] = []
    for line in interpretation.get("top_summary", []):
        lines.append(f"- {line}")

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).strip() + "\n")

    return {
        "json_path": str(json_path),
        "txt_path": str(txt_path),
    }