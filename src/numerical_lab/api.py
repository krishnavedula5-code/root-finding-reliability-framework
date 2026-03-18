from __future__ import annotations

import os
import sys
import json
import uuid
from datetime import datetime, timezone
from typing import Optional, List
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator

from numerical_lab.services.experiments_service import (
    start_monte_carlo_job,
    start_sweep_job,
)
from numerical_lab.benchmarks.registry import (
    list_all,
    get as get_registered_benchmark,
)
from numerical_lab.benchmarks.loader import load_benchmarks
from numerical_lab.engine.controller import NumericalEngine
from numerical_lab.engine.summary import build_comparison_summary
from numerical_lab.diagnostics.explain import explain_run
from numerical_lab.expr.safe_eval import compile_expr
from numerical_lab.services.experiment_jobs import (
    create_job,
    get_job,
    list_jobs,
)


# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------

RUNS_DIR = os.environ.get("NUM_LAB_RUNS_DIR", "runs_store")
os.makedirs(RUNS_DIR, exist_ok=True)

APP_VERSION = os.environ.get("NUM_LAB_APP_VERSION", "dev")

allowed_origins_env = os.environ.get(
    "NUM_LAB_CORS_ORIGINS",
    "http://localhost:3000,https://root-finding-reliability-framework.vercel.app,https://root-finding-reliability-framework-krishnavedula5-codes-projects.vercel.app",
)

allowed_origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]


# ---------------------------------------------------------
# Request Models
# ---------------------------------------------------------

class CompareRequest(BaseModel):
    expr: str
    dexpr: str | None = None
    a: float
    b: float
    x0: Optional[float] = None
    x1: Optional[float] = None
    tol: float = 1e-10
    max_iter: int = 100
    numerical_derivative: bool = False

    @model_validator(mode="after")
    def _validate_derivative(self):
        if self.numerical_derivative:
            return self

        if self.dexpr is None or str(self.dexpr).strip() == "":
            raise ValueError("dexpr is required unless numerical_derivative=true")

        return self


class CreateRunResponse(BaseModel):
    run_id: str
    url_path: str


class RangeSpec(BaseModel):
    x_min: float
    x_max: float
    n_points: Optional[int] = None


class MonteCarloRequest(BaseModel):
    problem_id: str | None = None
    methods: list[str] = Field(
        default_factory=lambda: [
            "newton",
            "secant",
            "bisection",
            "hybrid",
            "safeguarded_newton",
            "brent",
        ]
    )
    x_min: float
    x_max: float
    n_samples: int = Field(default=1000, ge=1, le=200000)
    random_seed: int = 42

    distribution: str = "uniform"   # uniform | gaussian
    gaussian_mean: float | None = None
    gaussian_std: float | None = None

    secant_dx: float = 1e-2
    tol: float = 1e-10
    max_iter: int = 100
    numerical_derivative: bool = False

    @model_validator(mode="after")
    def validate_inputs(self):
        if self.x_min >= self.x_max:
            raise ValueError("x_min must be strictly less than x_max")

        allowed = {"newton", "secant", "bisection", "hybrid", "safeguarded_newton", "brent"}
        bad = [m for m in self.methods if m not in allowed]
        if bad:
            raise ValueError(f"Unsupported methods: {bad}")

        if self.distribution not in {"uniform", "gaussian"}:
            raise ValueError("distribution must be 'uniform' or 'gaussian'")

        if self.distribution == "gaussian" and self.gaussian_std is not None and self.gaussian_std <= 0:
            raise ValueError("gaussian_std must be positive")

        return self


