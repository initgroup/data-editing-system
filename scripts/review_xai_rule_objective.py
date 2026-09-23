r"""Offline audit: anomaly explanations and data-pattern violations differ.

Synthetic data only. No database imports, application startup, or production
changes. This is a semantic demonstration, not a benchmark or a rule engine.
Run from the repository: .\venv\Scripts\python.exe scripts/review_xai_rule_objective.py
"""
from pathlib import Path
import json
import sys

import numpy as np
from sklearn.tree import DecisionTreeClassifier

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.services.mixed_xai_algorithm import analyze_mixed_rows, evaluate_predicate


def compare():
    rng = np.random.default_rng(42)
    size = 4000
    group = np.arange(size) % 2
    result = group.copy()
    mismatches = np.arange(0, size, 100)
    result[mismatches] = 1 - result[mismatches]
    measure = rng.normal(size=size)
    # These unusual measurements do not violate the constructed GROUP -> RESULT pattern.
    measure[1:161:2] += 20
    rows = [{"GROUP_CODE": str(int(group[i])), "RESULT_CODE": str(int(result[i])),
             "MEASURE": float(measure[i])} for i in range(size)]
    columns = [{"COLUMN_NAME": "GROUP_CODE", "DATA_TYPE": "VARCHAR2"},
               {"COLUMN_NAME": "RESULT_CODE", "DATA_TYPE": "VARCHAR2"},
               {"COLUMN_NAME": "MEASURE", "DATA_TYPE": "NUMBER"}]
    current = analyze_mixed_rows(rows, columns, {
        "contamination": .03, "minLeafCount": 5, "maxRows": size,
    })
    candidates = np.array([any(evaluate_predicate(rule["predicate"], row)
                              for rule in current["rules"]) for row in rows])
    permutation = rng.permutation(size)
    train, holdout = permutation[:3000], permutation[3000:]
    features = np.column_stack([group, measure])  # RESULT_CODE and its derivatives are excluded.
    tree = DecisionTreeClassifier(max_depth=2, min_samples_leaf=100, random_state=42)
    tree.fit(features[train], result[train])
    predicted = tree.predict(features)
    return {
        "synthetic_only": True,
        "purpose": "Semantic demonstration, not a generalization or performance benchmark",
        "rows": size,
        "known_pattern": "RESULT_CODE should equal GROUP_CODE",
        "known_pattern_violations": int((group != result).sum()),
        "pattern_confidence_all_rows": float((group == result).mean()),
        "pattern_confidence_group_0": float((group[group == 0] == result[group == 0]).mean()),
        "pattern_confidence_group_1": float((group[group == 1] == result[group == 1]).mean()),
        "current_rule_texts": [rule["expression"] for rule in current["rules"]],
        "current_candidate_rows": int(candidates.sum()),
        "known_pattern_violations_among_candidates": int((candidates & (group != result)).sum()),
        "pattern_compliant_candidates": int((candidates & (group == result)).sum()),
        "target_tree_train_accuracy": float((predicted[train] == result[train]).mean()),
        "target_tree_holdout_accuracy": float((predicted[holdout] == result[holdout]).mean()),
        "target_tree_violations": int((predicted != result).sum()),
        "target_tree_expected_values": sorted(set(map(int, predicted))),
        "limitations": ["Target and features are explicitly chosen for this demonstration",
                        "Aggregate accuracy is not per-rule confidence",
                        "The proposed production rule-selection/validation engine is not implemented here"],
    }


if __name__ == "__main__":
    print(json.dumps(compare(), ensure_ascii=False, indent=2))
