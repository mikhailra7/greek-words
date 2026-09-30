import time
from collections import defaultdict, deque


class RateLimiter:
    """In-memory sliding-window counter of failures per key.

    Good enough for a single-process app with ~20 users; resets on restart.
    """

    def __init__(self, max_failures: int, window_seconds: int):
        self.max_failures = max_failures
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> deque[float]:
        hits = self._hits[key]
        while hits and hits[0] <= now - self.window:
            hits.popleft()
        return hits

    def is_blocked(self, key: str) -> bool:
        return len(self._prune(key, time.monotonic())) >= self.max_failures

    def fail(self, key: str) -> None:
        self._prune(key, time.monotonic()).append(time.monotonic())

    def reset(self, key: str | None = None) -> None:
        if key is None:
            self._hits.clear()
        else:
            self._hits.pop(key, None)


login_limiter = RateLimiter(max_failures=10, window_seconds=15 * 60)
invite_limiter = RateLimiter(max_failures=10, window_seconds=15 * 60)
