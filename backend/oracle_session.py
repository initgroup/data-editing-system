import logging

import oracledb


logger = logging.getLogger(__name__)


def _oracle_error_code(exc: BaseException) -> int | None:
    error = exc.args[0] if getattr(exc, "args", None) else None
    return getattr(error, "code", None)


def disable_parallel_execution(cursor, *, include_query: bool = True, context: str = "") -> None:
    """Keep Oracle Cloud/free-tier sessions on serial DML/queries when possible."""
    statements = ["ALTER SESSION DISABLE PARALLEL DML"]
    if include_query:
        statements.append("ALTER SESSION DISABLE PARALLEL QUERY")

    for statement in statements:
        try:
            cursor.execute(statement)
        except oracledb.Error as exc:
            code = _oracle_error_code(exc)
            try:
                normalized_code = abs(int(code or 0))
            except (TypeError, ValueError):
                normalized_code = 0
            if normalized_code == 12841:
                logger.warning(
                    "Parallel session state was not changed because a transaction is already active. context=%s",
                    context or "-",
                )
                return
            raise
