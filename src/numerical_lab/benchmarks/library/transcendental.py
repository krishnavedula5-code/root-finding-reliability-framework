from __future__ import annotations

import math

from numerical_lab.benchmarks.benchmark_types import BenchmarkProblem
from numerical_lab.benchmarks.registry import register


def _trans_01_f(x: float) -> float:
    return math.exp(-x) - x


def _trans_01_df(x: float) -> float:
    return -math.exp(-x) - 1.0


register(
    BenchmarkProblem(
        problem_id="trans_01",
        name="Exponential fixed-point equation: exp(-x) - x",
        category="transcendental",
        expr="exp(-x) - x",
        dexpr="-exp(-x) - 1",
        function=_trans_01_f,
        derivative=_trans_01_df,
        domain=(-2.0, 2.0),
        known_roots=[0.5671432904097838],
        description="Transcendental equation with one real root.",
        analytic_notes=(
            "Unique real root near 0.567143. Since f'(x) = -exp(-x) - 1 is always negative, "
            "the function is strictly decreasing and has exactly one root. This is a clean, "
            "well-behaved benchmark for comparing solver efficiency and reliability."
        ),
    )
)


def _trans_02_f(x: float) -> float:
    return math.cos(x) - x


def _trans_02_df(x: float) -> float:
    return -math.sin(x) - 1.0


register(
    BenchmarkProblem(
        problem_id="trans_02",
        name="Cosine fixed-point equation: cos(x) - x",
        category="transcendental",
        expr="cos(x) - x",
        dexpr="-sin(x) - 1",
        function=_trans_02_f,
        derivative=_trans_02_df,
        domain=(-2.0, 2.0),
        known_roots=[0.7390851332151607],
        description="Classic transcendental equation with one real root.",
        analytic_notes=(
            "Unique real root near 0.739085. Since -sin(x)-1 <= 0, the derivative is nonpositive, "
            "so the function is monotone nonincreasing over the real line. This makes it a stable "
            "benchmark for global comparison across methods."
        ),
    )
)


def _trans_03_f(x: float) -> float:
    return math.log(x + 2.0) - 0.5 * x


def _trans_03_df(x: float) -> float:
    return 1.0 / (x + 2.0) - 0.5


register(
    BenchmarkProblem(
        problem_id="trans_03",
        name="Log-linear: log(x+2) - x/2",
        category="transcendental",
        expr="log(x+2) - x/2",
        dexpr="1/(x+2) - 1/2",
        function=_trans_03_f,
        derivative=_trans_03_df,
        domain=(-1.9, 4.0),
        known_roots=[0.0, 2.512862417252339],
        description="Transcendental equation mixing logarithmic and linear terms.",
        analytic_notes=(
            "Real roots at x=0 and near x=2.512862. Domain is restricted by x > -2. "
            "Useful for testing domain-sensitive transcendental behavior."
        ),
    )
)


def _trans_04_f(x: float) -> float:
    return math.exp(x) - 3.0 * x


def _trans_04_df(x: float) -> float:
    return math.exp(x) - 3.0


register(
    BenchmarkProblem(
        problem_id="trans_04",
        name="Exponential-linear: exp(x) - 3x",
        category="transcendental",
        expr="exp(x) - 3*x",
        dexpr="exp(x) - 3",
        function=_trans_04_f,
        derivative=_trans_04_df,
        domain=(-1.0, 2.0),
        known_roots=[0.6190612867359452, 1.5121345516578424],
        description="Transcendental equation with two real roots.",
        analytic_notes=(
            "Two real roots near 0.619061 and 1.512135. The derivative vanishes at "
            "x = ln(3), making it useful for derivative-sensitivity testing."
        ),
    )
)