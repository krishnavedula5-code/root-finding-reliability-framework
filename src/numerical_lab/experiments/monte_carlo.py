from __future__ import annotations

import csv
import json
import math
import random
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from numerical_lab.analytics.monte_carlo_analytics import summarize_monte_carlo_records
from numerical_lab.engine.controller import NumericalEngine


BRACKET_METHODS = {"bisection", "brent", "hybrid", "safeguarded_newton"}
OPEN_METHODS = {"newton", "secant"}


def _safe_get(obj: Any, *keys: str, default: Any = None) -> Any:
    """
    Supports dict-like result objects and dataclass/object attribute access.
    """
    cur = obj

    for key in keys:
        if cur is None:
            return default

        if isinstance(cur, dict):
            cur = cur.get(key, default)
        else:
            cur = getattr(cur, key, default)

    return cur


def _result_to_plain_dict(result: Any) -> Dict[str, Any]:
    if result is None:
        return {}

    if isinstance(result, dict):
        return dict(result)

    if is_dataclass(result):
        return asdict(result)

    if hasattr(result, "__dict__"):
        return dict(vars(result))

    return {"value": str(result)}


def _extract_result_fields(result: Any, report: Any, stab: Any) -> Dict[str, Any]:
    result_dict = _result_to_plain_dict(result)
    report_dict = _result_to_plain_dict(report)
    stab_dict = _result_to_plain_dict(stab)

    status = (
        result_dict.get("status")
        or report_dict.get("status")
        or report_dict.get("label")
        or "unknown"
    )

    iterations = (
        result_dict.get("iterations")
        or result_dict.get("n_iterations")
        or result_dict.get("iter_count")
    )

    root = (
        result_dict.get("root")
        or result_dict.get("x")
        or result_dict.get("approx_root")
    )

    residual = (
        result_dict.get("residual")
        or result_dict.get("f_at_root")
        or result_dict.get("final_residual")
    )

    report_label = (
        report_dict.get("label")
        or report_dict.get("classification")
        or report_dict.get("status")
        or "unknown"
    )

    stability_label = (
        stab_dict.get("label")
        or stab_dict.get("classification")
        or stab_dict.get("status")
        or "unknown"
    )

    return {
        "status": status,
        "iterations": iterations,
        "root": root,
        "residual": residual,
        "report_label": report_label,
        "stability_label": stability_label,
        "raw_result": result_dict,
        "raw_report": report_dict,
        "raw_stability": stab_dict,
    }


def _sample_open_initial_guess(
    rng: random.Random,
    distribution: str,
    x_min: float,
    x_max: float,
    mean: Optional[float],
    std: Optional[float],
) -> float:
    if distribution == "gaussian":
        mu = mean if mean is not None else 0.5 * (x_min + x_max)
        sigma = std if std is not None else max((x_max - x_min) / 6.0, 1e-12)
        return rng.gauss(mu, sigma)

    # default: uniform
    return rng.uniform(x_min, x_max)


def _sample_secant_pair(
    rng: random.Random,
    distribution: str,
    x_min: float,
    x_max: float,
    mean: Optional[float],
    std: Optional[float],
    secant_dx: float,
) -> Tuple[float, float]:
    x0 = _sample_open_initial_guess(rng, distribution, x_min, x_max, mean, std)
    x1 = x0 + secant_dx

    if x1 == x0:
        x1 = x0 + 1e-6

    return x0, x1


def _sample_bracket_with_sign_change(
    f,
    rng: random.Random,
    x_min: float,
    x_max: float,
    max_attempts: int = 200,
) -> Optional[Tuple[float, float]]:
    """
    Sample random brackets until a sign change is found.
    """
    for _ in range(max_attempts):
        a = rng.uniform(x_min, x_max)
        b = rng.uniform(x_min, x_max)

        if a == b:
            continue

        if a > b:
            a, b = b, a

        try:
            fa = f(a)
            fb = f(b)
        except Exception:
            continue

        if fa is None or fb is None:
            continue

        try:
            if math.isnan(float(fa)) or math.isnan(float(fb)):
                continue
        except Exception:
            continue

        if fa == 0:
            return (a, a)
        if fb == 0:
            return (b, b)

        if fa * fb < 0:
            return (a, b)

    return None


