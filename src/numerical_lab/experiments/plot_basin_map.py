from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap, BoundaryNorm

from numerical_lab.experiments.detect_basin_boundaries import detect_boundaries


def find_latest_sweep(base: str = "outputs/sweeps") -> Path:
    base_path = Path(base)
    folders = [p for p in base_path.iterdir() if p.is_dir() and p.name.startswith("sweep_")]
    if not folders:
        raise FileNotFoundError(f"No sweep folders found in {base_path}")
    folders.sort()
    return folders[-1]


def load_rows(path: Path) -> List[Dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def parse_float(value: str | None, default: Optional[float] = None) -> Optional[float]:
    try:
        if value is None or str(value).strip() == "":
            return default
        return float(value)
    except Exception:
        return default


def _extract_x0(row: Dict[str, str]) -> Optional[float]:
    for key in ("x0", "initial_x", "initial_guess", "start"):
        value = parse_float(row.get(key), None)
        if value is not None:
            return value
    return None


def _extract_root(row: Dict[str, str]) -> Optional[float]:
    for key in ("root", "x_star", "solution", "final_x", "x"):
        value = parse_float(row.get(key), None)
        if value is not None:
            return value
    return None


def _cluster_roots(root_values: List[float], cluster_tol: float) -> List[List[float]]:
    xs = [x for x in sorted(root_values) if x is not None]
    if not xs:
        return []

    clusters: List[List[float]] = [[xs[0]]]

    for x in xs[1:]:
        current_cluster = clusters[-1]
        center = sum(current_cluster) / len(current_cluster)
        if abs(x - center) <= cluster_tol:
            current_cluster.append(x)
        else:
            clusters.append([x])

    return clusters


def _cluster_center(cluster: List[float]) -> float:
    return sum(cluster) / len(cluster)


def _cluster_label(cluster: List[float]) -> str:
    return f"{_cluster_center(cluster):.6f}"


def build_root_cluster_label_map(rows: List[Dict[str, str]], cluster_tol: float) -> Dict[float, str]:
    """
    Build a mapping raw_root_value -> clustered_root_label using converged rows.
    """
    root_values: List[float] = []

    for row in rows:
        status = (row.get("status") or "").strip().lower()
        if status != "converged":
            continue

        root = _extract_root(row)
        if root is None:
            continue

        root_values.append(root)

    clusters = _cluster_roots(root_values, cluster_tol=cluster_tol)
    label_map: Dict[float, str] = {}

    for cluster in clusters:
        label = _cluster_label(cluster)
        for x in cluster:
            label_map[x] = label

    return label_map


def normalize_root_id(row: Dict[str, str], root_label_map: Optional[Dict[float, str]] = None) -> str:
    """
    Return a basin label for plotting.

    Rules:
    - converged + valid root_id -> that root_id
    - converged + no root_id but valid root -> clustered root label if possible
    - anything else -> FAIL
    """
    status = (row.get("status") or "").strip().lower()
    root_id = (row.get("root_id") or "").strip()

    if status == "converged":
        if root_id:
            return root_id

        root = _extract_root(row)
        if root is not None and root_label_map is not None:
            for raw_root, label in root_label_map.items():
                if abs(raw_root - root) <= 1e-12:
                    return label

            # fallback if exact raw match is not found
            return f"{root:.6f}"

    return "FAIL"


def extract_problem_method_rows(
    rows: List[Dict[str, str]],
    problem_id: str,
    method: str,
) -> List[Dict[str, str]]:
    out = []
    for r in rows:
        if (r.get("problem_id") or "").strip() == problem_id and (r.get("method") or "").strip() == method:
            out.append(r)
    return out


def _label_sort_key(label: str) -> Tuple[int, float, str]:
    if label == "FAIL":
        return (1, float("inf"), label)
    try:
        return (0, float(label), label)
    except Exception:
        return (0, float("inf"), label)


def build_label_mapping(labels: List[str]) -> Tuple[Dict[str, int], List[str]]:
    """
    Put numeric root labels first in ascending order, FAIL last.
    Example:
        ['-2.000000', '1.000000', 'FAIL']
    """
    unique = sorted(set(labels), key=_label_sort_key)
    mapping = {label: i for i, label in enumerate(unique)}
    return mapping, unique


def make_cmap(n: int, has_fail: bool) -> Tuple[ListedColormap, BoundaryNorm]:
    """
    Simple discrete colormap.
    If FAIL is present, reserve last color for FAIL.
    """
    base_colors = [
        "#1f77b4",  # blue
        "#ff7f0e",  # orange
        "#2ca02c",  # green
        "#d62728",  # red
        "#9467bd",  # purple
        "#8c564b",  # brown
        "#e377c2",  # pink
        "#17becf",  # cyan
        "#bcbd22",  # olive
        "#7f7f7f",  # gray
    ]

    colors: List[str] = []

    if has_fail and n >= 1:
        root_count = n - 1
        for i in range(root_count):
            colors.append(base_colors[i % len(base_colors)])
        colors.append("#d3d3d3")  # FAIL in light gray
    else:
        for i in range(n):
            colors.append(base_colors[i % len(base_colors)])

    cmap = ListedColormap(colors)
    norm = BoundaryNorm(boundaries=list(range(n + 1)), ncolors=n)
    return cmap, norm


def infer_root_centers(rows: List[Dict[str, str]], cluster_tol: float = 1e-6) -> Dict[str, float]:
    """
    Infer representative root value for each root label.
    Uses:
    - root_id if present
    - otherwise clustered root label from root value
    """
    root_label_map = build_root_cluster_label_map(rows, cluster_tol=cluster_tol)
    grouped: Dict[str, List[float]] = {}

    for r in rows:
        status = (r.get("status") or "").strip().lower()
        if status != "converged":
            continue

        label = normalize_root_id(r, root_label_map=root_label_map)
        root = _extract_root(r)

        if label != "FAIL" and root is not None:
            grouped.setdefault(label, []).append(root)

    centers: Dict[str, float] = {}
    for rid, vals in grouped.items():
        if vals:
            centers[rid] = sum(vals) / len(vals)

    return centers


def build_display_labels(
    ordered_labels: List[str],
    root_centers: Dict[str, float]
) -> List[str]:
    display_labels: List[str] = []
    for label in ordered_labels:
        if label == "FAIL":
            display_labels.append("fail")
        elif label in root_centers:
            display_labels.append(f"root {label} ≈ {root_centers[label]:.4f}")
        else:
            display_labels.append(f"root {label}")
    return display_labels


def add_root_overlays(ax, root_centers: Dict[str, float]) -> None:
    """
    Draw detected root locations as dashed vertical lines.
    """
    if not root_centers:
        return

    for rid, x_root in sorted(root_centers.items(), key=lambda kv: kv[1]):
        ax.axvline(
            x=x_root,
            linestyle="--",
            linewidth=1.4,
            color="black",
            alpha=0.85,
            zorder=3,
        )

        ax.text(
            x_root,
            1.08,
            f"r{rid} ≈ {x_root:.4f}",
            rotation=90,
            ha="center",
            va="top",
            fontsize=8,
            color="black",
            bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.75),
            clip_on=True,
            zorder=4,
        )


