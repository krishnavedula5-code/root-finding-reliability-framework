from __future__ import annotations

import math
from typing import Callable, Optional

from numerical_lab.core.base import RootSolver, SolverResult


class NewtonSolver(RootSolver):
    """
    Newton-Raphson method for f(x)=0.

    Commercial requirements:
    - Records full iteration history
    - Detects derivative near zero
    - Detects NaN/Inf
    - Detects stagnation
    - Teaching trace: stores df, proposed step, and stop_reason
    """

    def __init__(
        self,
        f: Callable[[float], float],
        df: Optional[Callable[[float], float]],
        x0: float,
        tol: float = 1e-8,
        max_iter: int = 50,
        numerical_derivative: bool = False,
        df_tol: float = 1e-14,
        stagnation_tol: float = 1e-14,
        tol_x: Optional[float] = None,  # optional step tolerance (defaults to tol)
    ):
        super().__init__(f=f, tol=tol, max_iter=max_iter)
        self.df = df
        self.numerical_derivative = bool(numerical_derivative)
        self.x0 = float(x0)
        self.df_tol = float(df_tol)
        self.stagnation_tol = float(stagnation_tol)

        # Separate tolerances
        self.tol_f = float(tol)
        self.tol_x = float(tol_x) if tol_x is not None else float(tol)

    def _safe_eval_df(self, x: float) -> float:
        """
        Evaluate analytic df safely.
        Return NaN on any error/nonfinite.
        """
        try:
            if self.df is None:
                return float("nan")
            val = float(self.df(x))
            self.n_df += 1  # ✅ count analytic derivative evaluation
            if not math.isfinite(val):
                return float("nan")
            return val
        except Exception:
            return float("nan")

    def _numerical_df(self, x: float) -> tuple[float, float, float, float]:
        """
        Central difference derivative with scale-aware step.
        Returns: (dfx, h, f(x+h), f(x-h))
        """
        h = 1e-6 * max(1.0, abs(x))
        fxph = self._safe_eval(x + h)
        fxmh = self._safe_eval(x - h)
        self.n_df += 1  # ✅ count one numerical derivative evaluation
        if fxph is None or fxmh is None:
            return (float("nan"), h, float("nan"), float("nan"))
        return ((fxph - fxmh) / (2.0 * h), h, fxph, fxmh)

    def solve(self) -> SolverResult:
        x = self.x0

        fx = self._safe_eval(x)
        if fx is None:
            self._event("nonfinite", k=0, code="NONFINITE", level="error", x=x, where="f(x0)")
            return SolverResult(
                method="newton",
                root=None,
                status="nan_or_inf",
                stop_reason="NAN_INF",
                message="f(x0) could not be evaluated (NaN/Inf/error).",
                iterations=0,
                records=[],
                events=self.events,
                best_x=None,
                best_fx=None,
                tol=self.tol_f,
                n_f=self.n_f,
                n_df=self.n_df,
            )

        # initial record + init event
        self._record(k=0, x=x, fx=fx, x_prev=None, step_type="newton")
        self._event("init", k=0, code="INIT", level="info", x=x, fx=fx, tol_f=self.tol_f, tol_x=self.tol_x)

        best_x: Optional[float] = x
        best_fx: Optional[float] = fx

        # immediate convergence by residual
        if abs(fx) <= self.tol_f:
            self._event("termination", k=0, code="TOL_F", level="info", reason="initial_residual", tol_f=self.tol_f)
            return SolverResult(
                method="newton",
                root=x,
                status="converged",
                stop_reason="TOL_F",
                message="Converged at initial guess by residual.",
                iterations=0,
                records=self.records,
                events=self.events,
                best_x=best_x,
                best_fx=best_fx,
                tol=self.tol_f,
                n_f=self.n_f,
                n_df=self.n_df,
            )

        for k in range(1, self.max_iter + 1):
            # Decide derivative source
            use_num = self.numerical_derivative or (self.df is None)

            if use_num:
                dfx, h, fp, fm = self._numerical_df(x)
                self._event(
                    "num_deriv",
                    k=k,
                    code="NUM_DERIV",
                    level="info",
                    x=x,
                    h=h,
                    fp=fp,
                    fm=fm,
                    dfx=dfx,
                )
            else:
                dfx = self._safe_eval_df(x)

            if dfx is None or not math.isfinite(dfx):
                self._event("nonfinite", k=k, code="NONFINITE", level="error", x=x, where="df(x)")
                return SolverResult(
                    method="newton",
                    root=None,
                    status="nan_or_inf",
                    stop_reason="NAN_INF",
                    message="df(x) could not be evaluated (NaN/Inf/error).",
                    iterations=k - 1,
                    records=self.records,
                    events=self.events,
                    best_x=best_x,
                    best_fx=best_fx,
                    tol=self.tol_f,
                    n_f=self.n_f,
                    n_df=self.n_df,
                )

            if abs(dfx) < self.df_tol:
                self._event(
                    "derivative_too_small",
                    k=k,
                    code="DERIVATIVE_ZERO",
                    level="error",
                    x=x,
                    dfx=dfx,
                    df_tol=self.df_tol,
                )
                return SolverResult(
                    method="newton",
                    root=x,
                    status="derivative_zero",
                    stop_reason="DERIVATIVE_ZERO",
                    message=f"Derivative too small (|df(x)|<{self.df_tol}).",
                    iterations=k - 1,
                    records=self.records,
                    events=self.events,
                    best_x=best_x,
                    best_fx=best_fx,
                    tol=self.tol_f,
                    n_f=self.n_f,
                    n_df=self.n_df,
                )

            # Newton proposed step
            x_new = x - fx / dfx
            dx = abs(x_new - x)
            self._event("newton_step", k=k, code="NEWTON_STEP", level="info", x=x, fx=fx, dfx=dfx, x_new=x_new, dx=dx)

            # stagnation: no movement
            if dx < self.stagnation_tol:
                fx_new = self._safe_eval(x_new)
                if fx_new is None:
                    self._event("nonfinite", k=k, code="NONFINITE", level="error", x=x_new, where="f(x_new)_stagnation")
                    return SolverResult(
                        method="newton",
                        root=None,
                        status="nan_or_inf",
                        stop_reason="NAN_INF",
                        message="f(x_new) could not be evaluated (NaN/Inf/error).",
                        iterations=k - 1,
                        records=self.records,
                        events=self.events,
                        best_x=best_x,
                        best_fx=best_fx,
                        tol=self.tol_f,
                        n_f=self.n_f,
                        n_df=self.n_df,
                    )

                self._record(
                    k=k,
                    x=x_new,
                    fx=fx_new,
                    x_prev=x,
                    step_type="newton",
                    accepted=True,
                    reject_reason="stagnation",
                    dfm=dfx,
                    x_newton=x_new,
                    fx_newton=fx_new,
                )
                self._event(
                    "stagnation",
                    k=k,
                    code="STAGNATION",
                    level="warn",
                    x=x,
                    x_new=x_new,
                    dx=dx,
                    stagnation_tol=self.stagnation_tol,
                )

                if best_fx is None or abs(fx_new) < abs(best_fx):
                    best_x, best_fx = x_new, fx_new

                return SolverResult(
                    method="newton",
                    root=x_new,
                    status="stagnation",
                    stop_reason="STAGNATION",
                    message=f"Stagnation detected (|Δx|<{self.stagnation_tol}).",
                    iterations=k,
                    records=self.records,
                    events=self.events,
                    best_x=best_x,
                    best_fx=best_fx,
                    tol=self.tol_f,
                    n_f=self.n_f,
                    n_df=self.n_df,
                )

            fx_new = self._safe_eval(x_new)
            if fx_new is None:
                self._event("nonfinite", k=k, code="NONFINITE", level="error", x=x_new, where="f(x_new)")
                return SolverResult(
                    method="newton",
                    root=None,
                    status="nan_or_inf",
                    stop_reason="NAN_INF",
                    message="f(x_new) could not be evaluated (NaN/Inf/error).",
                    iterations=k - 1,
                    records=self.records,
                    events=self.events,
                    best_x=best_x,
                    best_fx=best_fx,
                    tol=self.tol_f,
                    n_f=self.n_f,
                    n_df=self.n_df,
                )

            self._record(
                k=k,
                x=x_new,
                fx=fx_new,
                x_prev=x,
                step_type="newton",
                dfm=dfx,
                x_newton=x_new,
                fx_newton=fx_new,
            )

            if best_fx is None or abs(fx_new) < abs(best_fx):
                best_x, best_fx = x_new, fx_new

            # stopping criteria: residual
            if abs(fx_new) <= self.tol_f:
                self._event("termination", k=k, code="TOL_F", level="info", reason="residual", tol_f=self.tol_f)
                return SolverResult(
                    method="newton",
                    root=x_new,
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
                    n_df=self.n_df,
                )

            # --------------------------------
            # FIX: step tolerance is not convergence unless near root
            # --------------------------------
            if dx <= self.tol_x:
                abs_fx_new = abs(fx_new)
                if abs_fx_new <= 10.0 * self.tol_f:
                    self._event(
                        "termination",
                        k=k,
                        code="TOL_X_NEAR_ROOT",
                        level="info",
                        reason="step_near_root",
                        tol_x=self.tol_x,
                        dx=dx,
                        abs_fx=abs_fx_new,
                        tol_f=self.tol_f,
                    )
                    return SolverResult(
                        method="newton",
                        root=x_new,
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
                        n_df=self.n_df,
                    )
                else:
                    self._event(
                        "step_small_but_residual_large",
                        k=k,
                        code="STEP_SMALL_RESIDUAL_LARGE",
                        level="warn",
                        tol_x=self.tol_x,
                        dx=dx,
                        abs_fx=abs_fx_new,
                        tol_f=self.tol_f,
                        note="Step size small but residual is not; continuing (prevents false convergence).",
                    )

            x, fx = x_new, fx_new

        # max iterations
        last_x = self.records[-1].x if self.records else None
        last_fx = self.records[-1].fx if self.records else None
        if best_x is None:
            best_x, best_fx = last_x, last_fx

        self._event("termination", k=self.max_iter, code="MAX_ITER", level="warn", reason="max_iter_exceeded", max_iter=self.max_iter)
        return SolverResult(
            method="newton",
            root=last_x,
            status="max_iter",
            stop_reason="MAX_ITER",
            message="Maximum iterations exceeded without convergence.",
            iterations=len(self.records) - 1 if self.records else 0,
            records=self.records,
            events=self.events,
            best_x=best_x,
            best_fx=best_fx,
            tol=self.tol_f,
            n_f=self.n_f,
            n_df=self.n_df,
        )