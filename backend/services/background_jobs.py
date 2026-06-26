import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable


logger = logging.getLogger(__name__)

_max_workers = max(1, int(os.getenv("APP_BATCH_WORKERS", "1")))
_executor = ThreadPoolExecutor(max_workers=_max_workers, thread_name_prefix="init-batch")


def submit_background_job(label: str, fn: Callable[..., Any], *args: Any, **kwargs: Any):
    logger.info("[Batch] submit %s", label)
    future = _executor.submit(fn, *args, **kwargs)

    def _log_done(done_future):
        error = done_future.exception()
        if error:
            logger.exception("[Batch] failed %s: %s", label, error)
        else:
            logger.info("[Batch] done %s", label)

    future.add_done_callback(_log_done)
    return future
