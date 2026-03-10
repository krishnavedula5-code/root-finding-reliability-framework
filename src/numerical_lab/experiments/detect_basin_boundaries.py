from __future__ import annotations

from pathlib import Path
import csv
from typing import Dict, List, Tuple, Any, Optional


def find_latest_sweep() -> Path:
    base = Path("outputs/sweeps")
    folders = sorted(
        p for p in base.iterdir() if p.is_dir() and p.name.startswith("sweep_")
    )
    if not folders:
        raise FileNotFoundError("No sweep folders found in outputs/sweeps")
    return folders[-1]


def load_rows(path: Path) -> List[Dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def normalize_root_id(row: Dict[str, str]) -> str:
    status = (row.get("status") or "").strip().lower()
    rid = (row.get("root_id") or "").strip()
    if status == "converged" and rid:
        return rid
    return "FAIL"


def _extract_sorted_label_data(rows: List[Dict[str, str]]) -> List[Tuple[float, str]]:
    data: List[Tuple[float, str]] = []

    for r in rows:
        try:
            x0 = float(r["x0"])
        except Exception:
            continue

        label = normalize_root_id(r)
        data.append((x0, label))

    data.sort(key=lambda t: t[0])
    return data


def _estimate_grid_spacing(data: List[Tuple[float, str]]) -> Optional[float]:
    if len(data) < 2:
        return None

    spacings: List[float] = []
    for i in range(1, len(data)):
        dx = data[i][0] - data[i - 1][0]
        if dx > 0:
            spacings.append(dx)

    if not spacings:
        return None

    return min(spacings)


def detect_raw_boundaries(rows: List[Dict[str, str]]) -> List[float]:
    """
    Return raw midpoint boundaries whenever adjacent labels differ.
    """
    data = _extract_sorted_label_data(rows)
    boundaries: List[float] = []

    for i in range(1, len(data)):
        x_prev, l_prev = data[i - 1]
        x_cur, l_cur = data[i]

        if l_prev != l_cur:
            boundary = 0.5 * (x_prev + x_cur)
            boundaries.append(boundary)

    return boundaries


def cluster_boundary_points(
    boundaries: List[float],
    *,
    cluster_tol: float,
) -> List[Dict[str, Any]]:
    """
    Cluster nearby 1D boundary points.

    Returns a list of dicts with:
    - center
    - start
    - end
    - width
    - count
    - raw_points
    """
    if not boundaries:
        return []

    pts = sorted(float(x) for x in boundaries)

    clusters: List[List[float]] = []
    current = [pts[0]]

    for x in pts[1:]:
        if x - current[-1] <= cluster_tol:
            current.append(x)
        else:
            clusters.append(current)
            current = [x]

    clusters.append(current)

    out: List[Dict[str, Any]] = []
    for idx, cluster in enumerate(clusters, start=1):
        start = cluster[0]
        end = cluster[-1]
        center = sum(cluster) / len(cluster)
        width = end - start

        out.append(
            {
                "region_id": idx,
                "center": center,
                "start": start,
                "end": end,
                "width": width,
                "count": len(cluster),
                "raw_points": cluster,
            }
        )

    return out


def summarize_boundaries(
    raw_boundaries: List[float],
    clustered_boundaries: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if not raw_boundaries:
        return {
            "raw_count": 0,
            "clustered_count": 0,
            "leftmost": None,
            "rightmost": None,
            "min_spacing": None,
            "median_spacing": None,
            "max_spacing": None,
        }

    pts = sorted(raw_boundaries)
    spacings = [pts[i] - pts[i - 1] for i in range(1, len(pts))]

    def median(vals: List[float]) -> Optional[float]:
        if not vals:
            return None
        vals = sorted(vals)
        n = len(vals)
        mid = n // 2
        if n % 2 == 1:
            return vals[mid]
        return 0.5 * (vals[mid - 1] + vals[mid])

    return {
        "raw_count": len(raw_boundaries),
        "clustered_count": len(clustered_boundaries),
        "leftmost": pts[0],
        "rightmost": pts[-1],
        "min_spacing": min(spacings) if spacings else None,
        "median_spacing": median(spacings),
        "max_spacing": max(spacings) if spacings else None,
    }
def _median(vals: List[float]) -> Optional[float]:
    if not vals:
        return None
    vals = sorted(vals)
    n = len(vals)
    mid = n // 2
    if n % 2 == 1:
        return vals[mid]
    return 0.5 * (vals[mid - 1] + vals[mid])

def detect_boundaries(
    rows: List[Dict[str, str]],
    *,
    cluster_tol: Optional[float] = None,
    return_mode: str = "raw",
) -> Any:
    """
    Main API.

    return_mode options:
    - "raw"       -> list[float]
    - "clustered" -> list[dict]
    - "full"      -> dict with raw + clustered + summary

    If cluster_tol is omitted, it is estimated from sweep spacing:
        cluster_tol = 2 * grid_spacing
    """
    data = _extract_sorted_label_data(rows)
    raw_boundaries: List[float] = []

    for i in range(1, len(data)):
        x_prev, l_prev = data[i - 1]
        x_cur, l_cur = data[i]

        if l_prev != l_cur:
            raw_boundaries.append(0.5 * (x_prev + x_cur))

    if cluster_tol is None:
        grid_spacing = _estimate_grid_spacing(data)

        if not raw_boundaries or len(raw_boundaries) < 2:
            if grid_spacing is None:
                cluster_tol = 1e-6
            else:
                cluster_tol = 2.0 * grid_spacing
        else:
            gaps = [
                raw_boundaries[i] - raw_boundaries[i - 1]
                for i in range(1, len(raw_boundaries))
                if raw_boundaries[i] > raw_boundaries[i - 1]
            ]

            median_gap = _median(gaps)

            if grid_spacing is None and median_gap is None:
                cluster_tol = 1e-6
            elif grid_spacing is None:
                cluster_tol = 0.5 * median_gap
            elif median_gap is None:
                cluster_tol = 2.0 * grid_spacing
            else:
                cluster_tol = max(2.0 * grid_spacing, 0.5 * median_gap)
                cluster_tol = min(cluster_tol, 6.0 * grid_spacing)

    clustered = cluster_boundary_points(raw_boundaries, cluster_tol=cluster_tol)
    summary = summarize_boundaries(raw_boundaries, clustered)

    if return_mode == "raw":
        return raw_boundaries

    if return_mode == "clustered":
        return clustered

    if return_mode == "full":
        return {
            "raw": raw_boundaries,
            "clustered": clustered,
            "summary": summary,
            "cluster_tol": cluster_tol,
        }

    raise ValueError("return_mode must be one of: raw, clustered, full")


def main():
    latest = find_latest_sweep()
    rows = load_rows(latest / "records.csv")

    problem = "p4"
    method = "newton"

    subset = [
        r for r in rows
        if (r.get("problem_id") == problem and r.get("method") == method)
    ]

    result = detect_boundaries(subset, return_mode="full")

    print("Boundary summary:")
    print(result["summary"])
    print("\nClustered boundary regions:")
    for region in result["clustered"]:
        print(
            f"region {region['region_id']}: "
            f"center ≈ {region['center']:.6f}, "
            f"start ≈ {region['start']:.6f}, "
            f"end ≈ {region['end']:.6f}, "
            f"width ≈ {region['width']:.6f}, "
            f"raw points = {region['count']}"
        )


if __name__ == "__main__":
    main()