def _build_interpretation(
    summary: Dict[str, Any],
    methods: List[str],
    distribution: str,
    x_min: float,
    x_max: float,
    gaussian_mean: float | None = None,
    gaussian_std: float | None = None,
) -> Tuple[Dict[str, Any], str]:
    """
    Lightweight interpretation layer for Monte Carlo results.
    Keeps consistency with the framework direction.
    """
    methods_summary = summary.get("methods", {})
    lines: List[str] = []
    per_method_json: Dict[str, Any] = {}

    lines.append("Monte Carlo Reliability Interpretation")
    lines.append("=" * 40)
    print("DEBUG_build_interpretation:",distribution, gaussian_mean, gaussian_std)
    distribution_normalized = str(distribution or "uniform").lower()

    if distribution_normalized == "gaussian":
        lines.append(
            f"Sampling distribution: gaussian with mean={gaussian_mean}, std={gaussian_std}"
        )
    else:
        lines.append(
            f"Sampling distribution: uniform over domain [{x_min}, {x_max}]"
        )

    lines.append("")

    for method in methods:
        m = methods_summary.get(method, {})
        if not m:
            continue

        p = m.get("success_probability")
        ci = m.get("confidence_interval_95", [None, None])
        root_cov = m.get("root_coverage_count")
        status_counts = m.get("status_counts", {})
        report_counts = m.get("report_counts", {})
        stab_counts = m.get("stability_counts", {})

        p_text = f"{p:.4f}" if p is not None else "nan"
        ci_lo = ci[0] if len(ci) > 0 else None
        ci_hi = ci[1] if len(ci) > 1 else None
        ci_lo_text = f"{ci_lo:.4f}" if ci_lo is not None else "nan"
        ci_hi_text = f"{ci_hi:.4f}" if ci_hi is not None else "nan"

        text = (
            f"{method}: success probability = {p_text}, "
            f"95% CI = [{ci_lo_text}, {ci_hi_text}], "
            f"root coverage count = {root_cov}."
        )

        if method in {"newton", "hybrid", "safeguarded_newton"}:
            text += (
                " Analytic expectation: derivative-based methods may show sensitivity "
                "near critical points or regions where |f'(x)| is small, leading to "
                "stagnation, instability, or attraction to limited basins."
            )

        if method in {"bisection", "brent"}:
            text += (
                " Analytic expectation: bracket methods are structurally restricted to "
                "sign-change intervals, so their reliability depends strongly on how "
                "often random sampling produces valid brackets."
            )

        if method == "secant":
            text += (
                " Analytic expectation: secant may improve flexibility over strict "
                "derivative-based methods but remains sensitive to poor initial pairs "
                "and can fail through unstable updates or non-informative secant slopes."
            )

        lines.append(text)
        lines.append(f"  status counts: {status_counts}")
        lines.append(f"  convergence report counts: {report_counts}")
        lines.append(f"  stability counts: {stab_counts}")
        lines.append("")

        per_method_json[method] = {
            "summary": text,
            "status_counts": status_counts,
            "report_counts": report_counts,
            "stability_counts": stab_counts,
        }

    return (
        {
            "distribution": distribution_normalized,
            "domain": [x_min, x_max],
            "gaussian_mean": gaussian_mean,
            "gaussian_std": gaussian_std,
            "methods": per_method_json,
        },
        "\n".join(lines),
    )


