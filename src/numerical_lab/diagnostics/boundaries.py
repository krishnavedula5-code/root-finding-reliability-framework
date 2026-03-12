from __future__ import annotations

import json
import math
from pathlib import Path
from statistics import mean
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def _safe_float(x: Any):
    try:
        v = float(x)
        if math.isfinite(v):
            return v
    except (TypeError, ValueError):
        pass
    return None


def _safe_int(x: Any, default: int = 0) -> int:
    try:
        return int(x)
    except (TypeError, ValueError):
        return default


def _root_label(row: dict[str, Any], root_digits: int = 8) -> str:
    status = str(row.get("status", "unknown")).strip().lower()
    if status == "converged":
        root = _safe_float(row.get("root_found"))
        if root is None:
            root = _safe_float(row.get("root"))
        if root is None:
            return "root:unknown"
        return f"root:{round(root, root_digits)}"
    return f"fail:{status}"


def detect_basin_boundaries(rows: list[dict[str, Any]]) -> dict[str, Any]:
    enriched = []
    for row in rows:
        x0 = _safe_float(row.get("initial_x"))
        if x0 is None:
            x0 = _safe_float(row.get("x0"))
        if x0 is None:
            continue

        enriched.append(
            {
                "initial_x": x0,
                "iterations": _safe_int(row.get("iterations"), 0),
                "status": str(row.get("status", "unknown")).strip().lower(),
                "label": _root_label(row),
            }
        )

    enriched.sort(key=lambda r: r["initial_x"])

    boundaries = []
    boundary_iters = []
    num_root_switches = 0
    num_status_switches = 0

    for left, right in zip(enriched, enriched[1:]):
        if left["label"] == right["label"]:
            continue

        left_is_root = left["label"].startswith("root:")
        right_is_root = right["label"].startswith("root:")

        if left_is_root and right_is_root:
            transition_type = "root_to_root"
            num_root_switches += 1
        elif left_is_root and not right_is_root:
            transition_type = "root_to_failure"
            num_status_switches += 1
        elif not left_is_root and right_is_root:
            transition_type = "failure_to_root"
            num_status_switches += 1
        else:
            transition_type = "failure_to_failure"
            num_status_switches += 1

        boundary = {
            "left_x": left["initial_x"],
            "right_x": right["initial_x"],
            "estimated_x": 0.5 * (left["initial_x"] + right["initial_x"]),
            "left_label": left["label"],
            "right_label": right["label"],
            "left_iterations": left["iterations"],
            "right_iterations": right["iterations"],
            "transition_type": transition_type,
            "interval_width": abs(right["initial_x"] - left["initial_x"]),
        }
        boundaries.append(boundary)
        boundary_iters.extend([left["iterations"], right["iterations"]])

    if enriched:
        x_min = enriched[0]["initial_x"]
        x_max = enriched[-1]["initial_x"]
        domain_length = max(x_max - x_min, 1e-12)
    else:
        x_min = x_max = 0.0
        domain_length = 1.0

    widths = [b["interval_width"] for b in boundaries]

    summary = {
        "num_samples": len(enriched),
        "x_min": x_min,
        "x_max": x_max,
        "num_boundaries": len(boundaries),
        "num_root_switches": num_root_switches,
        "num_status_switches": num_status_switches,
        "boundary_density": len(boundaries) / domain_length,
        "mean_interval_width": mean(widths) if widths else 0.0,
        "min_interval_width": min(widths) if widths else 0.0,
        "max_interval_width": max(widths) if widths else 0.0,
        "avg_iteration_near_boundaries": mean(boundary_iters) if boundary_iters else 0.0,
        "max_iteration_near_boundaries": max(boundary_iters) if boundary_iters else 0,
    }

    return {
        "boundaries": boundaries,
        "summary": summary,
        "rows": enriched,
    }


def plot_boundary_overlay(
    rows: list[dict[str, Any]],
    boundaries: list[dict[str, Any]],
    output_path: str | Path,
    method: str,
) -> None:
    xs = [r["initial_x"] for r in rows]
    ys = [r["iterations"] for r in rows]

    plt.figure(figsize=(10, 5))
    plt.scatter(xs, ys, s=18)

    for b in boundaries:
        start = b.get("start")
        end = b.get("end")
        center = b.get("center")

        if start is not None and end is not None and abs(end - start) > 1e-12:
            plt.axvspan(start, end, alpha=0.18)

        if center is not None:
            plt.axvline(center, linestyle="--", linewidth=1)

    plt.xlabel("Initial guess")
    plt.ylabel("Iterations")
    plt.title(f"Boundary overlay — {method}")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(output_path, dpi=160)
    plt.close()