class SweepExperimentRequest(BaseModel):
    problem_mode: str = "benchmark"

    # Accept both names; normalize later.
    problem_id: Optional[str] = None
    benchmark_id: Optional[str] = None

    expr: Optional[str] = None
    dexpr: Optional[str] = None
    numerical_derivative: bool = False

    methods: List[str] = Field(
        default_factory=lambda: [
            "newton",
            "secant",
            "bisection",
            "hybrid",
            "safeguarded_newton",
            "brent",
        ]
    )

    x_min: Optional[float] = None
    x_max: Optional[float] = None
    n_points: int = 100
    tol: float = 1e-10
    max_iter: int = 100
    boundary_method: str = "newton"

    sampling_mode: str = "grid"
    n_samples: Optional[int] = None
    random_seed: Optional[int] = None
    gaussian_mean: Optional[float] = None
    gaussian_std: Optional[float] = None

    scalar_range: Optional[RangeSpec] = None
    secant_range: Optional[RangeSpec] = None
    bracket_search_range: Optional[RangeSpec] = None

    @model_validator(mode="after")
    def _validate_request(self):
        mode = str(self.problem_mode or "benchmark").lower().strip()
        sampling_mode = str(self.sampling_mode or "grid").lower().strip()

        allowed_methods = {
            "newton",
            "secant",
            "bisection",
            "hybrid",
            "safeguarded_newton",
            "brent",
        }

        if mode not in {"benchmark", "custom"}:
            raise ValueError("problem_mode must be benchmark or custom")

        self.problem_mode = mode

        if sampling_mode not in {"grid", "uniform", "gaussian"}:
            raise ValueError("sampling_mode must be grid, uniform, or gaussian")

        self.sampling_mode = sampling_mode

        if self.tol <= 0:
            raise ValueError("tol must be positive")

        if self.max_iter < 1:
            raise ValueError("max_iter must be >= 1")

        if not self.methods:
            raise ValueError("At least one method must be selected")

        normalized_methods = []
        for m in self.methods:
            mm = str(m).strip().lower()
            if mm not in allowed_methods:
                raise ValueError(f"Unsupported method: {m}")
            normalized_methods.append(mm)
        self.methods = normalized_methods

        boundary_method = str(self.boundary_method or "newton").strip().lower()
        if boundary_method not in allowed_methods:
            raise ValueError(f"Unsupported boundary_method: {self.boundary_method}")
        self.boundary_method = boundary_method

        if sampling_mode == "grid":
            if self.n_points < 2:
                raise ValueError("n_points must be >= 2 for grid mode")

        elif sampling_mode == "uniform":
            if self.n_samples is None or self.n_samples < 1:
                raise ValueError("n_samples must be >= 1 for uniform mode")

        elif sampling_mode == "gaussian":
            if self.n_samples is None or self.n_samples < 1:
                raise ValueError("n_samples must be >= 1 for gaussian mode")
            if self.gaussian_mean is None:
                raise ValueError("gaussian_mean is required for gaussian mode")
            if self.gaussian_std is None or self.gaussian_std <= 0:
                raise ValueError("gaussian_std must be > 0 for gaussian mode")

        if mode == "benchmark":
            resolved_id = None

            if self.problem_id is not None and str(self.problem_id).strip() != "":
                resolved_id = str(self.problem_id).strip()
            elif self.benchmark_id is not None and str(self.benchmark_id).strip() != "":
                resolved_id = str(self.benchmark_id).strip()
            else:
                resolved_id = "poly_01"

            self.problem_id = resolved_id
            self.benchmark_id = resolved_id
            return self

        if not self.expr or str(self.expr).strip() == "":
            raise ValueError("expr required for custom mode")

        if not self.numerical_derivative:
            if self.dexpr is None or str(self.dexpr).strip() == "":
                raise ValueError(
                    "dexpr required for custom mode unless numerical_derivative=true"
                )

        if self.scalar_range is None:
            if self.x_min is None or self.x_max is None:
                raise ValueError("custom mode requires x_min/x_max or scalar_range")

            if float(self.x_min) >= float(self.x_max):
                raise ValueError("x_min must be < x_max")

        return self
    
# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def _default_secant_guesses(a, b, x0, x1):
    mid = 0.5 * (a + b)

    xx0 = mid if x0 is None else float(x0)

    if x1 is None:
        candidate = float(b)
        if candidate == xx0:
            candidate = float(a)
        if candidate == xx0:
            candidate = xx0 + 1e-4
        xx1 = candidate
    else:
        xx1 = float(x1)

    if xx1 == xx0:
        xx1 = xx0 + 1e-4

    return xx0, xx1


