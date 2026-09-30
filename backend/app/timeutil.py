from datetime import UTC, datetime


def utcnow() -> datetime:
    """Naive UTC now. SQLite has no tz-aware datetimes, so everything is stored as naive UTC."""
    return datetime.now(UTC).replace(tzinfo=None)
