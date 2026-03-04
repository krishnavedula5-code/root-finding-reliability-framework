from fastapi import FastAPI, HTTPException, Query
from typing import Optional, Any
from pydantic import BaseModel, model_validator
from fastapi.middleware.cors import CORSMiddleware

from numerical_lab.engine.controller import NumericalEngine
from numerical_lab.engine.summary import build_comparison_summary
from numerical_lab.diagnostics.explain import explain_run

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import json
import os
import sys
import uuid
from datetime import datetime, timezone


# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------

RUNS_DIR = os.environ.get("NUM_LAB_RUNS_DIR", "runs_store")
os.makedirs(RUNS_DIR, exist_ok=True)

APP_VERSION = os.environ.get("NUM_LAB_APP_VERSION", "dev")

# Comma-separated list of allowed origins.
# Example (Render): NUM_LAB_CORS_ORIGINS=https://your-ui.vercel.app,http://localhost:3000
allowed_origins_env = os.environ.get(
    "NUM_LAB_CORS_ORIGINS",
    "http://localhost:3000,https://numerical-ui-deploy-krishnavedula5-codes-projects.vercel.app",
)
allowed_origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]


# ---------------------------------------------------------
# Request Model
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


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def _default_secant_guesses(a: float, b: float, x0: Optional[float], x1: Optional[float]):
    """
    Ensures secant receives valid numeric and distinct guesses.
    """
    mid = 0.5 * (a + b)

    # Default x0 to midpoint
    xx0 = mid if x0 is None else float(x0)

    # Default x1 to bracket endpoint if not provided
    if x1 is None:
        candidate = float(b)
        if candidate == xx0:
            candidate = float(a)
        if candidate == xx0:
            candidate = xx0 + 1e-4
        xx1 = candidate
    else:
        xx1 = float(x1)

    # Ensure distinct guesses
    if xx1 == xx0:
        xx1 = xx0 + 1e-4

    return xx0, xx1


def _run_path(run_id: str) -> str:
    return os.path.join(RUNS_DIR, f"{run_id}.json")


def save_run(payload: dict) -> str:
    if "request" not in payload:
        raise RuntimeError("Refusing to save run: 'request' missing from payload")

    run_id = uuid.uuid4().hex[:12]

    meta = {
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": 1,
        "app_version": APP_VERSION,
    }

    ordered = {"_meta": meta}
    for k, v in payload.items():
        if k == "_meta":
            continue
        ordered[k] = v

    tmp_path = _run_path(run_id) + ".tmp"
    final_path = _run_path(run_id)

    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(
            ordered,
            f,
            ensure_ascii=False,
            indent=2,
            sort_keys=False,
        )

    os.replace(tmp_path, final_path)
    return run_id


def load_run(run_id: str) -> dict:
    path = _run_path(run_id)
    if not os.path.exists(path):
        raise FileNotFoundError(run_id)

    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_runs(limit: int = 20) -> list[dict]:
    items: list[dict] = []

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
                    "run_id": meta.get("run_id") or name[:-5],
                    "created_at": meta.get("created_at"),
                    "expr": req.get("expr"),
                }
            )
        except Exception:
            continue

    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return items[: max(1, min(limit, 200))]


# ---------------------------------------------------------
# App Setup
# ---------------------------------------------------------

app = FastAPI()

# ✅ Enable CORS in BOTH dev and production.
# If you want to restrict, set NUM_LAB_CORS_ORIGINS on Render to your exact Vercel URL.
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", response_model=None)
def health():
    return {"ok": True, "app_version": APP_VERSION}


@app.get("/__whoami", response_model=None)
def __whoami():
    return {
        "file": __file__,
        "cwd": os.getcwd(),
        "python": sys.executable,
        "runs_dir": RUNS_DIR,
        "app_version": APP_VERSION,
        "cors_origins": allowed_origins,
    }


# ---------------------------------------------------------
# Core Logic
# ---------------------------------------------------------

RESERVED_TOPLEVEL_KEYS = {"request", "_meta", "_debug_signature"}


def compute_compare_payload(req: CompareRequest) -> dict[str, Any]:
    from numerical_lab.expr.safe_eval import compile_expr

    f = compile_expr(req.expr)

    df = None
    if not req.numerical_derivative:
        df = compile_expr(req.dexpr)
    elif req.dexpr and req.dexpr.strip():
        df = compile_expr(req.dexpr)

    # 🔥 Safe defaults for secant
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

    if not comp:
        raise HTTPException(
            status_code=500,
            detail="compare_methods returned no method results (empty)."
        )

    summaries = build_comparison_summary(comp)

    response: dict[str, Any] = {}

    for method, triple in comp.items():
        result, conv, stab = triple
        summary = summaries[method]

        key = str(method)
        if key in RESERVED_TOPLEVEL_KEYS:
            key = f"method_{key}"

        response[key] = {
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

    return response


# ---------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------

@app.post("/compare", response_model=None)
def compare(req: CompareRequest):
    methods_payload = compute_compare_payload(req)
    out: dict[str, Any] = {"request": req.model_dump()}
    for k, v in methods_payload.items():
        out[k] = v
    return out


@app.post("/runs", response_model=CreateRunResponse)
def create_run(req: CompareRequest):
    methods_payload = compute_compare_payload(req)

    ordered: dict[str, Any] = {
        "_debug_signature": "REQ_TOP_V1",
        "request": req.model_dump(),
    }

    for k, v in methods_payload.items():
        if k in RESERVED_TOPLEVEL_KEYS:
            k = f"method_{k}"
        ordered[k] = v

    run_id = save_run(ordered)

    return CreateRunResponse(
        run_id=run_id,
        url_path=f"/run/{run_id}",
    )


@app.get("/runs/{run_id}", response_model=None)
def get_run(run_id: str):
    try:
        return load_run(run_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")


@app.get("/runs", response_model=None)
def get_recent_runs(limit: int = Query(20, ge=1, le=200)):
    return {"runs": list_runs(limit)}


# ---------------------------------------------------------
# Serve React build (single-tunnel demo)
# ---------------------------------------------------------

# ✅ Cross-platform default path (works on Render/Linux and locally if build exists in repo)
FRONTEND_BUILD_DIR = os.environ.get(
    "NUM_LAB_FRONTEND_BUILD",
    os.path.join(os.getcwd(), "numerical-ui", "build")
)

if os.path.isdir(FRONTEND_BUILD_DIR):
    static_dir = os.path.join(FRONTEND_BUILD_DIR, "static")
    if os.path.isdir(static_dir):
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/", response_model=None)
    def serve_root():
        return FileResponse(os.path.join(FRONTEND_BUILD_DIR, "index.html"))

    @app.get("/{path:path}", response_model=None)
    def serve_spa(path: str):
        full_path = os.path.join(FRONTEND_BUILD_DIR, path)
        if os.path.isfile(full_path):
            return FileResponse(full_path)
        return FileResponse(os.path.join(FRONTEND_BUILD_DIR, "index.html"))
else:
    @app.get("/", response_model=None)
    def root_missing_build():
        return {
            "ok": True,
            "message": "React build not found. Run `npm run build` in numerical-ui.",
            "docs": "/docs",
            "frontend_build_dir": FRONTEND_BUILD_DIR,
        }