def _run_path(run_id: str):
    return os.path.join(RUNS_DIR, f"{run_id}.json")


def save_run(payload: dict):
    run_id = uuid.uuid4().hex[:12]

    meta = {
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": 1,
        "app_version": APP_VERSION,
    }

    ordered = {"_meta": meta}

    for k, v in payload.items():
        if k != "_meta":
            ordered[k] = v

    path = _run_path(run_id)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(ordered, f, indent=2)

    return run_id


def load_run(run_id: str):
    path = _run_path(run_id)

    if not os.path.exists(path):
        raise FileNotFoundError(run_id)

    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_runs(limit=20):
    items = []

    for name in os.listdir(RUNS_DIR):
        if not name.endswith(".json"):
            continue

        path = os.path.join(RUNS_DIR, name)

        try:
            with open(path, "r", encoding="utf-8") as f:
                obj = json.load(f)

            meta = obj.get("_meta", {})
            req = obj.get("request", {})

            items.append(
                {
                    "run_id": meta.get("run_id"),
                    "created_at": meta.get("created_at"),
                    "expr": req.get("expr"),
                }
            )

        except Exception:
            continue

    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return items[:limit]


# ---------------------------------------------------------
# App Setup
# ---------------------------------------------------------

app = FastAPI()

OUTPUTS_DIR = Path("outputs")
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# Startup / Health
# ---------------------------------------------------------

@app.on_event("startup")
def startup_event() -> None:
    load_benchmarks()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "numerical-solver-backend",
    }


@app.get("/__whoami")
def whoami():
    return {
        "file": __file__,
        "cwd": os.getcwd(),
        "python": sys.executable,
        "runs_dir": RUNS_DIR,
    }


# ---------------------------------------------------------
# Benchmarks
# ---------------------------------------------------------

@app.get("/benchmarks")
def list_benchmarks():
    benchmarks = list_all()

    return [
        {
            "id": b.problem_id,
            "name": b.name,
            "category": b.category,
            "expr": b.expr,
            "dexpr": b.dexpr,
            "domain": list(b.domain) if b.domain else [-4, 4],
            "known_roots": b.known_roots or [],
            "roots": b.known_roots or [],
            "notes": b.description or "",
            "analytic_notes": b.analytic_notes or "",
        }
        for b in benchmarks
    ]


@app.get("/benchmarks/{bench_id}")
def benchmark_by_id(bench_id: str):
    try:
        p = get_registered_benchmark(str(bench_id).strip())
    except KeyError:
        raise HTTPException(status_code=404, detail="Benchmark not found")

    return {
        "id": p.problem_id,
        "name": p.name,
        "category": p.category,
        "expr": p.expr,
        "dexpr": p.dexpr,
        "domain": list(p.domain),
        "known_roots": p.known_roots,
        "description": p.description,
        "analytic_notes": p.analytic_notes,
    }


# ---------------------------------------------------------
# Experiment Jobs
# ---------------------------------------------------------

@app.post("/experiments/sweep")
def create_sweep_experiment(req: SweepExperimentRequest):
    payload = req.model_dump(exclude_none=True)

    job = create_job(job_type="sweep", message="Sweep job created")
    start_sweep_job(job.job_id, payload)

    return {
        "job_id": job.job_id,
        "status": job.status,
        "message": job.message,
    }


