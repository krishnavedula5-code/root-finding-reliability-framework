from __future__ import annotations

import math

from numerical_lab.benchmarks.benchmark_types import BenchmarkProblem
from numerical_lab.benchmarks.registry import register


def _poly_01_f(x: float) -> float:
    return x * x - 2.0


def _poly_01_df(x: float) -> float:
    return 2.0 * x


register(
    BenchmarkProblem(
        problem_id="poly_01",
        name="Quadratic: x^2 - 2",
        category="polynomial",
        expr="x**2 - 2",
        dexpr="2*x",
        function=_poly_01_f,
        derivative=_poly_01_df,
        domain=(-3.0, 3.0),
        known_roots=[-math.sqrt(2.0), math.sqrt(2.0)],
        description="Classic quadratic with two simple real roots.",
        analytic_notes=(
            "Two simple real roots at ±sqrt(2). Newton should converge rapidly "
            "near either root, but the derivative vanishes at x=0, making that "
            "point a derivative-based pathology. Bracketing methods should work "
            "reliably on intervals containing a sign change."
        ),
    )
)


def _poly_02_f(x: float) -> float:
    return x**3 - x - 2.0


def _poly_02_df(x: float) -> float:
    return 3.0 * x * x - 1.0


register(
    BenchmarkProblem(
        problem_id="poly_02",
        name="Cubic: x^3 - x - 2",
        category="polynomial",
        expr="x**3 - x - 2",
        dexpr="3*x**2 - 1",
        function=_poly_02_f,
        derivative=_poly_02_df,
        domain=(-3.0, 3.0),
        known_roots=[1.5213797068045676],
        description="Nonlinear cubic with one real root.",
        analytic_notes=(
            "One real root near 1.52138. The derivative 3x^2 - 1 vanishes at "
            "x = ±1/sqrt(3), so Newton may slow down or take unstable steps near "
            "those points. Bracketing methods are expected to be robust when a "
            "valid sign-change interval is supplied."
        ),
    )
)


def _poly_03_f(x: float) -> float:
    return x * (x - 1.0) * (x + 1.0)


def _poly_03_df(x: float) -> float:
    return 3.0 * x * x - 1.0


register(
    BenchmarkProblem(
        problem_id="poly_03",
        name="Triple-root-location cubic: x(x-1)(x+1)",
        category="polynomial",
        expr="x*(x - 1)*(x + 1)",
        dexpr="3*x**2 - 1",
        function=_poly_03_f,
        derivative=_poly_03_df,
        domain=(-2.0, 2.0),
        known_roots=[-1.0, 0.0, 1.0],
        description="Cubic with three distinct real roots.",
        analytic_notes=(
            "Three simple real roots at -1, 0, and 1. Useful for basin-of-attraction "
            "structure and root-coverage analysis. Newton may show basin partitioning, "
            "while bracketing methods depend strongly on interval placement and sign changes."
        ),
    )
)

def _poly_04_f(x: float) -> float:
    return x**4 - 10.0 * x**2 + 9.0


def _poly_04_df(x: float) -> float:
    return 4.0 * x**3 - 20.0 * x


register(
    BenchmarkProblem(
        problem_id="poly_04",
        name="Quartic: x^4 - 10x^2 + 9",
        category="polynomial",
        expr="x**4 - 10*x**2 + 9",
        dexpr="4*x**3 - 20*x",
        function=_poly_04_f,
        derivative=_poly_04_df,
        domain=(-4.0, 4.0),
        known_roots=[-3.0, -1.0, 1.0, 3.0],
        description="Quartic with four simple real roots.",
        analytic_notes=(
            "Four simple real roots at ±1 and ±3. Useful for root coverage and "
            "multi-basin structure. Newton may partition the domain into several "
            "attraction regions around the four roots."
        ),
    )
)


def _poly_05_f(x: float) -> float:
    return x**5 - x - 1.0


def _poly_05_df(x: float) -> float:
    return 5.0 * x**4 - 1.0


register(
    BenchmarkProblem(
        problem_id="poly_05",
        name="Quintic: x^5 - x - 1",
        category="polynomial",
        expr="x**5 - x - 1",
        dexpr="5*x**4 - 1",
        function=_poly_05_f,
        derivative=_poly_05_df,
        domain=(-2.0, 2.0),
        known_roots=[1.1673039782614187],
        description="Nonlinear quintic with one real root.",
        analytic_notes=(
            "One real root near 1.167304. The derivative vanishes where 5x^4 = 1, "
            "so derivative-based methods may show sensitivity near those regions."
        ),
    )
)