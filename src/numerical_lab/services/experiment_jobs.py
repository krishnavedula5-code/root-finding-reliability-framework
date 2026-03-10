from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, List


@dataclass
class ExperimentJob:
    job_id: str
    job_type: str

    status: str = "queued"        # queued | running | completed | failed
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None

    progress: float = 0.0         # 0.0 → 1.0
    message: str = ""

    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


_JOBS: Dict[str, ExperimentJob] = {}
_LOCK = threading.Lock()


# -------------------------------------------------------
# Job creation
# -------------------------------------------------------

def create_job(job_type: str, message: str = "") -> ExperimentJob:
    job = ExperimentJob(
        job_id=uuid.uuid4().hex[:12],
        job_type=job_type,
        message=message,
    )

    with _LOCK:
        _JOBS[job.job_id] = job

    return job


# -------------------------------------------------------
# Job access
# -------------------------------------------------------

def get_job(job_id: str) -> Optional[ExperimentJob]:
    with _LOCK:
        return _JOBS.get(job_id)


def list_jobs() -> List[ExperimentJob]:
    """
    Returns jobs sorted newest first.
    """
    with _LOCK:
        return sorted(
            _JOBS.values(),
            key=lambda j: j.created_at,
            reverse=True
        )


# -------------------------------------------------------
# Job updates
# -------------------------------------------------------

def update_job(job_id: str, **kwargs) -> Optional[ExperimentJob]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return None

        for k, v in kwargs.items():
            setattr(job, k, v)

        return job


# -------------------------------------------------------
# Status helpers
# -------------------------------------------------------

def start_job(job_id: str, message: str = "") -> Optional[ExperimentJob]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return None

        job.status = "running"
        job.started_at = time.time()
        job.message = message
        job.progress = 0.0

        return job


def set_progress(job_id: str, progress: float, message: str = "") -> Optional[ExperimentJob]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return None

        job.progress = max(0.0, min(1.0, progress))

        if message:
            job.message = message

        return job


def complete_job(job_id: str, result: Optional[Dict[str, Any]] = None, message: str = "") -> Optional[ExperimentJob]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return None

        job.status = "completed"
        job.finished_at = time.time()
        job.progress = 1.0
        job.result = result
        job.message = message or "Completed"

        return job


def fail_job(job_id: str, error: str) -> Optional[ExperimentJob]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return None

        job.status = "failed"
        job.finished_at = time.time()
        job.error = error
        job.message = "Failed"

        return job


# -------------------------------------------------------
# Utility helpers
# -------------------------------------------------------

def job_duration(job: ExperimentJob) -> Optional[float]:
    """
    Returns job runtime in seconds if finished.
    """
    if job.started_at and job.finished_at:
        return job.finished_at - job.started_at
    return None