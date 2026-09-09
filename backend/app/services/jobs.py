"""A small in-process background job queue.

Work that must not hold up an HTTP response — today only recap generation — is
enqueued here and run by a worker task started with the application.

In-process by design, exactly like `ws/hub.py`: with one uvicorn worker this is
all the queueing a single-node deployment needs, and a job can talk to the hub
directly to push its result to a live meeting. Moving to Celery or RQ means
replacing this class and nothing else, because `enqueue()` is the only thing
callers touch.

Two consequences worth knowing:

- Jobs are held in memory, so anything still queued when the process stops is
  lost. `POST /api/recordings/{id}/regenerate` is the manual recovery path.
- The worker runs on the event loop that serves the meeting WebSockets, so a job
  doing blocking work (the summariser, database calls) must wrap it in
  `asyncio.to_thread` rather than running it inline.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger("zoomeet.jobs")

Job = Callable[[], Awaitable[None]]


class JobQueue:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[tuple[str, Job]] | None = None
        self._workers: list[asyncio.Task] = []

    async def start(self, workers: int = 1) -> None:
        """Spin up the worker tasks. Called once, from the app lifespan."""
        if self._workers:
            return
        # Created here, not in __init__: an asyncio.Queue binds to the loop that
        # first touches it, and this module-level instance outlives any one loop.
        self._queue = asyncio.Queue()
        self._workers = [
            asyncio.create_task(self._run(), name=f"job-worker-{index}") for index in range(workers)
        ]

    async def stop(self) -> None:
        """Finish what is queued, then shut the workers down."""
        if not self._workers or self._queue is None:
            return
        try:
            # Bounded so a wedged job cannot hold the process open forever.
            await asyncio.wait_for(self._queue.join(), timeout=10)
        except TimeoutError:
            logger.warning("Timed out draining the job queue; %d job(s) dropped", self._queue.qsize())
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers = []
        self._queue = None

    async def enqueue(self, name: str, job: Job) -> None:
        """Hand a job to the worker and return immediately."""
        if self._queue is None:
            # No worker running (the app was built without its lifespan). Doing
            # the work inline is slower but correct; dropping it is not.
            logger.warning("Job queue is not running; executing %r inline", name)
            await job()
            return
        await self._queue.put((name, job))

    async def wait_for_idle(self) -> None:
        """Block until every queued job has finished. For tests and shutdown."""
        if self._queue is not None:
            await self._queue.join()

    async def _run(self) -> None:
        queue = self._queue
        assert queue is not None  # only started from start(), which sets it
        while True:
            name, job = await queue.get()
            try:
                await job()
            except Exception:  # a failed job must never kill the worker
                logger.exception("Background job %r failed", name)
            finally:
                queue.task_done()


jobs = JobQueue()
