"""
Runtime loader for default settings used by M91002 and M91003.

The JSON file is read on each call so changes can be applied without
restarting the FastAPI process.
"""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List


DEFAULTS_FILE = Path(__file__).resolve().parent / "config" / "setting-defaults.json"


def load_setting_defaults() -> Dict[str, Any]:
    with DEFAULTS_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError("setting-defaults.json root must be an object.")
    return data


def get_gemini_setting_category():
    data = load_setting_defaults()
    return str(data.get("geminiSettingCategory") or "MY_ACCOUNT")


def get_gemini_setting_key():
    data = load_setting_defaults()
    return str(data.get("geminiSettingKey") or "GEMINI_API_KEY")


def get_system_setting_categories() -> List[Dict[str, Any]]:
    data = load_setting_defaults()
    categories = data.get("systemSettingCategories") or []
    if not isinstance(categories, list):
        raise ValueError("systemSettingCategories must be a list.")
    return deepcopy(categories)


def get_target_setting_categories() -> List[Dict[str, Any]]:
    data = load_setting_defaults()
    categories = data.get("targetSettingCategories") or []
    if not isinstance(categories, list):
        raise ValueError("targetSettingCategories must be a list.")
    return deepcopy(categories)
