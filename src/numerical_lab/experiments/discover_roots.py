from __future__ import annotations

"""
Automatic root discovery via sweep of initial guesses.

Purpose
-------
Given an equation f(x) and solver, sweep many initial guesses,
run the solver, collect converged terminal roots, and cluster them.

This enables:
- automatic basin detection
- per-root statistics
- generalized experiments
"""

from dataclasses import dataclass, field
from typing import List


# ------------------------------
# Data structures
# ------------------------------

@dataclass
class RootCluster:
    root_id: int
    center: float
    members: List[float] = field(default_factory=list)
    support: int = 0


# ------------------------------
# Utility functions
# ------------------------------

def linspace(a: float, b: float, n: int) -> List[float]:
    if n < 2:
        return [float(a)]

    step = (b - a) / (n - 1)
    return [a + i * step for i in range(n)]


# ------------------------------
# Root clustering
# ------------------------------

def cluster_roots(roots: List[float], cluster_tol: float = 1e-6) -> List[RootCluster]:

    clusters: List[RootCluster] = []

    for r in roots:

        matched = False

        for c in clusters:

            if abs(r - c.center) <= cluster_tol:
                c.members.append(r)
                c.support += 1
                c.center = sum(c.members) / len(c.members)
                matched = True
                break

        if not matched:
            new_cluster = RootCluster(
                root_id=len(clusters),
                center=r,
                members=[r],
                support=1,
            )
            clusters.append(new_cluster)

    return clusters


# ------------------------------
# Main discovery pipeline
# ------------------------------

def discover_roots(
    roots: List[float],
    cluster_tol: float = 1e-6,
) -> List[RootCluster]:

    """
    Temporary placeholder version.

    For now this function only clusters a list of roots.
    Later we will connect it to solver sweeps.
    """

    clusters = cluster_roots(roots, cluster_tol)

    return clusters


# ------------------------------
# Simple test
# ------------------------------

if __name__ == "__main__":

    # Example roots produced by solver
    sample_roots = [
        1.0000000001,
        0.9999999999,
        -2.0000000002,
        -1.9999999997,
    ]

    clusters = discover_roots(sample_roots)

    print("\nDiscovered clusters:\n")

    for c in clusters:
        print(f"root_{c.root_id}: {c.center:.10f}  support={c.support}")