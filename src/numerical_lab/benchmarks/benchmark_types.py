from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple


ScalarFunction = Callable[[float], float]


@dataclass(frozen=True)
class BenchmarkProblem:
    problem_id: str
    name: str
    category: str

    expr: str
    dexpr: Optional[str]

    function: ScalarFunction
    derivative: Optional[ScalarFunction]

    domain: Tuple[float, float]
    known_roots: Optional[List[float]]

    description: str
    analytic_notes: str