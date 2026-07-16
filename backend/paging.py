"""Reusable server-side paging helpers for API responses."""

from dataclasses import dataclass
from typing import Any


def normalize_page_number(value: Any, default: int = 1) -> int:
    """Return a positive one-based page number."""
    try:
        page = int(value if value is not None else default)
    except (TypeError, ValueError):
        page = default
    return max(1, page)


def normalize_page_size(value: Any, default: int = 100, maximum: int = 1000) -> int:
    """Return a bounded positive page size shared by list/grid endpoints."""
    try:
        page_size = int(value if value is not None else default)
    except (TypeError, ValueError):
        page_size = default
    return max(1, min(page_size, max(1, maximum)))


@dataclass(frozen=True)
class PageWindow:
    """Normalized page metadata and zero-based SQL offset."""

    page: int
    page_size: int
    total: int

    @property
    def total_pages(self) -> int:
        return max(1, (self.total + self.page_size - 1) // self.page_size)

    @property
    def current_page(self) -> int:
        return min(self.page, self.total_pages)

    @property
    def offset(self) -> int:
        return (self.current_page - 1) * self.page_size

    def response_metadata(self) -> dict[str, int]:
        return {
            "total": self.total,
            "page": self.current_page,
            "pageSize": self.page_size,
            "totalPages": self.total_pages,
        }


def create_page_window(page: Any, page_size: Any, total: Any, *, default_page_size: int = 100, maximum_page_size: int = 1000) -> PageWindow:
    """Create normalized paging metadata for count + page-query endpoints."""
    try:
        normalized_total = max(0, int(total or 0))
    except (TypeError, ValueError):
        normalized_total = 0

    return PageWindow(
        page=normalize_page_number(page),
        page_size=normalize_page_size(page_size, default_page_size, maximum_page_size),
        total=normalized_total,
    )
