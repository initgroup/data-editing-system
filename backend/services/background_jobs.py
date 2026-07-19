import logging
import os
from concurrent.futures import ThreadPoolExecutor, wait
from threading import BoundedSemaphore, Lock
from typing import Any, Callable


logger = logging.getLogger(__name__)

_configured_max_workers = max(1, int(os.getenv("APP_BATCH_WORKERS", "1")))
_target_pool_max = max(1, int(os.getenv("TARGET_DB_POOL_MAX", "3")))
_reserved_target_connections = max(
    0,
    int(os.getenv("APP_BATCH_TARGET_DB_RESERVED_CONNECTIONS", "1")),
)
# Background work and interactive APIs share each user's Target DB pool.  Keep
# at least one connection available for status/navigation requests so a batch
# cannot make the whole web application appear hung.
_max_workers = min(
    _configured_max_workers,
    max(1, _target_pool_max - _reserved_target_connections),
)
_queue_capacity = max(0, int(os.getenv("APP_BATCH_QUEUE_CAPACITY", "4")))
_submit_wait_seconds = max(0.0, float(os.getenv("APP_BATCH_SUBMIT_WAIT_SECONDS", "0")))
_job_capacity = BoundedSemaphore(_max_workers + _queue_capacity)
_executor = ThreadPoolExecutor(max_workers=_max_workers, thread_name_prefix="init-batch")
_state_lock = Lock()
_active_futures = set()
_accepting_jobs = True

if _max_workers != _configured_max_workers:
    logger.info(
        "[Batch] worker limit adjusted from %s to %s to reserve %s Target DB connection(s).",
        _configured_max_workers,
        _max_workers,
        _reserved_target_connections,
    )


class BackgroundJobQueueFull(RuntimeError):
    pass


def submit_background_job(label: str, fn: Callable[..., Any], *args: Any, **kwargs: Any):
    if not _job_capacity.acquire(timeout=_submit_wait_seconds):
        logger.warning(
            "[Batch] queue full %s. workers=%s queue_capacity=%s",
            label,
            _max_workers,
            _queue_capacity,
        )
        raise BackgroundJobQueueFull("The background job queue is full. Please try again later.")

    logger.info("[Batch] submit %s", label)
    with _state_lock:
        if not _accepting_jobs:
            _job_capacity.release()
            raise BackgroundJobQueueFull("The background job service is shutting down. Please try again later.")
        try:
            future = _executor.submit(fn, *args, **kwargs)
        except Exception:
            _job_capacity.release()
            raise
        _active_futures.add(future)

    def _log_done(done_future):
        try:
            if done_future.cancelled():
                logger.info("[Batch] cancelled %s", label)
                return
            error = done_future.exception()
            if error:
                logger.error("[Batch] failed %s: %s", label, error, exc_info=error)
            else:
                logger.info("[Batch] done %s", label)
        finally:
            with _state_lock:
                _active_futures.discard(done_future)
            _job_capacity.release()

    future.add_done_callback(_log_done)
    return future


def shutdown_background_jobs() -> None:
    global _accepting_jobs
    with _state_lock:
        _accepting_jobs = False
        futures = list(_active_futures)

    try:
        wait_seconds = max(0.0, float(os.getenv("APP_BATCH_SHUTDOWN_WAIT_SECONDS", "10")))
    except Exception:
        wait_seconds = 10.0
    _, unfinished = wait(futures, timeout=wait_seconds) if futures else (set(), set())
    if unfinished:
        logger.warning("[Batch] shutdown grace period ended with %s running job(s).", len(unfinished))
        for future in unfinished:
            if not future.running():
                future.cancel()
    _executor.shutdown(wait=False, cancel_futures=True)