def save_boundary_artifacts(
    rows: list[dict[str, Any]],
    output_dir: str | Path,
    method: str,
) -> dict[str, Any]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    result = detect_basin_boundaries(rows)
    raw_boundaries = result["boundaries"]

    # cluster raw boundaries for cleaner plotting
    clustered = []
    if raw_boundaries:
        xs = sorted(
            b["estimated_x"]
            for b in raw_boundaries
            if b.get("estimated_x") is not None
        )

        if xs:
            cluster = [xs[0]]
            tol = 0.12

            for x in xs[1:]:
                if abs(x - cluster[-1]) <= tol:
                    cluster.append(x)
                else:
                    clustered.append(cluster)
                    cluster = [x]

            clustered.append(cluster)

    clustered_boundaries = []
    for i, cluster in enumerate(clustered):
        start = min(cluster)
        end = max(cluster)
        center = sum(cluster) / len(cluster)

        clustered_boundaries.append(
            {
                "region_id": i + 1,
                "start": start,
                "end": end,
                "center": center,
                "width": end - start,
                "count": len(cluster),
                "raw_points": cluster,
            }
        )

    full_payload = {
        "method": method,
        **result["summary"],
        "boundaries": clustered_boundaries,
    }

    boundaries_path = output_dir / f"{method}_basin_boundaries.json"
    summary_path = output_dir / f"{method}_boundary_summary.json"
    overlay_path = output_dir / f"{method}_boundary_overlay.png"

    with open(boundaries_path, "w", encoding="utf-8") as f:
        json.dump(full_payload, f, indent=2)

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "method": method,
                **result["summary"],
            },
            f,
            indent=2,
        )

    overlay_written = False

    # first try the normal overlay function
    try:
        if rows:
            plot_boundary_overlay(
                rows=rows,
                boundaries=clustered_boundaries,
                output_path=overlay_path,
                method=method,
            )
            overlay_written = overlay_path.exists()
    except Exception as e:
        print("[warn] boundary overlay generation failed:", repr(e))
        overlay_written = False

    # fallback: create a very simple overlay directly here
    if not overlay_written:
        try:
            xs = []
            ys = []

            for r in rows:
                x = r.get("initial_x", r.get("x0"))
                y = r.get("iterations")
                try:
                    x = float(x)
                    y = int(y)
                except (TypeError, ValueError):
                    continue
                xs.append(x)
                ys.append(y)

            if xs:
                plt.figure(figsize=(10, 5))
                plt.scatter(xs, ys, s=18)

                for b in clustered_boundaries:
                    start = b.get("start")
                    end = b.get("end")
                    center = b.get("center")

                    if start is not None and end is not None and abs(end - start) > 1e-12:
                        plt.axvspan(start, end, alpha=0.12)

                    if center is not None:
                        plt.axvline(center, linestyle="--", linewidth=1.8)

                plt.xlabel("Initial guess")
                plt.ylabel("Iterations")
                plt.title(f"Boundary overlay — {method}")
                plt.grid(True, alpha=0.3)
                plt.tight_layout()
                plt.savefig(overlay_path, dpi=160)
                plt.close()

                overlay_written = overlay_path.exists()
        except Exception as e:
            print("[warn] fallback boundary overlay generation failed:", repr(e))
            overlay_written = False

    print("[debug] boundaries_path:", boundaries_path, boundaries_path.exists())
    print("[debug] summary_path:", summary_path, summary_path.exists())
    print("[debug] overlay_path:", overlay_path, overlay_path.exists())
    print("[debug] raw boundary count:", len(raw_boundaries))
    print("[debug] clustered boundary count:", len(clustered_boundaries))

    return {
        "summary": result["summary"],
        "boundaries": clustered_boundaries,
        "boundaries_path": str(boundaries_path),
        "summary_path": str(summary_path),
        "overlay_path": str(overlay_path),
        "overlay_written": overlay_written,
    }