"""One explicit numeric-text policy for imported data, formulas and editing.

Oracle receives a JSON *number*, never a JSON string or implicit character cast.
This keeps decimal/exponent interpretation independent of session NLS settings.
"""
from decimal import Decimal, InvalidOperation
import re


TEXT_TYPES = {"VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR"}
NUMERIC_TEXT_PATTERN = r"^[+-]?((0|[1-9][0-9]*)([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$"
_NUMERIC_TEXT = re.compile(NUMERIC_TEXT_PATTERN, re.ASCII)
_LEADING_ZERO = re.compile(r"^[+-]?0[0-9]", re.ASCII)
_MINIMUM = Decimal("1e-125")
_MAXIMUM = Decimal("1e125")


def parse_numeric_decimal(value):
    """Return an exact bounded number, or None for missing/invalid source text."""
    if not isinstance(value, str):
        return None
    text = value.strip(" ")
    if not text or len(text) > 128 or not _NUMERIC_TEXT.fullmatch(text):
        return None
    mantissa = re.split("[eE]", text, maxsplit=1)[0]
    if sum(character in "0123456789" for character in mantissa) > 38:
        return None
    try:
        number = Decimal(text)
        magnitude = number.copy_abs()
        return number if number.is_finite() and (number == 0 or _MINIMUM <= magnitude < _MAXIMUM) else None
    except (InvalidOperation, ValueError, OverflowError):
        return None


def parse_numeric_text(value):
    """Floating-point boundary for bounded model fitting and sampled statistics."""
    parsed = parse_numeric_decimal(value)
    return float(parsed) if parsed is not None else None


def inspect_numeric_text(values, min_count=30):
    """Infer only from the caller's training cohort; never silently discard text."""
    present = [value for value in values if value is not None and not (isinstance(value, str) and not value.strip(" "))]
    converted = [parse_numeric_decimal(value) for value in present]
    valid = [value for value in converted if value is not None]
    leading = sum(isinstance(value, str) and bool(_LEADING_ZERO.match(value.strip(" "))) for value in present)
    reason = ("LEADING_ZERO_CODE" if leading else "NON_NUMERIC_TEXT" if len(valid) != len(present)
              else "INSUFFICIENT_NUMERIC_TEXT" if len(valid) < min_count else None)
    return {"eligible": reason is None, "reason": reason, "nonNullCount": len(present),
            "numericCount": len(valid), "invalidCount": len(present) - len(valid),
            "distinctCount": len(set(valid)), "leadingZeroCount": leading}


def numeric_text_sql(reference):
    """Build an expression only from a previously validated quoted column."""
    if not re.fullmatch(r'T\."[A-Za-z][A-Za-z0-9_$#]*"', reference):
        raise ValueError("A numeric-text expression requires a validated column reference.")
    text = f"TRIM({reference})"
    # Normalize accepted .5, +1 and 1. forms into JSON's locale-free number syntax.
    normalized = (f"REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE({text}, '^[+]', ''), "
                  r"'^(-?)[.]', '\10.'), '[.]([eE]|$)', '.0\1')")
    converted = f"JSON_VALUE('[' || {normalized} || ']', '$[0]' RETURNING NUMBER NULL ON ERROR)"
    digits = f"LENGTH(REGEXP_REPLACE(REGEXP_SUBSTR({text}, '^[^eE]+'), '[^0-9]', ''))"
    zero = f"REGEXP_LIKE({text}, '^[+-]?(0([.]0*)?|[.]0+)([eE][+-]?[0-9]+)?$', 'c')"
    return (f"(CASE WHEN LENGTH({text}) <= 128 AND {digits} <= 38 "
            f"AND NOT REGEXP_LIKE({text}, '[^0-9eE+.-]', 'c') "
            f"AND REGEXP_LIKE({text}, '{NUMERIC_TEXT_PATTERN}', 'c') "
            f"THEN CASE WHEN {zero} THEN 0 "
            f"WHEN ABS({converted}) >= 1e-125 AND ABS({converted}) < 1e125 "
            f"THEN {converted} END END)")