def add_boundary_overlays(ax, rows: List[Dict[str, str]]) -> None:
    """
    Draw clustered boundary centers as thin red vertical lines.
    """
    try:
        boundary_info = detect_boundaries(rows, return_mode="full")
        clustered = boundary_info.get("clustered", [])
    except Exception:
        clustered = []

    if not clustered:
        return

    for region in clustered:
        center = parse_float(region.get("center"))
        if center is None:
            continue

        ax.axvline(
            x=center,
            linestyle="-",
            linewidth=0.9,
            color="red",
            alpha=0.75,
            zorder=2,
        )


def plot_basin_map(
    rows: List[Dict[str, str]],
    problem_id: str,
    method: str,
    output_dir: Path,
    cluster_tol: float = 1e-6,
) -> Path:
    if not rows:
        raise ValueError(f"No rows found for problem={problem_id}, method={method}")

    root_label_map = build_root_cluster_label_map(rows, cluster_tol=cluster_tol)

    processed = []
    for r in rows:
        x0 = _extract_x0(r)
        if x0 is None:
            continue

        basin_label = normalize_root_id(r, root_label_map=root_label_map)
        processed.append((x0, basin_label))

    if not processed:
        raise ValueError(f"No valid x0 rows found for problem={problem_id}, method={method}")

    processed.sort(key=lambda t: t[0])

    xs = [t[0] for t in processed]
    labels = [t[1] for t in processed]

    label_to_int, ordered_labels = build_label_mapping(labels)
    values = [label_to_int[label] for label in labels]

    has_fail = "FAIL" in ordered_labels
    cmap, norm = make_cmap(len(ordered_labels), has_fail=has_fail)

    root_centers = infer_root_centers(rows, cluster_tol=cluster_tol)
    display_labels = build_display_labels(ordered_labels, root_centers)

    data = [values]

    fig, ax = plt.subplots(figsize=(14, 3.4))
    im = ax.imshow(
        data,
        aspect="auto",
        cmap=cmap,
        norm=norm,
        extent=[xs[0], xs[-1], 0, 1],
        interpolation="nearest",
    )

    ax.set_ylim(0, 1.15)

    add_boundary_overlays(ax, rows)
    add_root_overlays(ax, root_centers)

    ax.set_yticks([])
    ax.set_ylabel("")
    ax.set_xlabel(r"Initial guess $x_0$")
    ax.set_title(f"Root-Labeled Basin Map — {problem_id} — {method}")

    cbar = plt.colorbar(im, ax=ax, ticks=list(range(len(ordered_labels))))
    cbar.ax.set_yticklabels(display_labels)
    cbar.set_label("Attractor / outcome")

    plt.tight_layout()

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"basin_map_{problem_id}_{method}.png"
    plt.savefig(out_path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return out_path


def main():
    latest = find_latest_sweep()
    rows = load_rows(latest / "records.csv")

    # Change these as needed
    problem_id = "p4"
    method = "newton"

    out_path = plot_basin_map(
        rows=extract_problem_method_rows(rows, problem_id, method),
        problem_id=problem_id,
        method=method,
        output_dir=latest,
    )

    print(f"Saved basin map to: {out_path}")


if __name__ == "__main__":
    main()