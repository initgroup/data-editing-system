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

    def test_column_id_is_truncated_after_ten_characters_without_forced_width(self):
        script = ANALYSIS_SCRIPT.read_text(encoding="utf-8")
        style = ANALYSIS_STYLE.read_text(encoding="utf-8")

        self.assertIn("column.length > 10 ? `${column.slice(0, 10)}...` : column", script)
        self.assertIn("<b>${this.escapeHtml(displayColumn)}</b>", script)
        self.assertIn(".anly-work-column-ref b {\n    flex: 0 0 auto;", style)
        self.assertNotIn("max-width: 10ch;", style)
        self.assertNotIn("min-width: 10ch;", style)

    def test_m04002_column_chips_reserve_six_column_id_characters(self):
        style = ANALYSIS_STYLE.read_text(encoding="utf-8")
        start = style.index(".anly-work-column-chip b {")
        end = style.index("}", start)
        column_id_rule = style[start:end]

        self.assertIn('font-family: Consolas, "Courier New", monospace;', column_id_rule)
        self.assertIn("min-width: 6ch;", column_id_rule)

    def test_formula_prediction_follows_the_actual_rule_result_column(self):
        script = ANALYSIS_SCRIPT.read_text(encoding="utf-8")
        style = ANALYSIS_STYLE.read_text(encoding="utf-8")
        start = script.index("        orderViolationSqlColumns(columns")
        end = script.index("        getViolationSqlColumnClass", start)
        order_block = script[start:end]

        self.assertIn("const frozenKeys = keys.slice(0, freezeColumns);", order_block)
        self.assertIn("const remainingKeys = keys.slice(freezeColumns);", order_block)
        self.assertIn('const predictedColumns = pick(["V_PREDICTED_VALUE"]);', order_block)
        self.assertIn(
            "return [...frozenKeys, ...ruleConditions, ...ruleResults, ...predictedColumns, ...remainingKeys, ...rest];",
            order_block,
        )
        self.assertIn('getText("f(X) predicted value (Y)")', script)
        self.assertIn('return "is-formula-prediction"', script)
        self.assertIn(".anly-work-violation-sql-grid th.is-formula-prediction", style)
        self.assertIn("background: #eef2ff", style)

    def test_column_type_more_badge_expands_and_collapses_full_list(self):
        script = ANALYSIS_SCRIPT.read_text(encoding="utf-8")
        style = ANALYSIS_STYLE.read_text(encoding="utf-8")

        self.assertIn("expandedColumnLists: new Set()", script)
        self.assertIn("renderExpandableColumnChips(columns", script)
        self.assertIn("toggleColumnListExpansion(key", script)
        self.assertIn('aria-expanded="${expanded ? "true" : "false"}"', script)
        self.assertIn('getMessage("collapseColumns", "접기")', script)
        self.assertIn(".anly-work-column-more-button", style)
        self.assertIn(".anly-work-corr-tags.is-expanded", style)

    def test_predicted_type_groups_keep_equal_height_and_scroll_internally(self):
        script = ANALYSIS_SCRIPT.read_text(encoding="utf-8")
        style = ANALYSIS_STYLE.read_text(encoding="utf-8")

        self.assertIn("normalizePredictedTypeGroups(groups", script)
        self.assertIn('["CATEGORICAL", "CONTINUOUS", "OTHER"]', script)
        self.assertIn("getPredictedTypeGroupLayout(sourceGroups", script)
        self.assertIn('const visibleLimit = groupCode === "OTHER" ? 10 : 20;', script)
        self.assertIn("visibleRows: Math.max(1, visibleCount)", script)
        self.assertIn("anly-work-type-group-columns", script)
        self.assertIn("--anly-type-visible-rows", script)
        self.assertIn("columns.map((column) => this.renderColumnChip", script)
        self.assertIn(".anly-work-type-group-columns", style)
        self.assertIn("grid-template-columns: minmax(0, 1fr);", style)
        self.assertIn("overflow-y: auto;", style)
        self.assertIn("var(--anly-type-visible-rows, 1) * 32px", style)
        self.assertIn("flex: 0 0 6ch;", style)
        self.assertIn("max-width: 6ch;", style)
        self.assertIn("max-width: none;", style)
        self.assertIn(".anly-work-type-group-columns .anly-work-column-chip small", style)
        self.assertIn("flex: 1 1 auto;", style)

    def test_column_type_export_includes_all_rule_model_final_groups(self):
        script = ANALYSIS_SCRIPT.read_text(encoding="utf-8")
        style = ANALYSIS_STYLE.read_text(encoding="utf-8")

        self.assertIn("exportPredictedTypeSummary()", script)
        self.assertIn('["RULE", "MODEL", "FINAL"].forEach', script)
        self.assertIn('(Array.isArray(group?.columns) ? group.columns : []).forEach', script)
        self.assertIn('"TYPE_GROUP_CODE"', script)
        self.assertIn('"COLUMN_LABEL"', script)
        self.assertIn("anly-work-result-export", script)
        self.assertIn(".anly-work-result-switcher button.anly-work-result-export", style)

    def test_symbolic_sample_grid_header_shows_column_comment_and_xy_role(self):
        script = ANALYSIS_SCRIPT.read_text(encoding="utf-8")
        style = ANALYSIS_STYLE.read_text(encoding="utf-8")

        start = script.index("        renderSymbolicRuleRawDataTable()")
        end = script.index("        selectSymbolicSampleRow", start)
        render_block = script[start:end]

        self.assertIn('const roleLabel = getText(isTarget ? "Y result value" : "X arguments");', render_block)
        self.assertIn("this.getColumnComment(columnId, state.summary || {})", render_block)
        self.assertIn("anly-work-symbolic-data-header-inner", render_block)
        self.assertIn('isTarget ? "is-y-result" : "is-x-argument"', render_block)
        role_line = '<em>${this.escapeHtml(roleLabel)}</em>'
        column_line = '<b>${this.escapeHtml(columnId)}</b>'
        comment_line = '<small>${comment ? this.escapeHtml(comment) : "-"}</small>'
        self.assertLess(render_block.index(role_line), render_block.index(column_line))
        self.assertLess(render_block.index(column_line), render_block.index(comment_line))
        self.assertIn(".anly-work-symbolic-data-header-inner", style)
        self.assertIn(".anly-work-symbolic-data-header.is-y-result", style)


if __name__ == "__main__":
    unittest.main()
