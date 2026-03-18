from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Sequence, Tuple
import math


@dataclass
class RootCandidate:
    x: float
    residual: Optional[float] = None
    method: Optional[str] = None
    sample_index: Optional[int] = None


@dataclass
class RootCluster:
    center: float
    members: List[float]
    residuals: List[float]
    member_count: int
    min_x: float
    max_x: float


def _safe_float(x: Any) -> Optional[float]:
    try:
        v = float(x)
        if math.isfinite(v):
            return v
        return None
    except (TypeError, ValueError):
        return None


def _merge_tol(a: float, b: float, abs_tol: float, rel_tol: float) -> float:
    scale = max(1.0, abs(a), abs(b))
    return max(abs_tol, rel_tol * scale)


def _is_close(a: float, b: float, abs_tol: float, rel_tol: float) -> bool:
    return abs(a - b) <= _merge_tol(a, b, abs_tol=abs_tol, rel_tol=rel_tol)


def _median(values: Sequence[float]) -> float:
    vals = sorted(values)
    n = len(vals)
    mid = n // 2
    if n % 2 == 1:
        return vals[mid]
    return 0.5 * (vals[mid - 1] + vals[mid])


def _build_cluster(member_values: List[float], residuals: List[float]) -> RootCluster:
    center = _median(member_values)
    return RootCluster(
        center=center,
        members=sorted(member_values),
        residuals=sorted(r for r in residuals if math.isfinite(r)),
        member_count=len(member_values),
        min_x=min(member_values),
        max_x=max(member_values),
    )


def cluster_root_candidates(
    candidates: Sequence[RootCandidate],
    abs_tol: float = 1e-6,
    rel_tol: float = 1e-5,
    residual_tol: Optional[float] = 1e-7,
    min_cluster_size: int = 1,
) -> Dict[str, Any]:
    """
    Cluster converged terminal values into distinct detected roots.

    Rules:
    - ignore non-finite x
    - if residual_tol is not None, ignore candidates with residual > residual_tol
    - sort by x
    - greedily merge close values
    - cluster center = median(member values)
    """

    filtered: List[RootCandidate] = []
    rejected: List[Dict[str, Any]] = []

    for c in candidates:
        x = _safe_float(c.x)
        r = _safe_float(c.residual)

        if x is None:
            rejected.append(
                {"reason": "nonfinite_x", "x": c.x, "residual": c.residual}
            )
            continue

        if residual_tol is not None and r is not None and r > residual_tol:
            rejected.append(
                {"reason": "residual_above_tol", "x": x, "residual": r}
            )
            continue

        filtered.append(
            RootCandidate(
                x=x,
                residual=r,
                method=c.method,
                sample_index=c.sample_index,
            )
        )

    filtered.sort(key=lambda c: c.x)

    raw_clusters: List[List[RootCandidate]] = []
    current: List[RootCandidate] = []

    for cand in filtered:
        if not current:
            current = [cand]
            continue

        current_center = _median([m.x for m in current])
        if _is_close(cand.x, current_center, abs_tol=abs_tol, rel_tol=rel_tol):
            current.append(cand)
        else:
            raw_clusters.append(current)
            current = [cand]

    if current:
        raw_clusters.append(current)

    clusters: List[RootCluster] = []
    discarded_small_clusters: List[Dict[str, Any]] = []

    for group in raw_clusters:
        xs = [g.x for g in group]
        rs = [g.residual for g in group if g.residual is not None]

        if len(xs) < min_cluster_size:
            discarded_small_clusters.append(
                {
                    "reason": "cluster_too_small",
                    "member_count": len(xs),
                    "center_estimate": _median(xs),
                    "members": xs,
                }
            )
            continue

        clusters.append(_build_cluster(xs, rs))

    return {
        "n_candidates_in": len(candidates),
        "n_candidates_used": len(filtered),
        "n_candidates_rejected": len(rejected),
        "n_clusters": len(clusters),
        "clusters": [asdict(c) for c in clusters],
        "rejected_candidates": rejected,
        "discarded_small_clusters": discarded_small_clusters,
        "params": {
            "abs_tol": abs_tol,
            "rel_tol": rel_tol,
            "residual_tol": residual_tol,
            "min_cluster_size": min_cluster_size,
        },
    }


def match_detected_roots_to_known_roots(
    detected_roots: Sequence[float],
    known_roots: Sequence[float],
    abs_tol: float = 1e-6,
    rel_tol: float = 1e-5,
) -> Dict[str, Any]:
    """
    Greedy one-to-one matching between detected and known roots in 1D.
    """

    detected = sorted(float(x) for x in detected_roots if math.isfinite(float(x)))
    known = sorted(float(x) for x in known_roots if math.isfinite(float(x)))

    matched_pairs: List[Dict[str, float]] = []
    unmatched_detected: List[float] = []
    unmatched_known = known.copy()
    used_known = set()

    for d in detected:
        best_j = None
        best_dist = None

        for j, k in enumerate(known):
            if j in used_known:
                continue
            dist = abs(d - k)
            tol = _merge_tol(d, k, abs_tol=abs_tol, rel_tol=rel_tol)
            if dist <= tol:
                if best_dist is None or dist < best_dist:
                    best_dist = dist
                    best_j = j

        if best_j is None:
            unmatched_detected.append(d)
        else:
            used_known.add(best_j)
            matched_pairs.append(
                {
                    "detected_root": d,
                    "known_root": known[best_j],
                    "abs_error": abs(d - known[best_j]),
                }
            )

    unmatched_known = [k for j, k in enumerate(known) if j not in used_known]

    return {
        "matched_pairs": matched_pairs,
        "matched_count": len(matched_pairs),
        "unmatched_detected": unmatched_detected,
        "unmatched_known": unmatched_known,
        "detected_count": len(detected),
        "known_count": len(known),
    }