from __future__ import annotations

import random
from typing import List, Optional, Tuple


def linspace(a: float, b: float, n: int) -> List[float]:
    if n <= 1:
        return [float(a)]
    step = (b - a) / (n - 1)
    return [float(a + i * step) for i in range(n)]


def clip_to_range(values: List[float], bounds: Tuple[float, float]) -> List[float]:
    lo, hi = float(bounds[0]), float(bounds[1])
    return [min(max(v, lo), hi) for v in values]


def generate_initial_points(
    *,
    sampling_mode: str,
    value_range: Tuple[float, float],
    n_points: int,
    n_samples: int,
    random_seed: Optional[int] = None,
    gaussian_mean: Optional[float] = None,
    gaussian_std: Optional[float] = None,
    clip_gaussian_to_range: bool = True,
) -> List[float]:
    x_min, x_max = float(value_range[0]), float(value_range[1])

    if x_min >= x_max:
        raise ValueError("value_range must satisfy x_min < x_max")

    if sampling_mode == "grid":
        return linspace(x_min, x_max, n_points)

    rng = random.Random(random_seed)

    if sampling_mode == "uniform":
        if n_samples < 1:
            raise ValueError("uniform mode requires n_samples >= 1")
        return [rng.uniform(x_min, x_max) for _ in range(n_samples)]

    if sampling_mode == "gaussian":
        if n_samples < 1:
            raise ValueError("gaussian mode requires n_samples >= 1")
        if gaussian_mean is None:
            raise ValueError("gaussian mode requires gaussian_mean")
        if gaussian_std is None or gaussian_std <= 0:
            raise ValueError("gaussian mode requires gaussian_std > 0")

        pts = [rng.gauss(float(gaussian_mean), float(gaussian_std)) for _ in range(n_samples)]
        if clip_gaussian_to_range:
            pts = clip_to_range(pts, (x_min, x_max))
        return pts

    raise ValueError(f"Unsupported sampling_mode: {sampling_mode}")