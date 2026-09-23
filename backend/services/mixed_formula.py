"""Bound arithmetic ASTs shared by discovery, analysis and final editing."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, localcontext
import re

from fastapi import HTTPException
from backend.services.mixed_numeric import TEXT_TYPES, numeric_text_sql, parse_numeric_decimal

NUMERIC_TYPES = {"NUMBER", "FLOAT", "BINARY_FLOAT", "BINARY_DOUBLE"}
OPERATORS = {"ADD": "+", "SUBTRACT": "-", "MULTIPLY": "*", "DIVIDE": "/"}


def number(value):
    try:
        if isinstance(value, bool) or value is None or len(str(value)) > 128:
            raise ValueError
        result = Decimal(str(value))
        if not result.is_finite() or abs(result) >= Decimal("1e125"):
            raise ValueError
        return result
    except (InvalidOperation, ValueError, TypeError, OverflowError) as exc:
        raise HTTPException(400, "Formula values must be finite numbers within the Oracle numeric range.") from exc


def compile_expression(expression, columns, *, prefix="fx", forbidden_column=None):
    metadata = {c["COLUMN_NAME"]: c for c in columns}
    binds, referenced = {}, set()
    count = 0

    def visit(node, depth=0):
        nonlocal count
        count += 1
        if not isinstance(node, dict) or depth > 12 or count > 64:
            raise HTTPException(400, "Invalid or oversized formula expression.")
        if set(node) in ({"column"}, {"column", "numericText"}):
            name = node["column"]
            numeric_text = node.get("numericText") is True
            if (not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_$#]*", name)
                    or name not in metadata
                    or (metadata[name]["DATA_TYPE"] not in (TEXT_TYPES if numeric_text else NUMERIC_TYPES))
                    or ("numericText" in node and not numeric_text)
                    or name == forbidden_column):
                raise HTTPException(400, "A formula must use existing numeric predictors without its result column.")
            referenced.add(name)
            reference = 'T."' + name + '"'
            return numeric_text_sql(reference) if numeric_text else reference
        if set(node) == {"value"}:
            key = prefix + str(len(binds))
            binds[key] = number(node["value"])
            return ":" + key
        op = node.get("operator")
        if not isinstance(op, str) or op not in OPERATORS or set(node) != {"operator", "left", "right"}:
            raise HTTPException(400, "Unsupported formula expression operator.")
        left, right = visit(node["left"], depth + 1), visit(node["right"], depth + 1)
        if op == "DIVIDE":
            right = f"NULLIF({right}, 0)"
        return f"({left} {OPERATORS[op]} {right})"

    sql = visit(expression)
    if not referenced:
        raise HTTPException(400, "A continuous formula must contain an actual predictor column.")
    return sql, binds, referenced


def compile_result(result, columns, *, prefix="fr"):
    target = result.get("column")
    metadata = {c["COLUMN_NAME"]: c for c in columns}
    numeric_text = result.get("numericText") is True
    if (not isinstance(target, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_$#]*", target)
            or target not in metadata or metadata[target]["DATA_TYPE"] not in (TEXT_TYPES if numeric_text else NUMERIC_TYPES)
            or ("numericText" in result and not numeric_text)):
        raise HTTPException(400, "A continuous formula must predict a numeric result column.")
    prediction, binds, _ = compile_expression(result.get("expression"), columns,
                                             prefix=prefix + "e", forbidden_column=target)
    absolute, relative = number(result.get("absoluteTolerance")), number(result.get("relativeTolerance", 0))
    if absolute < 0 or not 0 <= relative <= 1:
        raise HTTPException(400, "Formula tolerances must be nonnegative; relative tolerance cannot exceed one.")
    binds[prefix + "abs"], binds[prefix + "rel"] = absolute, relative
    tolerance = f"GREATEST(:{prefix}abs, :{prefix}rel * ABS({prediction}))"
    actual = numeric_text_sql(f'T."{target}"') if numeric_text else f'T."{target}"'
    return f'(ABS({actual} - {prediction}) <= {tolerance})', binds


def evaluate_expression(expression, row):
    """Evaluate an already validated persisted AST using source-row values."""
    def visit(node, depth=0):
        if depth > 12:
            return None
        if "column" in node:
            value = row.get(node["column"])
            if node.get("numericText") is True:
                return parse_numeric_decimal(value)
            return None if value is None or value == "" else number(value)
        if "value" in node:
            return number(node["value"])
        left, right = visit(node["left"], depth + 1), visit(node["right"], depth + 1)
        if left is None or right is None:
            return None
        op = node["operator"]
        if op == "ADD":
            return left + right
        if op == "SUBTRACT":
            return left - right
        if op == "MULTIPLY":
            return left * right
        if op == "DIVIDE":
            return None if right == 0 else left / right
        return None
    with localcontext() as ctx:
        ctx.prec = 38
        return visit(expression)


def accepts_expected(result, value, expected):
    if value is None or value == "" or expected is None or expected == "":
        return False
    try:
        actual = parse_numeric_decimal(value) if result.get("numericText") is True else number(value)
        if actual is None:
            return False
        prediction = number(expected)
        tolerance = max(number(result["absoluteTolerance"]), number(result.get("relativeTolerance", 0)) * abs(prediction))
        return abs(actual - prediction) <= tolerance
    except HTTPException:
        return False
