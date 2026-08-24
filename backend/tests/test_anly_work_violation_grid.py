import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
ANALYSIS_SCRIPT = ROOT_DIR / "frontend" / "js" / "MCOM_ANLY_WORK.js"
ANALYSIS_STYLE = ROOT_DIR / "frontend" / "css" / "pages" / "MCOM_ANLY_WORK.css"


class AnalysisViolationGridTests(unittest.TestCase):
    def test_condition_and_result_columns_have_distinct_styles(self):
        script = ANALYSIS_SCRIPT.read_text(encoding="utf-8")
        style = ANALYSIS_STYLE.read_text(encoding="utf-8")

        self.assertIn("ruleConditionColumns: ruleColumnRoles.conditionColumns", script)
        self.assertIn("ruleResultColumns: ruleColumnRoles.resultColumns", script)
        self.assertIn('return "is-rule-condition"', script)
        self.assertIn('return "is-rule-result"', script)
        self.assertIn(".anly-work-violation-sql-grid th.is-rule-condition", style)
        self.assertIn(".anly-work-violation-sql-grid th.is-rule-result", style)
        self.assertIn("background: #fff7ed", style)
        self.assertIn("background: #ecfdf5", style)

    def test_rule_columns_start_immediately_after_frozen_keys(self):
        script = ANALYSIS_SCRIPT.read_text(encoding="utf-8")
        start = script.index("        orderViolationSqlColumns(columns")
        end = script.index("        getViolationSqlColumnClass", start)
        order_block = script[start:end]

        self.assertIn("const frozenKeys = keys.slice(0, freezeColumns);", order_block)
        self.assertIn("const remainingKeys = keys.slice(freezeColumns);", order_block)
        self.assertIn("return [...frozenKeys, ...rules, ...remainingKeys, ...rest];", order_block)


if __name__ == "__main__":
    unittest.main()
