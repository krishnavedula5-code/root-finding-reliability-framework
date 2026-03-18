from __future__ import annotations

from numerical_lab.benchmarks.benchmark_types import BenchmarkProblem
from numerical_lab.benchmarks.registry import register
import math


def _path_01_f(x: float) -> float:
    return x**3 - 2.0 * x + 2.0


def _path_01_df(x: float) -> float:
    return 3.0 * x * x - 2.0


register(
    BenchmarkProblem(
        problem_id="path_01",
        name="Newton pathology: x^3 - 2x + 2",
        category="pathological",
        expr="x**3 - 2*x + 2",
        dexpr="3*x**2 - 2",
        function=_path_01_f,
        derivative=_path_01_df,
        domain=(-3.0, 3.0),
        known_roots=[-1.7692923542386314],
        description="Known example where Newton can behave poorly for some initial guesses.",
        analytic_notes=(
            "This function is a standard Newton pathology example. Certain initial points can "
            "lead to oscillation or failure to converge cleanly. Good for testing instability detection."
        ),
    )
)


def _path_02_f(x: float) -> float:
    return x**3


def _path_02_df(x: float) -> float:
    return 3.0 * x * x


register(
    BenchmarkProblem(
        problem_id="path_02",
        name="Flat derivative near root: x^3",
        category="pathological",
        expr="x**3",
        dexpr="3*x**2",
        function=_path_02_f,
        derivative=_path_02_df,
        domain=(-2.0, 2.0),
        known_roots=[0.0],
        description="Flat derivative near the root causing slow derivative-based progress.",
        analytic_notes=(
            "Root at x=0 with derivative also vanishing there. Newton loses quadratic behavior "
            "and typically converges only linearly for this multiple-root-type structure."
        ),
    )
)


def _path_03_f(x: float) -> float:
    return x**3 - 5.0 * x


def _path_03_df(x: float) -> float:
    return 3.0 * x**2 - 5.0


register(
    BenchmarkProblem(
        problem_id="path_03",
        name="Critical-point cubic: x^3 - 5x",
        category="pathological",
        expr="x**3 - 5*x",
        dexpr="3*x**2 - 5",
        function=_path_03_f,
        derivative=_path_03_df,
        domain=(-3.0, 3.0),
        known_roots=[-math.sqrt(5.0), 0.0, math.sqrt(5.0)],
        description="Cubic with three roots and derivative critical points affecting Newton behavior.",
        analytic_notes=(
            "Three real roots at -sqrt(5), 0, and sqrt(5). The derivative vanishes at "
            "x=±sqrt(5/3), so Newton can become sensitive near those critical points."
        ),
    )
)


def _path_04_f(x: float) -> float:
    return x - math.tanh(5.0 * x)


def _path_04_df(x: float) -> float:
    t = math.tanh(5.0 * x)
    return 1.0 - 5.0 * (1.0 - t * t)


register(
    BenchmarkProblem(
        problem_id="path_04",
        name="Saturated nonlinearity: x - tanh(5x)",
        category="pathological",
        expr="x - tanh(5*x)",
        dexpr="1 - 5*(1 - tanh(5*x)**2)",
        function=_path_04_f,
        derivative=_path_04_df,
        domain=(-2.0, 2.0),
        known_roots=[0.0, -0.9999091217155955, 0.9999091217155955],
        description="Nonlinear benchmark with saturation and multiple roots.",
        analytic_notes=(
            "Has three real roots in the chosen domain, one at 0 and two near ±1. "
            "Useful for studying attraction basins under strongly nonlinear saturated behavior."
        ),
    )
)