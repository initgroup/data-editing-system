"""Runtime settings shared by backend services.

This module intentionally has no dependency on routers or Target DB helpers.  It
can therefore be used by both without introducing an import cycle.
"""

from collections import OrderedDict
from dataclasses import dataclass
import logging
import os
from threading import Lock
from typing import Dict, Optional, Tuple

from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)

SERVER_RESOURCE_LIMITS_CATEGORY = "SERVER_RESOURCE_LIMITS"
TARGET_DB_POOL_WAIT_TIMEOUT_MS = "TARGET_DB_POOL_WAIT_TIMEOUT_MS"
APP_RULE_SUMMARY_TIMEOUT_MS = "APP_RULE_SUMMARY_TIMEOUT_MS"
APP_ML_MAX_IN_MEMORY_ROWS = "APP_ML_MAX_IN_MEMORY_ROWS"
APP_ML_MAX_INPUT_FEATURES = "APP_ML_MAX_INPUT_FEATURES"


class RuntimeSettingValidationError(ValueError):
    """Raised when a managed runtime setting is not safe to persist."""


@dataclass(frozen=True)
class _ResourceSettingSpec:
    default: int
    minimum: int
    maximum: int
    env_name: str


_RESOURCE_SETTING_SPECS = {
    TARGET_DB_POOL_WAIT_TIMEOUT_MS: _ResourceSettingSpec(
        default=30000,
        minimum=1000,
        maximum=300000,
        env_name=TARGET_DB_POOL_WAIT_TIMEOUT_MS,
    ),
    APP_RULE_SUMMARY_TIMEOUT_MS: _ResourceSettingSpec(
        default=60000,
        minimum=12000,
        maximum=300000,
        env_name=APP_RULE_SUMMARY_TIMEOUT_MS,
    ),
    APP_ML_MAX_IN_MEMORY_ROWS: _ResourceSettingSpec(
        default=25000,
        minimum=1000,
        maximum=1000000,
        env_name=APP_ML_MAX_IN_MEMORY_ROWS,
    ),
    APP_ML_MAX_INPUT_FEATURES: _ResourceSettingSpec(
        default=50,
        minimum=1,
        maximum=1000,
        env_name=APP_ML_MAX_INPUT_FEATURES,
    ),
}

_CACHE_MAX_ENTRIES = 256
_resource_limits_cache: "OrderedDict[Tuple[int, int], Dict[str, int]]" = OrderedDict()
_resource_limits_cache_generations: Dict[Tuple[int, int], int] = {}
_resource_limits_active_loads: Dict[Tuple[int, int], int] = {}
_resource_limits_cache_lock = Lock()


def is_server_resource_category(category_code: Optional[str]) -> bool:
    return str(category_code or "").strip().upper() == SERVER_RESOURCE_LIMITS_CATEGORY


def normalize_server_resource_setting_key(setting_key: Optional[str]) -> str:
    key = str(setting_key or "").strip().upper()
    if key not in _RESOURCE_SETTING_SPECS:
        allowed = ", ".join(_RESOURCE_SETTING_SPECS)
        raise RuntimeSettingValidationError(
            f"Unsupported server resource setting key. Allowed keys: {allowed}."
        )
    return key


def validate_server_resource_setting(
    setting_key: Optional[str],
    setting_value: Optional[str],
) -> Tuple[str, str]:
    """Validate and normalize a managed resource setting for persistence.

    Environment values are deployment-level hard caps.  A DB setting is a
    per-user/per-connection request and may only lower the effective limit.
    """

    key = normalize_server_resource_setting_key(setting_key)
    spec = _RESOURCE_SETTING_SPECS[key]
    value = _parse_integer(setting_value, key)
    if value < spec.minimum or value > spec.maximum:
        raise RuntimeSettingValidationError(
            f"{key} must be between {spec.minimum} and {spec.maximum}."
        )

    env_cap = _read_env_cap(spec)
    if value > env_cap:
        raise RuntimeSettingValidationError(
            f"{key} cannot exceed the deployment limit ({env_cap})."
        )
    return key, str(value)


def get_server_resource_env_caps() -> Dict[str, int]:
    """Return deployment hard caps, using conservative defaults."""

    return {
        key: _read_env_cap(spec)
        for key, spec in _RESOURCE_SETTING_SPECS.items()
    }


def apply_server_resource_limits(values, limits: Optional[Dict[str, int]] = None) -> Dict:
    """Return a copy of runtime values containing safe resource-limit keys."""

    result = dict(values or {})
    env_caps = get_server_resource_env_caps()
    requested_limits = limits or {}
    for key, env_cap in env_caps.items():
        try:
            requested_value = int(requested_limits.get(key, env_cap))
        except (TypeError, ValueError):
            requested_value = env_cap
        result[key] = min(max(requested_value, _RESOURCE_SETTING_SPECS[key].minimum), env_cap)
    return result


