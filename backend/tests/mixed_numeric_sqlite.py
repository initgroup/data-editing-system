"""Oracle scalar syntax adapter; CASE/predicates/arithmetic execute in SQLite."""
import json
import math
import re


def adapt_numeric_text_sql(sql):
    return sql.replace("JSON_VALUE(", "JSON_NUM(").replace(
        ", '$[0]' RETURNING NUMBER NULL ON ERROR)", ")")


def install_numeric_text_functions(db):
    def regexp_replace(value, pattern, replacement):
        if value is None:
            return None
        # Oracle backreferences use one digit; '\\10' means group 1 then '0'.
        replacement = re.sub(r"\\([1-9])", lambda match: r"\g<" + match[1] + ">", replacement)
        result = re.sub(pattern, replacement, str(value))
        return result or None

    def regexp_substr(value, pattern):
        match = re.search(pattern, str(value)) if value is not None else None
        return match[0] if match else None

    def json_number(value):
        try:
            number = json.loads(value)[0]
            return float(number) if isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number) else None
        except (ValueError, TypeError, OverflowError, IndexError):
            return None

    db.create_function("REGEXP_REPLACE", 3, regexp_replace)
    db.create_function("REGEXP_SUBSTR", 2, regexp_substr)
    db.create_function("REGEXP_LIKE", 3, lambda value, pattern, _flags: bool(re.search(pattern, str(value))) if value is not None else False)
    db.create_function("JSON_NUM", 1, json_number)
    db.create_function("GREATEST", -1, lambda *values: max(values) if all(value is not None for value in values) else None)
