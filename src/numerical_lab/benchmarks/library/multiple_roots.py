from __future__ import annotations

from numerical_lab.benchmarks.benchmark_types import BenchmarkProblem
from numerical_lab.benchmarks.registry import register


def _multi_01_f(x: float) -> float:
    return (x - 1.0) ** 2


def _multi_01_df(x: float) -> float:
    return 2.0 * (x - 1.0)


register(
    BenchmarkProblem(
        problem_id="multi_01",
        name="Double root: (x-1)^2",
        category="multiple_roots",
        expr="(x - 1)**2",
        dexpr="2*(x - 1)",
        function=_multi_01_f,
        derivative=_multi_01_df,
        domain=(-2.0, 4.0),
        known_roots=[1.0],
        description="Quadratic with a repeated root of multiplicity 2.",
        analytic_notes=(
            "Repeated root at x=1 with multiplicity 2. Newton is expected to lose "
            "quadratic convergence and typically become only linear near the root. "
            "Also, since the function does not change sign across the root, standard "
            "sign-change bracketing methods are not naturally applicable."
        ),
    )
)


def _multi_02_f(x: float) -> float:
    return (x - 2.0) ** 3


def _multi_02_df(x: float) -> float:
    return 3.0 * (x - 2.0) ** 2


register(
    BenchmarkProblem(
        problem_id="multi_02",
        name="Triple root: (x-2)^3",
        category="multiple_roots",
        expr="(x - 2)**3",
        dexpr="3*(x - 2)**2",
        function=_multi_02_f,
        derivative=_multi_02_df,
        domain=(-1.0, 5.0),
        known_roots=[2.0],
        description="Cubic with a repeated root of multiplicity 3.",
        analytic_notes=(
            "Triple root at x=2. Newton again loses quadratic convergence and becomes "
            "slower near the multiple root. The derivative also becomes small near the root, "
            "which makes this a useful test for derivative-based stagnation diagnostics."
        ),
    )
)


def _multi_03_f(x: float) -> float:
    return (x + 1.0) ** 2 * (x - 2.0)


def _multi_03_df(x: float) -> float:
    return 2.0 * (x + 1.0) * (x - 2.0) + (x + 1.0) ** 2


register(
    BenchmarkProblem(
        problem_id="multi_03",
        name="Mixed multiplicity: (x+1)^2 (x-2)",
        category="multiple_roots",
        expr="(x + 1)**2 * (x - 2)",
        dexpr="2*(x + 1)*(x - 2) + (x + 1)**2",
        function=_multi_03_f,
        derivative=_multi_03_df,
        domain=(-3.0, 3.0),
        known_roots=[-1.0, 2.0],
        description="Polynomial with one repeated root and one simple root.",
        analytic_notes=(
            "Double root at -1 and simple root at 2. Useful for comparing behavior "
            "near repeated versus simple roots within the same problem."
        ),
    )
)


def _multi_04_f(x: float) -> float:
    return (x - 1.0) ** 4


def _multi_04_df(x: float) -> float:
    return 4.0 * (x - 1.0) ** 3


register(
    BenchmarkProblem(
        problem_id="multi_04",
        name="Fourth-order root: (x-1)^4",
        category="multiple_roots",
        expr="(x - 1)**4",
        dexpr="4*(x - 1)**3",
        function=_multi_04_f,
        derivative=_multi_04_df,
        domain=(-1.0, 3.0),
        known_roots=[1.0],
        description="Polynomial with a root of multiplicity 4.",
        analytic_notes=(
            "Root at x=1 with multiplicity 4. Newton is expected to lose quadratic "
            "convergence strongly and behave much more slowly near the root."
        ),
    )
)