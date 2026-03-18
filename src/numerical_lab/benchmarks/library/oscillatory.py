from __future__ import annotations

import math

from numerical_lab.benchmarks.benchmark_types import BenchmarkProblem
from numerical_lab.benchmarks.registry import register


def _osc_01_f(x: float) -> float:
    return math.sin(x)


def _osc_01_df(x: float) -> float:
    return math.cos(x)


register(
    BenchmarkProblem(
        problem_id="osc_01",
        name="Sine: sin(x)",
        category="oscillatory",
        expr="sin(x)",
        dexpr="cos(x)",
        function=_osc_01_f,
        derivative=_osc_01_df,
        domain=(-2.0 * math.pi, 2.0 * math.pi),
        known_roots=[-math.pi, 0.0, math.pi],
        description="Oscillatory function with multiple roots in the domain.",
        analytic_notes=(
            "Oscillatory benchmark with several roots across the selected domain. "
            "Useful for root-coverage and basin partition behavior. Newton may jump "
            "between attraction regions depending on the starting point."
        ),
    )
)


def _osc_02_f(x: float) -> float:
    return math.sin(5.0 * x)


def _osc_02_df(x: float) -> float:
    return 5.0 * math.cos(5.0 * x)


register(
    BenchmarkProblem(
        problem_id="osc_02",
        name="High-frequency sine: sin(5x)",
        category="oscillatory",
        expr="sin(5*x)",
        dexpr="5*cos(5*x)",
        function=_osc_02_f,
        derivative=_osc_02_df,
        domain=(-2.0, 2.0),
        known_roots=[
            -1.8849555921538759,
            -1.2566370614359172,
            -0.6283185307179586,
            0.0,
            0.6283185307179586,
            1.2566370614359172,
            1.8849555921538759,
        ],
        description="Higher-frequency oscillatory benchmark with many roots.",
        analytic_notes=(
            "Multiple roots in a compact interval. Good for root coverage, basin fragmentation, "
            "and oscillatory sensitivity analysis."
        ),
    )
)


def _osc_03_f(x: float) -> float:
    return x * math.cos(x)


def _osc_03_df(x: float) -> float:
    return math.cos(x) - x * math.sin(x)


register(
    BenchmarkProblem(
        problem_id="osc_03",
        name="Amplitude-modulated oscillation: x cos(x)",
        category="oscillatory",
        expr="x*cos(x)",
        dexpr="cos(x) - x*sin(x)",
        function=_osc_03_f,
        derivative=_osc_03_df,
        domain=(-8.0, 8.0),
        known_roots=[
            -7.853981633974483,
            -4.71238898038469,
            -1.5707963267948966,
            0.0,
            1.5707963267948966,
            4.71238898038469,
            7.853981633974483,
        ],
        description="Oscillatory benchmark with amplitude scaling by x.",
        analytic_notes=(
            "Roots occur at x=0 and x=(pi/2)+k*pi where cos(x)=0. Useful for studying "
            "multi-root oscillatory structure on a larger domain."
        ),
    )
)