def run_monte_carlo_experiment(
    *,
    problem_id: str,
    f,
    df,
    methods: List[str],
    x_min: float,
    x_max: float,
    n_samples: int,
    output_dir: str | Path,
    random_seed: int = 42,
    distribution: str = "uniform",
    gaussian_mean: Optional[float] = None,
    gaussian_std: Optional[float] = None,
    secant_dx: float = 1e-2,
    max_iter: int = 100,
    tol: float = 1e-10,
    numerical_derivative: bool = False,
) -> Dict[str, Any]:
    """
    Monte Carlo reliability experiment.

    Supports:
    - open methods: newton, secant
    - bracket methods: bisection, brent, hybrid, safeguarded_newton
      via random bracket sampling with sign-change enforcement
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    rng = random.Random(random_seed)
    rows: List[Dict[str, Any]] = []

    bracket_attempt_failures = 0

    for method in methods:
        for sample_index in range(n_samples):
            row: Dict[str, Any] = {
                "problem_id": problem_id,
                "method": method,
                "sample_index": sample_index,
                "distribution": distribution,
                "random_seed": random_seed,
            }

            try:
                if method == "newton":
                    x0 = _sample_open_initial_guess(
                        rng, distribution, x_min, x_max, gaussian_mean, gaussian_std
                    )
                    result, report, stab = NumericalEngine.solve_newton(
                        f,
                        df,
                        x0,
                        tol=tol,
                        max_iter=max_iter,
                        numerical_derivative=numerical_derivative,
                    )
                    row["x0"] = x0

                elif method == "secant":
                    x0, x1 = _sample_secant_pair(
                        rng,
                        distribution,
                        x_min,
                        x_max,
                        gaussian_mean,
                        gaussian_std,
                        secant_dx,
                    )
                    result, report, stab = NumericalEngine.solve_secant(
                        f,
                        x0,
                        x1,
                        tol=tol,
                        max_iter=max_iter,
                    )
                    row["x0"] = x0
                    row["x1"] = x1

                elif method in BRACKET_METHODS:
                    bracket = _sample_bracket_with_sign_change(f, rng, x_min, x_max)
                    if bracket is None:
                        bracket_attempt_failures += 1
                        row.update(
                            {
                                "a": None,
                                "b": None,
                                "status": "no_valid_bracket",
                                "iterations": None,
                                "root": None,
                                "residual": None,
                                "report_label": "no_valid_bracket",
                                "stability_label": "not_applicable",
                            }
                        )
                        rows.append(row)
                        continue

                    a, b = bracket
                    row["a"] = a
                    row["b"] = b

                    if method == "bisection":
                        result, report, stab = NumericalEngine.solve_bisection(
                            f,
                            a,
                            b,
                            tol=tol,
                            max_iter=max_iter,
                        )
                    elif method == "brent":
                        result, report, stab = NumericalEngine.solve_brent(
                            f,
                            a,
                            b,
                            tol=tol,
                            max_iter=max_iter,
                        )
                    elif method == "hybrid":
                        result, report, stab = NumericalEngine.solve_hybrid(
                            f,
                            df,
                            a,
                            b,
                            tol=tol,
                            max_iter=max_iter,
                            numerical_derivative=numerical_derivative,
                        )
                    elif method == "safeguarded_newton":
                        x0 = 0.5 * (a + b)
                        row["x0"] = x0
                        result, report, stab = NumericalEngine.solve_safeguarded_newton(
                            f,
                            df,
                            a,
                            b,
                            x0,
                            tol=tol,
                            max_iter=max_iter,
                            numerical_derivative=numerical_derivative,
                        )
                    else:
                        raise ValueError(f"Unsupported bracket method: {method}")

                else:
                    raise ValueError(f"Unsupported method: {method}")

                extracted = _extract_result_fields(result, report, stab)
                row.update(
                    {
                        "status": extracted["status"],
                        "iterations": extracted["iterations"],
                        "root": extracted["root"],
                        "residual": extracted["residual"],
                        "report_label": extracted["report_label"],
                        "stability_label": extracted["stability_label"],
                    }
                )

            except Exception as exc:
                row.update(
                    {
                        "status": "error",
                        "iterations": None,
                        "root": None,
                        "residual": None,
                        "report_label": "error",
                        "stability_label": "error",
                        "error_message": str(exc),
                    }
                )

            rows.append(row)

    summary = summarize_monte_carlo_records(rows)

    interpretation_json, interpretation_txt = _build_interpretation(
        summary=summary,
        methods=methods,
        distribution=distribution,
        x_min=x_min,
        x_max=x_max,
        gaussian_mean=gaussian_mean,
        gaussian_std=gaussian_std,
    )

    metadata = {
        "experiment_type": "monte_carlo",
        "problem_id": problem_id,
        "methods": methods,
        "x_min": x_min,
        "x_max": x_max,
        "n_samples": n_samples,
        "random_seed": random_seed,
        "distribution": distribution,
        "gaussian_mean": gaussian_mean,
        "gaussian_std": gaussian_std,
        "secant_dx": secant_dx,
        "max_iter": max_iter,
        "tol": tol,
        "numerical_derivative": numerical_derivative,
        "bracket_attempt_failures": bracket_attempt_failures,
    }

    csv_path = output_path / "monte_carlo_records.csv"
    summary_path = output_path / "monte_carlo_summary.json"
    metadata_path = output_path / "monte_carlo_metadata.json"
    interpretation_json_path = output_path / "monte_carlo_interpretation.json"
    interpretation_txt_path = output_path / "monte_carlo_interpretation.txt"

    fieldnames = sorted({k for row in rows for k in row.keys()})
    with open(csv_path, "w", newline="", encoding="utf-8") as f_csv:
        writer = csv.DictWriter(f_csv, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    with open(summary_path, "w", encoding="utf-8") as f_summary:
        json.dump(summary, f_summary, indent=2)

    with open(metadata_path, "w", encoding="utf-8") as f_metadata:
        json.dump(metadata, f_metadata, indent=2)

    with open(interpretation_json_path, "w", encoding="utf-8") as f_interp_json:
        json.dump(interpretation_json, f_interp_json, indent=2)

    with open(interpretation_txt_path, "w", encoding="utf-8") as f_interp_txt:
        f_interp_txt.write(interpretation_txt)

    return {
        "output_dir": str(output_path),
        "records_csv": str(csv_path),
        "summary_json": str(summary_path),
        "metadata_json": str(metadata_path),
        "interpretation_json": str(interpretation_json_path),
        "interpretation_txt": str(interpretation_txt_path),
        "summary": summary,
        "metadata": metadata,
    }