@app.post("/experiments/monte-carlo")
def run_monte_carlo_experiment_api(payload: MonteCarloRequest):
    if not payload.problem_id:
        raise HTTPException(
            status_code=400,
            detail="problem_id is required for Monte Carlo experiments",
        )

    benchmark_id = str(payload.problem_id).strip()

    try:
        benchmark = get_registered_benchmark(benchmark_id)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown benchmark: {benchmark_id}",
        )

    f = benchmark.function
    df = benchmark.derivative

    derivative_methods = {"newton", "hybrid", "safeguarded_newton"}
    needs_df = any(m in derivative_methods for m in payload.methods)

    if needs_df and df is None and not payload.numerical_derivative:
        raise HTTPException(
            status_code=400,
            detail=(
                "Selected methods require a derivative, but this benchmark has "
                "no analytic derivative and numerical_derivative is False"
            ),
        )

    job_id = start_monte_carlo_job(
        problem_id=benchmark.problem_id,
        f=f,
        df=df,
        methods=payload.methods,
        x_min=payload.x_min,
        x_max=payload.x_max,
        n_samples=payload.n_samples,
        random_seed=payload.random_seed,
        distribution=payload.distribution,
        gaussian_mean=payload.gaussian_mean,
        gaussian_std=payload.gaussian_std,
        secant_dx=payload.secant_dx,
        max_iter=payload.max_iter,
        tol=payload.tol,
        numerical_derivative=payload.numerical_derivative,
    )

    return {
        "job_id": job_id,
        "job_type": "monte_carlo",
        "status": "queued",
        "message": "Monte Carlo experiment started",
    }


@app.get("/experiments/jobs")
def get_experiment_jobs():
    jobs = list_jobs()

    return [
        {
            "job_id": j.job_id,
            "job_type": j.job_type,
            "status": j.status,
            "progress": j.progress,
            "message": j.message,
            "error": j.error,
            "created_at": j.created_at,
            "started_at": j.started_at,
            "finished_at": j.finished_at,
        }
        for j in jobs
    ]


@app.get("/experiments/jobs/{job_id}")
def get_experiment_job(job_id: str):
    job = get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")

    return {
        "job_id": job.job_id,
        "job_type": job.job_type,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "result": job.result,
        "error": job.error,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


# ---------------------------------------------------------
# Artifacts
# ---------------------------------------------------------

@app.get("/artifacts/json")
def read_json_artifact(path: str):
    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Artifact not found")

    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/artifacts/file")
def get_artifact_file(path: str):
    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Artifact not found")

    return FileResponse(path=p)

# api.py or routes/benchmarks.py

from fastapi import APIRouter

router = APIRouter()

@router.get("/benchmarks")
def list_benchmarks():
    return list(BENCHMARKS.values())


# ---------------------------------------------------------
# Compare endpoint
# ---------------------------------------------------------

@app.post("/compare")
def compare(req: CompareRequest):
    f = compile_expr(req.expr)

    df = None
    if not req.numerical_derivative:
        df = compile_expr(req.dexpr)

    sec_x0, sec_x1 = _default_secant_guesses(req.a, req.b, req.x0, req.x1)

    comp = NumericalEngine.compare_methods(
        f=f,
        df=df,
        bracket=(req.a, req.b),
        secant_guesses=(sec_x0, sec_x1),
        tol=req.tol,
        max_iter=req.max_iter,
        newton_x0=sec_x0,
    )

    summaries = build_comparison_summary(comp)
    out = {"request": req.model_dump()}

    for method, triple in comp.items():
        result, conv, stab = triple
        summary = summaries[method]

        out[method] = {
            "summary": summary.__dict__,
            "explanation": explain_run(summary, result),
            "trace": {
                "iterations": result.iterations,
                "root": result.root,
                "records": [
                    {
                        "k": r.k,
                        "x": r.x,
                        "fx": r.fx,
                        "residual": r.residual,
                        "step_error": r.step_error,
                    }
                    for r in result.records
                ],
                "events": result.events,
            },
        }

    return out


# ---------------------------------------------------------
# Runs storage
# ---------------------------------------------------------

@app.post("/runs", response_model=CreateRunResponse)
def create_run(req: CompareRequest):
    payload = compare(req)
    run_id = save_run(payload)

    return CreateRunResponse(
        run_id=run_id,
        url_path=f"/run/{run_id}",
    )


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    try:
        return load_run(run_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Run not found")


@app.get("/runs")
def get_recent_runs(limit: int = Query(20, ge=1, le=200)):
    return {"runs": list_runs(limit)}