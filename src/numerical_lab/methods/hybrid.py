from __future__ import annotations

from typing import Callable, Optional

import math

from numerical_lab.core.base import RootSolver, SolverResult
from numerical_lab.expr.numerical_derivative import central_diff


class HybridBisectionNewtonSolver(RootSolver):
    """
    Hybrid solver (Bisection safety + Newton acceleration).

    This implementation uses true BRACKET mode only:
    - requires initial sign change f(a) * f(b) < 0
    - maintains sign-change bracket
    - attempts Newton from midpoint when safe
    - falls back to bisection otherwise

    Records full trace and emits events for teaching/debug.

    Key robustness features:
    - Safe derivative evaluation (analytic or numerical)
    - Newton accept rule (residual improvement vs midpoint)
    - If Newton "accepts" but doesn't move due to float precision / clamping,
      fallback to midpoint bisection for that iteration
    - Stagnation termination only when bisection cannot move anymore
    """

    def __init__(
        self,
        f: Callable[[float], float],
        df: Optional[Callable[[float], float]],
        a: float,
        b: float,
        tol: float = 1e-8,
        max_iter: int = 100,
        numerical_derivative: bool = False,
        df_tol: float = 1e-14,
        stagnation_tol: float = 1e-14,
        newton_accept_c: float = 0.0,  # accept if |f(newton)| <= (1-c)*|f(mid)|
        tol_x: Optional[float] = None,  # step tolerance; defaults to tol
    ):
        super().__init__(f=f, tol=tol, max_iter=max_iter)
        self.df = df
        self.numerical_derivative = bool(numerical_derivative)

        self.a = float(a)
        self.b = float(b)

        self.df_tol = float(df_tol)
        self.stagnation_tol = float(stagnation_tol)
        self.newton_accept_c = float(newton_accept_c)

        # Split tolerances
        self.tol_f = float(tol)
        self.tol_bracket = float(tol)
        self.tol_x = float(tol_x) if tol_x is not None else float(tol)

    # -------------------------
    # Derivative helpers
    # -------------------------
    def _safe_eval_df(self, x: float) -> float:
        """
        Returns df(x) or NaN if derivative is unavailable/non-finite.
        Uses numerical derivative if enabled or df is None.
        """
        try:
            if self.numerical_derivative or self.df is None:
                val = float(central_diff(self.f, x))
            else:
                val = float(self.df(x))

            if hasattr(self, "n_df"):
                self.n_df += 1  # type: ignore[attr-defined]

            if not math.isfinite(val):
                return float("nan")
            return val
        except Exception:
            return float("nan")

    # -------------------------
    # Main solve
    # -------------------------
    def solve(self) -> SolverResult:
        a, b = self.a, self.b
        if b < a:
            a, b = b, a

        fa = self._safe_eval(a)
        fb = self._safe_eval(b)

        if fa is None or fb is None:
            self._event(
                "nonfinite",
                code="NONFINITE",
                level="error",
                a=a,
                b=b,
                fa=fa,
                fb=fb,
                where="f(a) or f(b)",
            )
            return SolverResult(
                method="hybrid",
                root=None,
                status="nan_or_inf",
                stop_reason="NAN_INF",
                message="f(a) or f(b) failed evaluation (NaN/Inf/error).",
                iterations=0,
                records=[],
                events=self.events,
                best_x=None,
                best_fx=None,
                tol=self.tol_f,
                n_f=self.n_f,
                n_df=getattr(self, "n_df", 0),
            )

        # Exact root at endpoints
        if fa == 0.0:
            self._record(k=0, x=a, fx=fa, x_prev=None, step_type="exact", a=a, b=b, meta={"endpoint": "a"})
            self._event("exact_root", k=0, code="EXACT_ROOT", level="info", x=a, fx=fa)
            self._event("termination", k=0, code="EXACT_ROOT", level="info", reason="endpoint_a")
            return SolverResult(
                method="hybrid",
                root=a,
                status="converged",
                stop_reason="EXACT_ROOT",
                message="Exact root at a.",
                iterations=0,
                records=self.records,
                events=self.events,
                best_x=a,
                best_fx=fa,
                tol=self.tol_f,
                n_f=self.n_f,
                n_df=getattr(self, "n_df", 0),
            )

        if fb == 0.0:
            self._record(k=0, x=b, fx=fb, x_prev=None, step_type="exact", a=a, b=b, meta={"endpoint": "b"})
            self._event("exact_root", k=0, code="EXACT_ROOT", level="info", x=b, fx=fb)
            self._event("termination", k=0, code="EXACT_ROOT", level="info", reason="endpoint_b")
            return SolverResult(
                method="hybrid",
                root=b,
                status="converged",
                stop_reason="EXACT_ROOT",
                message="Exact root at b.",
                iterations=0,
                records=self.records,
                events=self.events,
                best_x=b,
                best_fx=fb,
                tol=self.tol_f,
                n_f=self.n_f,
                n_df=getattr(self, "n_df", 0),
            )

        # Require a true bracket
        bracket_mode = (fa * fb) < 0.0
        if not bracket_mode:
            self._event(
                "invalid_bracket",
                code="BAD_BRACKET",
                level="error",
                a=a,
                b=b,
                fa=fa,
                fb=fb,
                note="Initial interval does not bracket a root.",
            )
            return SolverResult(
                method="hybrid",
                root=None,
                status="bad_bracket",
                stop_reason="BAD_BRACKET",
                message="Initial interval does not bracket a root.",
                iterations=0,
                records=[],
                events=self.events,
                best_x=None,
                best_fx=None,
                tol=self.tol_f,
                n_f=self.n_f,
                n_df=getattr(self, "n_df", 0),
            )

        self._event(
            "init_interval",
            code="INIT_BRACKET",
            level="info",
            a=a,
            b=b,
            fa=fa,
            fb=fb,
            mode="BRACKET",
            tol_f=self.tol_f,
            tol_x=self.tol_x,
            tol_bracket=self.tol_bracket,
            numerical_derivative=self.numerical_derivative,
        )

        x_prev: Optional[float] = None
        best_x: Optional[float] = None
        best_fx: Optional[float] = None

        def upd_best(xv: float, fxv: float) -> None:
            nonlocal best_x, best_fx
            if best_fx is None or abs(fxv) < abs(best_fx):
                best_x, best_fx = xv, fxv

        upd_best(a, fa)
        upd_best(b, fb)

        for k in range(1, self.max_iter + 1):
            interval_err = (b - a) / 2.0

            # midpoint
            m = (a + b) / 2.0
            fm = self._safe_eval(m)
            if fm is None:
                self._event("nonfinite", k=k, code="NONFINITE", level="error", m=m, where="f(midpoint)")
                return SolverResult(
                    method="hybrid",
                    root=None,
                    status="nan_or_inf",
                    stop_reason="NAN_INF",
                    message="Midpoint evaluation failed (NaN/Inf/error).",
                    iterations=k - 1,
                    records=self.records,
                    events=self.events,
                    best_x=best_x,
                    best_fx=best_fx,
                    tol=self.tol_f,
                    n_f=self.n_f,
                    n_df=getattr(self, "n_df", 0),
                )

            self._event(
                "midpoint",
                k=k,
                code="MIDPOINT",
                level="info",
                a=a,
                b=b,
                m=m,
                fm=fm,
                interval_err=interval_err,
                mode="BRACKET",
            )

            # default candidate: bisection step
            x_candidate = m
            f_candidate = fm
            step_type = "bisection"

            # newton metadata
            reject_reason: Optional[str] = None
            dfm: float = self._safe_eval_df(m)
            x_newton: Optional[float] = None
            fx_newton: Optional[float] = None

            # Try Newton if derivative looks usable
            if (not math.isfinite(dfm)) or abs(dfm) < self.df_tol:
                reject_reason = "df_small_or_invalid"
                self._event(
                    "newton_reject",
                    k=k,
                    code="STEP_REJECTED",
                    level="warn",
                    reason=reject_reason,
                    m=m,
                    dfm=dfm,
                    df_tol=self.df_tol,
                )
            else:
                self._event("newton_attempt", k=k, code="NEWTON_ATTEMPT", level="info", m=m, fm=fm, dfm=dfm)
                x_newton = m - fm / dfm

                eps = 10.0 * abs(b - a) * 1e-15 + 1e-15

                if x_newton < a - eps or x_newton > b + eps:
                    reject_reason = "step_outside_interval"
                    self._event(
                        "newton_reject",
                        k=k,
                        code="STEP_REJECTED",
                        level="warn",
                        reason=reject_reason,
                        x_newton=x_newton,
                        a=a,
                        b=b,
                        eps=eps,
                    )
                else:
                    if x_newton < a:
                        x_newton = a
                    if x_newton > b:
                        x_newton = b

                    fx_newton = self._safe_eval(x_newton)
                    if fx_newton is None:
                        reject_reason = "fx_newton_invalid"
                        self._event(
                            "newton_reject",
                            k=k,
                            code="NONFINITE",
                            level="error",
                            reason=reject_reason,
                            x_newton=x_newton,
                        )
                    else:
                        thresh = (1.0 - self.newton_accept_c) * abs(fm)
                        if abs(fx_newton) <= thresh:
                            step_type = "newton"
                            reject_reason = None
                            x_candidate = x_newton
                            f_candidate = fx_newton
                            self._event(
                                "newton_accept",
                                k=k,
                                code="NEWTON_ACCEPT",
                                level="info",
                                x=x_candidate,
                                fx=f_candidate,
                                threshold=thresh,
                            )
                        else:
                            reject_reason = "no_residual_improvement"
                            self._event(
                                "newton_reject",
                                k=k,
                                code="STEP_REJECTED",
                                level="warn",
                                reason=reject_reason,
                                fm=fm,
                                fx_newton=fx_newton,
                                threshold=thresh,
                            )

            dx = None if x_prev is None else abs(x_candidate - x_prev)

            # If Newton accepted but didn't move, fallback to bisection
            if step_type == "newton" and x_prev is not None and dx is not None:
                min_move = max(self.stagnation_tol, 10.0 * math.ulp(x_candidate))
                if dx < min_move:
                    self._event(
                        "newton_no_move_fallback",
                        k=k,
                        code="NEWTON_NO_MOVE",
                        level="warn",
                        x_prev=x_prev,
                        x_newton=x_candidate,
                        dx=dx,
                        min_move=min_move,
                        note="Newton step did not move; using midpoint bisection fallback.",
                    )
                    step_type = "bisection"
                    reject_reason = "newton_no_move"
                    x_candidate = m
                    f_candidate = fm
                    dx = abs(x_candidate - x_prev)

            # Precision limit check
            if m == a or m == b:
                self._event(
                    "precision_limit",
                    k=k,
                    code="PRECISION_LIMIT",
                    level="warn",
                    a=a,
                    b=b,
                    m=m,
                    note="Midpoint equals an endpoint; cannot shrink interval further in float arithmetic.",
                )
                self._record(
                    k=k,
                    x=x_candidate,
                    fx=f_candidate,
                    x_prev=x_prev,
                    step_type=step_type,
                    accepted=True,
                    reject_reason="precision_limit",
                    a=a,
                    b=b,
                    m=m,
                    fm=fm,
                    dfm=dfm,
                    x_newton=x_newton,
                    fx_newton=fx_newton,
                    meta={"mode": "BRACKET"},
                )
                upd_best(x_candidate, f_candidate)
                self._event("termination", k=k, code="PRECISION_LIMIT", level="warn", reason="float_midpoint_collapse")
                return SolverResult(
                    method="hybrid",
                    root=x_candidate,
                    status="stagnation",
                    stop_reason="STAGNATION",
                    message="Precision limit reached (midpoint collapse); cannot progress further in float arithmetic.",
                    iterations=k,
                    records=self.records,
                    events=self.events,
                    best_x=best_x,
                    best_fx=best_fx,
                    tol=self.tol_f,
                    n_f=self.n_f,
                    n_df=getattr(self, "n_df", 0),
                )

            if dx is not None:
                min_move = max(self.stagnation_tol, 10.0 * math.ulp(x_candidate))
                if dx < min_move and abs(f_candidate) > self.tol_f:
                    self._event(
                        "stagnation",
                        k=k,
                        code="STAGNATION",
                        level="warn",
                        dx=dx,
                        min_move=min_move,
                        stagnation_tol=self.stagnation_tol,
                        note="No meaningful movement; terminating.",
                    )
                    self._record(
                        k=k,
                        x=x_candidate,
                        fx=f_candidate,
                        x_prev=x_prev,
                        step_type=step_type,
                        accepted=True,
                        reject_reason="stagnation",
                        a=a,
                        b=b,
                        m=m,
                        fm=fm,
                        dfm=dfm,
                        x_newton=x_newton,
                        fx_newton=fx_newton,
                        meta={"mode": "BRACKET"},
                    )
                    upd_best(x_candidate, f_candidate)
                    self._event("termination", k=k, code="STAGNATION", level="warn", reason="dx_small")
                    return SolverResult(
                        method="hybrid",
                        root=x_candidate,
                        status="stagnation",
                        stop_reason="STAGNATION",
                        message=f"Stagnation detected (|Δx|<{min_move}).",
                        iterations=k,
                        records=self.records,
                        events=self.events,
                        best_x=best_x,
                        best_fx=best_fx,
                        tol=self.tol_f,
                        n_f=self.n_f,
                        n_df=getattr(self, "n_df", 0),
                    )

            # record iteration
            self._record(
                k=k,
                x=x_candidate,
                fx=f_candidate,
                x_prev=x_prev,
                step_type=step_type,
                accepted=True,
                reject_reason=reject_reason,
                a=a,
                b=b,
                m=m,
                fm=fm,
                dfm=dfm,
                x_newton=x_newton,
                fx_newton=fx_newton,
                meta={
                    "mode": "BRACKET",
                    **({"newton_reject_reason": reject_reason} if (step_type == "bisection" and reject_reason) else {}),
                },
            )
            x_prev = x_candidate
            upd_best(x_candidate, f_candidate)

            # stopping criteria
            if abs(f_candidate) <= self.tol_f:
                self._event(
                    "termination",
                    k=k,
                    code="TOL_F",
                    level="info",
                    reason="residual",
                    abs_fc=abs(f_candidate),
                    tol_f=self.tol_f,
                )
                return SolverResult(
                    method="hybrid",
                    root=x_candidate,
                    status="converged",
                    stop_reason="TOL_F",
                    message="Converged by residual tolerance.",
                    iterations=k,
                    records=self.records,
                    events=self.events,
                    best_x=best_x,
                    best_fx=best_fx,
                    tol=self.tol_f,
                    n_f=self.n_f,
                    n_df=getattr(self, "n_df", 0),
                )

            if dx is not None and dx <= self.tol_x:
                abs_fc = abs(f_candidate)
                if abs_fc <= 10.0 * self.tol_f:
                    self._event(
                        "termination",
                        k=k,
                        code="TOL_X_NEAR_ROOT",
                        level="info",
                        reason="step_near_root",
                        dx=dx,
                        tol_x=self.tol_x,
                        abs_fc=abs_fc,
                        tol_f=self.tol_f,
                    )
                    return SolverResult(
                        method="hybrid",
                        root=x_candidate,
                        status="converged",
                        stop_reason="TOL_X_NEAR_ROOT",
                        message="Converged by step tolerance (near-root guard satisfied).",
                        iterations=k,
                        records=self.records,
                        events=self.events,
                        best_x=best_x,
                        best_fx=best_fx,
                        tol=self.tol_f,
                        n_f=self.n_f,
                        n_df=getattr(self, "n_df", 0),
                    )
                else:
                    self._event(
                        "step_small_but_residual_large",
                        k=k,
                        code="STEP_SMALL_RESIDUAL_LARGE",
                        level="warn",
                        dx=dx,
                        tol_x=self.tol_x,
                        abs_fc=abs_fc,
                        tol_f=self.tol_f,
                        note="Step size small but residual is not; continuing (prevents false convergence).",
                    )

            if interval_err <= self.tol_bracket:
                self._event(
                    "termination",
                    k=k,
                    code="TOL_BRACKET",
                    level="info",
                    reason="interval",
                    interval_err=interval_err,
                    tol_bracket=self.tol_bracket,
                )
                return SolverResult(
                    method="hybrid",
                    root=x_candidate,
                    status="converged",
                    stop_reason="TOL_BRACKET",
                    message="Converged by interval tolerance (bracket mode).",
                    iterations=k,
                    records=self.records,
                    events=self.events,
                    best_x=best_x,
                    best_fx=best_fx,
                    tol=self.tol_f,
                    n_f=self.n_f,
                    n_df=getattr(self, "n_df", 0),
                )

            # bracket update
            if fa * f_candidate < 0:
                b, fb = x_candidate, f_candidate
            else:
                a, fa = x_candidate, f_candidate

            self._event("bracket_update", k=k, code="BRACKET_UPDATE", level="info", a=a, b=b, fa=fa, fb=fb)

        last_x = self.records[-1].x if self.records else None
        last_fx = self.records[-1].fx if self.records else None
        if best_x is None:
            best_x, best_fx = last_x, last_fx

        self._event(
            "termination",
            k=self.max_iter,
            code="MAX_ITER",
            level="warn",
            reason="max_iter_exceeded",
            max_iter=self.max_iter,
        )
        return SolverResult(
            method="hybrid",
            root=last_x,
            status="max_iter",
            stop_reason="MAX_ITER",
            message="Maximum iterations exceeded without convergence.",
            iterations=(self.records[-1].k if self.records else 0),
            records=self.records,
            events=self.events,
            best_x=best_x,
            best_fx=best_fx,
            tol=self.tol_f,
            n_f=self.n_f,
            n_df=getattr(self, "n_df", 0),
        )