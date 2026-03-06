from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional, Any


@dataclass(frozen=True)
class BenchmarkSpec:
    id: str
    name: str
    expr: str
    dexpr: Optional[str]
    a: float
    b: float
    notes: str = ""
    tags: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["tags"] = list(self.tags)
        return d


BENCHMARKS: list[BenchmarkSpec] = [
    # Your original P1–P4
    BenchmarkSpec(
        id="P1",
        name="x^3 - 2x + 2",
        expr="x**3 - 2*x + 2",
        dexpr="3*x**2 - 2",
        a=-2.0,
        b=0.0,
        notes="Newton can oscillate/diverge for some initial guesses; great tail-risk case.",
        tags=("polynomial", "newton_fail", "tail_risk"),
    ),
    BenchmarkSpec(
        id="P2",
        name="x^3 - x - 2",
        expr="x**3 - x - 2",
        dexpr="3*x**2 - 1",
        a=1.0,
        b=2.0,
        notes="Baseline well-behaved cubic.",
        tags=("polynomial", "baseline"),
    ),
    BenchmarkSpec(
        id="P3",
        name="cos(x) - x",
        expr="cos(x) - x",
        dexpr="-sin(x) - 1",
        a=0.0,
        b=1.0,
        notes="Transcendental fixed-point equation; clean convergence curves.",
        tags=("transcendental", "baseline"),
    ),
    BenchmarkSpec(
        id="P4",
        name="(x-1)^2 (x+2)",
        expr="((x-1)**2)*(x+2)",
        dexpr="2*(x-1)*(x+2) + (x-1)**2",
        a=-3.0,
        b=2.0,
        notes="Multiple root at x=1; order reduction and tail inflation.",
        tags=("polynomial", "multiple_root", "order_reduction"),
    ),

    # New additions (Option B depth)
    BenchmarkSpec(
        id="B5",
        name="exp(-x) - x",
        expr="exp(-x) - x",
        dexpr="-exp(-x) - 1",
        a=0.0,
        b=1.0,
        notes="Classic transcendental root near 0.567.",
        tags=("transcendental",),
    ),
    BenchmarkSpec(
        id="B6",
        name="x*exp(x) - 1",
        expr="x*exp(x) - 1",
        dexpr="exp(x)*(x+1)",
        a=0.0,
        b=1.0,
        notes="Exponential growth; stresses step control.",
        tags=("transcendental",),
    ),
    BenchmarkSpec(
        id="B7",
        name="x^5 - x - 1",
        expr="x**5 - x - 1",
        dexpr="5*x**4 - 1",
        a=1.0,
        b=2.0,
        notes="Higher-degree polynomial; good basin structure.",
        tags=("polynomial",),
    ),
    BenchmarkSpec(
        id="B8",
        name="log(x) - 1",
        expr="log(x) - 1",
        dexpr="1/x",
        a=2.0,
        b=4.0,
        notes="Domain-sensitive (x>0).",
        tags=("transcendental", "domain_sensitive"),
    ),
    BenchmarkSpec(
        id="B9",
        name="sin(5x) - x/2",
        expr="sin(5*x) - x/2",
        dexpr="5*cos(5*x) - 0.5",
        a=0.0,
        b=2.0,
        notes="Oscillatory with multiple roots; methods may land in different roots.",
        tags=("oscillatory", "multi_root"),
    ),
    BenchmarkSpec(
        id="B10",
        name="cos(3x) - x",
        expr="cos(3*x) - x",
        dexpr="-3*sin(3*x) - 1",
        a=0.0,
        b=1.0,
        notes="Oscillatory transcendental; nice tail behavior.",
        tags=("oscillatory", "transcendental"),
    ),
    BenchmarkSpec(
        id="B11",
        name="x^3 - 7x + 6",
        expr="x**3 - 7*x + 6",
        dexpr="3*x**2 - 7",
        a=0.0,
        b=1.0,
        notes="Multiple real roots; bracket selects one root.",
        tags=("polynomial", "multi_root"),
    ),
    BenchmarkSpec(
        id="B12",
        name="tan(x) - x",
        expr="tan(x) - x",
        dexpr="(1/cos(x))**2 - 1",
        a=4.0,
        b=4.5,
        notes="Near asymptotes; great stress test for safeguards.",
        tags=("hard_case", "domain_sensitive"),
    ),
]


def list_benchmarks() -> list[dict]:
    return [b.to_dict() for b in BENCHMARKS]


def get_benchmark(bench_id: str) -> Optional[dict]:
    bid = (bench_id or "").strip()
    for b in BENCHMARKS:
        if b.id == bid:
            return b.to_dict()
    return None