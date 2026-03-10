from __future__ import annotations

import matplotlib
matplotlib.use("Agg")

import csv
from pathlib import Path
from typing import Dict, List, Tuple, Optional

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


def normalize_root_id(row: Dict[str, str]) -> str:
    """
    Return a basin label for plotting.

    Rules:
    - converged + valid root_id -> that root_id
    - anything else -> FAIL
    """
    status = (row.get("status") or "").strip().lower()
    root_id = (row.get("root_id") or "").strip()

    if status == "converged" and root_id:
        return root_id

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


def build_label_mapping(labels: List[str]) -> Tuple[Dict[str, int], List[str]]:
    """
    Put normal root labels first, FAIL last.
    Example:
        ['0', '1', 'FAIL'] -> {'0':0, '1':1, 'FAIL':2}
    """
    unique = sorted(set(labels), key=lambda s: (s == "FAIL", s))
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


def infer_root_centers(rows: List[Dict[str, str]]) -> Dict[str, float]:
    """
    Infer representative root value for each root_id from converged rows.
    Uses mean(root) per root_id.
    """
    grouped: Dict[str, List[float]] = {}

    for r in rows:
        status = (r.get("status") or "").strip().lower()
        root_id = (r.get("root_id") or "").strip()
        root = parse_float(r.get("root"))

        if status == "converged" and root_id and root is not None:
            grouped.setdefault(root_id, []).append(root)

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
) -> Path:
    if not rows:
        raise ValueError(f"No rows found for problem={problem_id}, method={method}")

    processed = []
    for r in rows:
        x0 = parse_float(r.get("x0"), None)
        if x0 is None:
            continue
        basin_label = normalize_root_id(r)
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

    root_centers = infer_root_centers(rows)
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
    ax.set_title(f"Basin map — {problem_id} — {method}")

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