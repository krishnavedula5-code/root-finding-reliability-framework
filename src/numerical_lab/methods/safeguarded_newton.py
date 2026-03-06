from __future__ import annotations

from typing import Callable, Optional
from numerical_lab.core.base import RootSolver, SolverResult


class SafeguardedNewtonSolver(RootSolver):
    """
    Safeguarded Newton method.

    Uses Newton step when safe.
    Falls back to bisection if the Newton step exits the bracket
    or derivative becomes unstable.
    """

    def __init__(
        self,
        f: Callable[[float], float],
        df: Callable[[float], float],
        a: float,
        b: float,
        x0: Optional[float] = None,
        tol: float = 1e-10,
        max_iter: int = 100,
    ):
        super().__init__(f=f, tol=tol, max_iter=max_iter)

        self.df = df
        self.a = float(a)
        self.b = float(b)

        if x0 is None:
            self.x0 = 0.5 * (a + b)
        else:
            self.x0 = float(x0)

    def solve(self) -> SolverResult:

        a = self.a
        b = self.b
        x = self.x0

        x_prev = None

        fa = self._safe_eval(a)
        fb = self._safe_eval(b)

        if fa is None or fb is None:
            return SolverResult(
                method="safeguarded_newton",
                root=None,
                status="nan_or_inf",
                message="Invalid function values at bracket",
                iterations=0,
                records=self.records,
                events=self.events,
                stop_reason="NAN_INF",
                tol=self.tol,
                n_f=self.n_f,
                n_df=self.n_df,
            )

        for k in range(1, self.max_iter + 1):

            fx = self._safe_eval(x)
            if fx is None:
                return SolverResult(
                    method="safeguarded_newton",
                    root=None,
                    status="nan_or_inf",
                    message="Function evaluation returned non-finite",
                    iterations=k,
                    records=self.records,
                    events=self.events,
                    stop_reason="NAN_INF",
                    tol=self.tol,
                    n_f=self.n_f,
                    n_df=self.n_df,
                )

            # record iteration
            self._record(
                k=k,
                x=x,
                fx=fx,
                x_prev=x_prev,
                step_type="iteration",
                a=a,
                b=b,
            )

            # convergence test
            if abs(fx) < self.tol:
                return SolverResult(
                    method="safeguarded_newton",
                    root=x,
                    status="converged",
                    message="Converged (|f(x)| < tol)",
                    iterations=k,
                    records=self.records,
                    events=self.events,
                    stop_reason="TOL_F",
                    tol=self.tol,
                    best_x=x,
                    best_fx=fx,
                    n_f=self.n_f,
                    n_df=self.n_df,
                )

            # attempt Newton step
            try:
                dfx = self.df(x)
                self.n_df += 1
            except Exception:
                dfx = None

            step_type = "newton"
            x_new = None

            if dfx is None or abs(dfx) < 1e-14:
                step_type = "bisection"
                self._event(
                    "derivative_zero",
                    k=k,
                    level="warn",
                    x=x,
                )
            else:
                candidate = x - fx / dfx

                if candidate < a or candidate > b:
                    step_type = "bisection"
                else:
                    x_new = candidate

            if x_new is None:
                x_new = 0.5 * (a + b)

            fx_new = self._safe_eval(x_new)

            if fx_new is None:
                return SolverResult(
                    method="safeguarded_newton",
                    root=None,
                    status="nan_or_inf",
                    message="Non-finite during update",
                    iterations=k,
                    records=self.records,
                    events=self.events,
                    stop_reason="NAN_INF",
                    tol=self.tol,
                    n_f=self.n_f,
                    n_df=self.n_df,
                )

            # update bracket
            if fa * fx_new <= 0:
                b = x_new
                fb = fx_new
            else:
                a = x_new
                fa = fx_new

            x_prev = x
            x = x_new

        return SolverResult(
            method="safeguarded_newton",
            root=x,
            status="max_iter",
            message="Maximum iterations reached",
            iterations=self.max_iter,
            records=self.records,
            events=self.events,
            stop_reason="MAX_ITER",
            tol=self.tol,
            best_x=x,
            best_fx=fx,
            n_f=self.n_f,
            n_df=self.n_df,
        )