def load_server_resource_limits(
    conn,
    user_id: int,
    connection_id: int,
    *,
    force_refresh: bool = False,
) -> Dict[str, int]:
    """Load one session-scope settings snapshot into a bounded process cache.

    Login performs a forced refresh. Normal Target DB acquisitions reuse the
    snapshot without polling the system DB, and M91002 writes invalidate it.
    """

    cache_key = (int(user_id), int(connection_id))
    with _resource_limits_cache_lock:
        cached = _resource_limits_cache.get(cache_key)
        if cached is not None and not force_refresh:
            _resource_limits_cache.move_to_end(cache_key)
            return dict(cached)
        if cached is not None:
            _resource_limits_cache.pop(cache_key, None)
        load_generation = _resource_limits_cache_generations.get(cache_key, 0)
        _resource_limits_active_loads[cache_key] = _resource_limits_active_loads.get(cache_key, 0) + 1

    limits = get_server_resource_env_caps()
    cursor = None
    try:
        if conn is not None:
            cursor = conn.cursor()
            cursor.execute(
                SqlLoader.get_sql("M91002_ACTIVE_SERVER_RESOURCE_LIMITS"),
                {"userId": user_id, "connectionId": connection_id},
            )
            for setting_key, setting_value in cursor.fetchall():
                key = str(setting_key or "").strip().upper()
                spec = _RESOURCE_SETTING_SPECS.get(key)
                if spec is None:
                    continue
                try:
                    requested_value = _parse_integer(_read_db_value(setting_value), key)
                except RuntimeSettingValidationError:
                    logger.warning("Ignoring invalid persisted runtime setting %s.", key)
                    continue
                if requested_value < spec.minimum or requested_value > spec.maximum:
                    logger.warning("Ignoring out-of-range persisted runtime setting %s.", key)
                    continue
                limits[key] = min(requested_value, limits[key])
    except Exception as exc:
        # Resource settings must not make Target DB acquisition or ML execution
        # unavailable.  Conservative environment caps remain in effect.
        logger.warning("Server resource setting load failed; using environment caps: %s", exc)
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception as exc:
                logger.warning("Server resource setting cursor close failed: %s", exc)

    with _resource_limits_cache_lock:
        active_load_count = _resource_limits_active_loads.get(cache_key, 0)
        if active_load_count <= 1:
            _resource_limits_active_loads.pop(cache_key, None)
        else:
            _resource_limits_active_loads[cache_key] = active_load_count - 1

        current_generation = _resource_limits_cache_generations.get(cache_key, 0)
        if current_generation == load_generation:
            _resource_limits_cache[cache_key] = dict(limits)
            _resource_limits_cache.move_to_end(cache_key)
            while len(_resource_limits_cache) > _CACHE_MAX_ENTRIES:
                evicted_key, _ = _resource_limits_cache.popitem(last=False)
                if _resource_limits_active_loads.get(evicted_key, 0) <= 0:
                    _resource_limits_cache_generations.pop(evicted_key, None)
        else:
            logger.info(
                "Discarding stale server resource setting snapshot. user_id=%s connection_id=%s",
                user_id,
                connection_id,
            )

        _prune_resource_limit_cache_metadata_locked()
    return dict(limits)


def invalidate_server_resource_limits(user_id: int, connection_id: Optional[int] = None) -> None:
    """Invalidate cached settings after a committed M91002 change."""

    target_user_id = int(user_id)
    with _resource_limits_cache_lock:
        if connection_id is not None:
            cache_key = (target_user_id, int(connection_id))
            _resource_limits_cache_generations[cache_key] = (
                _resource_limits_cache_generations.get(cache_key, 0) + 1
            )
            _resource_limits_cache.pop(cache_key, None)
            _prune_resource_limit_cache_metadata_locked()
            return
        keys = {
            key
            for key in (
                set(_resource_limits_cache)
                | set(_resource_limits_cache_generations)
                | set(_resource_limits_active_loads)
            )
            if key[0] == target_user_id
        }
        for key in keys:
            _resource_limits_cache_generations[key] = (
                _resource_limits_cache_generations.get(key, 0) + 1
            )
            _resource_limits_cache.pop(key, None)
        _prune_resource_limit_cache_metadata_locked()


def _prune_resource_limit_cache_metadata_locked() -> None:
    """Bound generation metadata without removing active-load race guards."""

    max_metadata_entries = _CACHE_MAX_ENTRIES * 2
    if len(_resource_limits_cache_generations) <= max_metadata_entries:
        return
    for key in list(_resource_limits_cache_generations):
        if len(_resource_limits_cache_generations) <= max_metadata_entries:
            break
        if key in _resource_limits_cache or _resource_limits_active_loads.get(key, 0) > 0:
            continue
        _resource_limits_cache_generations.pop(key, None)


def _parse_integer(value, setting_key: str) -> int:
    text = str(value if value is not None else "").strip()
    if not text or not text.isdigit():
        raise RuntimeSettingValidationError(f"{setting_key} must be a positive integer.")
    return int(text)


def _read_env_cap(spec: _ResourceSettingSpec) -> int:
    raw_value = os.getenv(spec.env_name, str(spec.default))
    try:
        value = int(str(raw_value).strip())
    except (TypeError, ValueError):
        logger.warning("Invalid %s; using default %s.", spec.env_name, spec.default)
        value = spec.default
    return min(max(value, spec.minimum), spec.maximum)


def _read_db_value(value):
    if hasattr(value, "read"):
        return value.read()
    return value
