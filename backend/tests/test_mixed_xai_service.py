import copy
import json
import re
import unittest
from decimal import Decimal
from unittest.mock import patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.services import mixed_xai_service as service


PAYLOAD = {"targetOwner": "APP_OWNER", "targetTable": "SOURCE_DATA", "runSourceType": "FLOW_WORK", "runId": 41}
COLUMNS = [
    {"COLUMN_NAME": "VALUE", "DATA_TYPE": "NUMBER", "DATA_LENGTH": 22},
    {"COLUMN_NAME": "KIND", "DATA_TYPE": "VARCHAR2", "DATA_LENGTH": 40},
]


def rule(rule_id="R1", boundary=10):
    return {
        "ruleId": rule_id, "expression": "IF VALUE > 10 THEN ANOMALY_CANDIDATE",
        "predicate": {"operator": "AND", "conditions": [
            {"column": "VALUE", "operator": "NOT_NULL"},
            {"column": "VALUE", "operator": ">", "value": boundary, "valueType": "BINARY_FLOAT"},
        ]},
        "supportCount": 12, "anomalyCount": 10, "anomalyPurity": 10 / 12,
        "holdoutSupportCount": 2, "holdoutAnomalyPurity": .5,
        "validationStatus": "INSUFFICIENT_HOLDOUT_SUPPORT",
        "metricMeaning": "AGREEMENT_WITH_ISOLATION_FOREST_NOT_CONFIRMED_ERROR",
    }


def analysis_result():
    return {"metrics": {"holdoutFidelity": .8, "hasGroundTruth": False}, "encoding": {},
            "warnings": ["SOME_RULES_HAVE_INSUFFICIENT_HOLDOUT_SUPPORT"], "rules": [rule()]}


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.description = []
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.connection.closed_cursors += 1

    def execute(self, sql, params=None):
        params = params or {}
        # Oracle rejects both missing and extra bind names. Validate every path.
        expected = set(re.findall(r":([A-Za-z][A-Za-z0-9_]*)", sql))
        if expected != set(params):
            raise AssertionError(f"Bind mismatch: expected {expected}; got {set(params)}")
        sql_id = next((key for key, query in SqlLoader._query_map.items() if key.startswith(("XAI_", "EDITING_")) and query == sql), None)
        if sql_id is None:
            if "AS XAI_CASE_ID" in sql:
                sql_id = "XAI_MATCH_PREVIEW"
            elif "SUM(CASE WHEN" in sql:
                sql_id = "XAI_MATCH_COUNTS"
            elif "ROWNUM <= :rowLimit" in sql:
                sql_id = "XAI_SOURCE_SAMPLE"
        if sql_id is None:
            raise AssertionError(f"Unknown SQL executed: {sql}")
        self.connection.events.append((sql_id, copy.deepcopy(params), sql))
        if sql_id == self.connection.fail_on:
            raise RuntimeError("Injected statement failure")
        records = self.connection.respond(sql_id, params)
        if records and isinstance(records[0], dict):
            names = list(records[0])
            self.description = [(name,) for name in names]
            self.rows = [tuple(record[name] for name in names) for record in records]
        else:
            self.description = []
            self.rows = list(records or [])
        if sql_id == "XAI_MATCH_PREVIEW" and self.connection.preview_description:
            self.description = self.connection.preview_description

    def fetchall(self):
        rows, self.rows = self.rows, []
        return rows

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def fetchmany(self, size):
        self.connection.fetch_sizes.append(size)
        rows, self.rows = self.rows[:size], self.rows[size:]
        return rows


class FakeConnection:
    def __init__(self, source_rows=None, columns=None):
        self.events = []
        self.fetch_sizes = []
        self.closed_cursors = 0
        self.commits = 0
        self.rollbacks = 0
        self.fail_on = None
        self.schema = list(service.TABLES)
        self.authorized = True
        self.same_discovery_scope = True
        self.columns = columns or copy.deepcopy(COLUMNS)
        self.source_rows = source_rows or [{"VALUE": float(i % 10), "KIND": "a" if i % 2 else "b"} for i in range(80)]
        self.summary = {"ruleCount": 2, "meaning": "Model anomaly candidates"}
        self.rules = [{"RULE_ID": item["ruleId"], "CONDITION_JSON": json.dumps(item["predicate"]), "RULE_PURITY": item["anomalyPurity"]}
                      for item in (rule("R1", 10), rule("R2", 20))]
        self.match_counts = [5000, 2700]
        self.match_index = 0
        self.preview_description = None

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def respond(self, sql_id, params):
        if sql_id == "XAI_SCHEMA_CHECK":
            return [(name,) for name in self.schema]
        if sql_id in {"XAI_RUN_ACCESS", "XAI_FLOW_ACCESS"}:
            return [(7,)] if self.authorized else []
        if sql_id == "XAI_DATA_DISCOVERY_SCOPE":
            return [(7,)] if self.same_discovery_scope else []
        if sql_id == "XAI_SOURCE_COLUMNS":
            return self.columns
        if sql_id == "XAI_SOURCE_SAMPLE":
            return self.source_rows[:params["rowLimit"]]
        if sql_id == "XAI_RUN_SUMMARY":
            return [{"SUMMARY_JSON": json.dumps(self.summary)}] if self.summary is not None else []
        if sql_id == "XAI_RULE_LIST":
            return self.rules
        if sql_id == "XAI_CLEAR_VIOLATIONS":
            self.match_index = 0
        if sql_id == "XAI_MATCH_COUNTS":
            return [tuple(self.match_counts)]
        if sql_id == "XAI_MATCH_PREVIEW":
            if self.preview_description:
                return [(f"ROW{i}", "business-value") for i in range(params["rowLimit"])]
            return [{"XAI_CASE_ID": f"ROW{i}", "VALUE": 99.0} for i in range(params["rowLimit"])]
        if sql_id == "XAI_FLOW_SUMMARIES":
            return [{"TARGET_OWNER": "APP_OWNER", "TARGET_TABLE": "SOURCE_DATA", "SUMMARY_JSON": json.dumps(self.summary)}]
        if sql_id in {"XAI_FLOW_RULES", "XAI_FLOW_VIOLATIONS"}:
            return []
        return []


class JsonLob:
    def __init__(self, value):
        self.value = value

    def read(self):
        return self.value


class JsonFetchConnection(FakeConnection):
    def __init__(self, mode):
        super().__init__()
        self.mode = mode

    def respond(self, sql_id, params):
        records = super().respond(sql_id, params)
        converted = []
        for record in records:
            if not isinstance(record, dict):
                converted.append(record)
                continue
            record = dict(record)
            for key, value in record.items():
                if not key.endswith("_JSON") or not isinstance(value, str):
                    continue
                if self.mode == "native":
                    record[key] = json.loads(value, parse_float=Decimal, parse_int=Decimal)
                elif self.mode == "clob":
                    record[key] = JsonLob(value)
                elif self.mode == "blob":
                    record[key] = JsonLob(value.encode("utf-8"))
                elif self.mode == "bytes":
                    record[key] = value.encode("utf-8")
            converted.append(record)
        return converted


class MixedXaiServiceTests(unittest.TestCase):
    def test_mixed_version_multi_target_history_requires_target_scope_instead_of_hiding_legacy(self):
        conn = FakeConnection()
        respond = conn.respond
        def records(sql_id, params):
            if sql_id == "XAI_FLOW_SUMMARIES":
                return [{"TARGET_OWNER": "APP_OWNER", "TARGET_TABLE": name, "SUMMARY_JSON": summary}
                        for name, summary in [("OLD", {}), ("NEW", {"algorithm": "MIXED_PATTERN_TREE"})]]
            return respond(sql_id, params)
        conn.respond = records
        with self.assertRaises(HTTPException) as caught:
            service.read_results(conn, 41, 7)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("Select a target table", caught.exception.detail)
        self.assertFalse(any(e[0] in {"XAI_FLOW_RULES", "PATTERN_FLOW_RULES"} for e in conn.events))

    def test_common_rule_summary_preserves_xai_metric_meaning_and_if_then(self):
        item = rule()
        stored = {"TARGET_OWNER": "APP_OWNER", "TARGET_TABLE": "SOURCE_DATA", "RULE_ID": "R1",
                  "RULE_TEXT": item["expression"], "CONDITION_JSON": item["predicate"],
                  "SUPPORT_COUNT": 12, "ANOMALY_COUNT": 10, "RULE_PURITY": 10 / 12,
                  "MATCH_COUNT": 5000, "VALIDATION_JSON": json.dumps(item)}
        runs = [{"TARGET_OWNER": "APP_OWNER", "TARGET_TABLE": "SOURCE_DATA", "summary": {"trainCount": 100}}]
        summary = service._rule_summary([stored], runs, {"VALUE": "Value label"})
        result = summary["rules"][0]
        self.assertEqual(result["CONDITION_TEXT"], "VALUE > 10")
        self.assertEqual(result["CONDITION_COUNT"], 1)  # NULL guard is not a second column.
        self.assertEqual(result["CONDITION_COLUMNS"], ["VALUE"])
        self.assertEqual(result["RULE_SUPPORT"], .1)
        self.assertEqual(result["CONDITION_TOTAL_COUNT"], 12)
        self.assertEqual(result["HOLDOUT_COUNT"], 2)
        self.assertIsNone(result["RULE_CONFIDENCE"])
        self.assertIsNone(result["RULE_LIFT"])
        self.assertEqual(result["MATCH_COUNT"], 5000)
        self.assertEqual(summary["overview"]["NON_PERFECT_CONF_RULES"], 1)
        self.assertEqual(summary["conditionDist"][0]["RULE_COUNT"], 1)

    def test_result_queries_scope_every_artifact_to_requested_target(self):
        conn = FakeConnection()
        result = service.read_results(conn, 41, 7, target_owner="app_owner", target_table="source_data")
        queries = [params for sql_id, params, _ in conn.events if sql_id in {
            "XAI_FLOW_SUMMARIES", "XAI_FLOW_RULES_PAGE", "XAI_FLOW_VIOLATIONS", "XAI_FLOW_COLUMN_COMMENTS", "EDITING_HISTORICAL_EXPLANATION_COUNT"}]
        self.assertEqual(len(queries), 5)
        for params in queries:
            self.assertEqual({key: params[key] for key in ("runId", "owner", "tableName")},
                             {"runId": 41, "owner": "APP_OWNER", "tableName": "SOURCE_DATA"})
        self.assertEqual(result["data"]["ruleSummary"]["overview"]["TOTAL_RULES"], 0)
        self.assertEqual(result["data"]["ruleSummary"]["rules"], [])

    def test_result_preview_normalizes_native_json_before_connection_closes(self):
        conn = FakeConnection()
        respond = conn.respond
        def records(sql_id, params):
            if sql_id == "XAI_FLOW_VIOLATIONS":
                return [{"RULE_ID": "R1", "CASE_ID": "ROW1", "ROW_DATA_JSON": {"VALUE": Decimal("3.25")}}]
            return respond(sql_id, params)
        conn.respond = records
        result = service.read_results(conn, 41, 7)
        self.assertEqual(result["data"]["violations"][0]["ROW_DATA_JSON"], {"VALUE": 3.25})
        json.dumps(result)

    def test_detection_accepts_native_oracle_json_and_legacy_lob_fetches(self):
        for mode in ("native", "clob", "blob", "bytes", "text"):
            with self.subTest(mode=mode):
                conn = JsonFetchConnection(mode)
                result = service.detect(conn, {**PAYLOAD, "maxViolationRows": 2})
                self.assertEqual(result["ruleMatchCount"], 7700)
                self.assertEqual(result["savedViolationCount"], 2)
                binds = next(params for sql_id, params, _ in conn.events if sql_id == "XAI_MATCH_COUNTS")
                self.assertTrue(all(type(value) in (int, float) for value in binds.values()))
                saved = json.loads(next(params["summaryJson"] for sql_id, params, _ in conn.events if sql_id == "XAI_UPDATE_RUN"))
                self.assertIsInstance(saved["ruleCount"], int)

    def test_result_summary_accepts_native_json_without_mutating_fetched_object(self):
        conn = JsonFetchConnection("native")
        result = service.read_results(conn, 41, 7)
        self.assertEqual(result["data"]["summary"]["ruleCount"], 2)
        self.assertIsInstance(result["data"]["summary"]["ruleCount"], int)
        json.dumps(result)

    def test_json_object_preserves_nested_numeric_types_and_copies_native_data(self):
        original = {"threshold": Decimal("10.125"), "count": Decimal("2"), "checks": [True, None]}
        parsed = service._json_object(original, "CONDITION_JSON")
        self.assertEqual(parsed, {"threshold": 10.125, "count": 2, "checks": [True, None]})
        self.assertIsInstance(parsed["threshold"], float)
        parsed["checks"].append(False)
        self.assertEqual(original["checks"], [True, None])

    def test_invalid_stored_json_fails_before_clearing_detection_results(self):
        for invalid in ("[1]", "null", "invalid-json", {"value": Decimal("NaN")}):
            conn = FakeConnection()
            conn.rules[0]["CONDITION_JSON"] = invalid
            with self.subTest(invalid=str(invalid)), self.assertRaises(HTTPException) as caught:
                service.detect(conn, PAYLOAD)
            self.assertEqual(caught.exception.status_code, 500)
            self.assertFalse(any(event[0].startswith("XAI_CLEAR") for event in conn.events))

    def test_compiler_binds_values_and_preserves_explicit_null_and_float_semantics(self):
        value = "x' OR 1=1 --"
        predicate = {"operator": "AND", "conditions": [
            rule()["predicate"],
            {"operator": "OR", "conditions": [
                {"column": "KIND", "operator": "IS_NULL"},
                {"column": "KIND", "operator": "!=", "value": value},
            ]},
        ]}
        sql, binds = service.compile_predicate(predicate, COLUMNS)
        self.assertIn('CAST(T."VALUE" AS BINARY_FLOAT)', sql)
        self.assertIn('T."VALUE" IS NOT NULL', sql)
        self.assertIn('T."KIND" IS NULL OR T."KIND" != :x1', sql)
        self.assertNotIn(value, sql)
        self.assertEqual(binds, {"x0": 10, "x1": value})

    def test_compiler_rejects_unknown_operators_columns_values_and_oversized_trees(self):
        invalid = [None, {}, {"operator": "AND", "conditions": []},
                   {"column": "VALUE);DROP TABLE X", "operator": "=", "value": 1},
                   {"column": "VALUE", "operator": "LIKE", "value": "x"},
                   {"column": "VALUE", "operator": ">", "value": float("nan")},
                   {"column": "VALUE", "operator": ">", "value": True},
                   {"column": "KIND", "operator": ">", "value": "x"},
                   {"column": "KIND", "operator": "=", "value": "x" * 4001},
                   {"operator": "AND", "conditions": [{"column": "VALUE", "operator": "IS_NULL"}] * 257}]
        for predicate in invalid:
            with self.subTest(predicate=str(predicate)[:80]), self.assertRaises(HTTPException) as caught:
                service.compile_predicate(predicate, COLUMNS)
            self.assertEqual(caught.exception.status_code, 400)

    def test_discovery_calls_real_algorithm_and_persists_null_safe_candidates(self):
        rows = [{"VALUE": float(100 + i % 5 if i % 10 == 0 else i % 7), "KIND": "rare" if i % 10 == 0 else "common"}
                for i in range(480)]
        conn = FakeConnection(rows)
        result = service._discover_anomaly_v1(conn, {**PAYLOAD, "sampleRows": 480, "contamination": .1})
        self.assertEqual(result["sampleCount"], 480)
        self.assertFalse(result["hasGroundTruth"])
        self.assertGreater(result["ruleCount"], 0)
        inserts = [event for event in conn.events if event[0] == "XAI_INSERT_RULE"]
        self.assertEqual(len(inserts), result["ruleCount"])
        for _, params, _ in inserts:
            service.compile_predicate(json.loads(params["conditionJson"]), COLUMNS)
            self.assertIn("holdoutSupportCount", json.loads(params["validationJson"]))
        self.assertLessEqual(max(conn.fetch_sizes), 250)
        self.assertEqual(conn.commits, 0)
        self.assertEqual(conn.rollbacks, 0)
        self.assertEqual(conn.closed_cursors, 1)

    def test_retry_clears_only_same_run_target_after_successful_analysis(self):
        conn = FakeConnection()
        with patch("backend.services.mixed_xai_algorithm.analyze_mixed_rows", return_value=analysis_result()):
            service._discover_anomaly_v1(conn, PAYLOAD)
            service._discover_anomaly_v1(conn, PAYLOAD)
        writes = [event for event in conn.events if event[0] in {"XAI_CLEAR_VIOLATIONS", "XAI_CLEAR_RULES", "XAI_CLEAR_RUN", "XAI_INSERT_RUN", "XAI_INSERT_RULE"}]
        self.assertEqual([event[0] for event in writes], ["XAI_CLEAR_VIOLATIONS", "XAI_CLEAR_RULES", "XAI_CLEAR_RUN", "XAI_INSERT_RUN", "XAI_INSERT_RULE"] * 2)
        for _, params, _ in writes:
            self.assertEqual(params["runId"], 41)
            self.assertEqual(params["runSourceType"], "FLOW_WORK")
            self.assertEqual(params["owner"], "APP_OWNER")
            self.assertEqual(params["tableName"], "SOURCE_DATA")
        summary = json.loads(next(event[1]["summaryJson"] for event in writes if event[0] == "XAI_INSERT_RUN"))
        self.assertIn("SOME_RULES_HAVE_INSUFFICIENT_HOLDOUT_SUPPORT", summary["warnings"])

    def test_analysis_failure_does_not_clear_prior_results_and_closes_cursor(self):
        conn = FakeConnection()
        with patch("backend.services.mixed_xai_algorithm.analyze_mixed_rows", side_effect=ValueError("too few usable rows")):
            with self.assertRaises(HTTPException) as caught:
                service._discover_anomaly_v1(conn, PAYLOAD)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertFalse(any(event[0].startswith("XAI_CLEAR") for event in conn.events))
        self.assertEqual(conn.closed_cursors, 1)

    def test_dml_failure_propagates_without_implicit_commit_for_caller_rollback(self):
        conn = FakeConnection()
        conn.fail_on = "XAI_INSERT_RULE"
        with patch("backend.services.mixed_xai_algorithm.analyze_mixed_rows", return_value=analysis_result()):
            with self.assertRaisesRegex(RuntimeError, "Injected statement failure"):
                service._discover_anomaly_v1(conn, PAYLOAD)
        self.assertEqual(conn.commits, 0)
        self.assertEqual(conn.closed_cursors, 1)

    def test_detection_counts_every_rule_over_full_source_even_after_preview_cap(self):
        conn = FakeConnection()
        result = service.detect(conn, {**PAYLOAD, "maxViolationRows": 3})
        self.assertEqual(result["ruleMatchCount"], 7700)
        self.assertEqual(result["savedViolationCount"], 3)
        self.assertTrue(result["previewTruncated"])
        counts = [event for event in conn.events if event[0] == "XAI_MATCH_COUNTS"]
        previews = [event for event in conn.events if event[0] == "XAI_MATCH_PREVIEW"]
        self.assertEqual(len(counts), 1)
        self.assertEqual(counts[0][1], {"r0_0": 10, "r1_0": 20})
        self.assertEqual(counts[0][2].count("SUM(CASE WHEN"), 2)
        self.assertEqual(len(previews), 1)
        self.assertTrue(all("ROWNUM" not in event[2] for event in counts))
        self.assertTrue(all("rowLimit" not in event[1] for event in counts))
        self.assertEqual(previews[0][1]["rowLimit"], 3)
        inserted = [event[1] for event in conn.events if event[0] == "XAI_INSERT_VIOLATION"]
        self.assertEqual(len(inserted), 3)
        self.assertTrue(all("anomalyScore" not in params for params in inserted))
        self.assertEqual(conn.commits, 0)

    def test_detect_rejects_cross_flow_discovery_and_missing_discovery(self):
        conn = FakeConnection()
        with self.assertRaises(HTTPException) as caught:
            service.detect(conn, {**PAYLOAD, "discoveryRunId": 99})
        self.assertEqual(caught.exception.status_code, 400)
        self.assertFalse(conn.events)
        conn.summary = None
        with self.assertRaises(HTTPException) as caught:
            service.detect(conn, PAYLOAD)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertFalse(any(event[0].startswith("XAI_CLEAR") for event in conn.events))

    def test_data_work_prior_discovery_requires_same_project_scenario_and_table(self):
        conn = FakeConnection()
        conn.same_discovery_scope = False
        payload = {**PAYLOAD, "runSourceType": "DATA_WORK", "discoveryRunId": 39}
        with self.assertRaises(HTTPException) as caught:
            service.detect(conn, payload)
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual([event[0] for event in conn.events], ["XAI_SCHEMA_CHECK", "XAI_DATA_DISCOVERY_SCOPE"])
        query = conn.events[-1][2]
        self.assertIn("B.PROJECT_ID = A.PROJECT_ID", query)
        self.assertIn("B.SCENARIO_ID = A.SCENARIO_ID", query)
        self.assertIn("B.OWNER_NAME = A.OWNER_NAME", query)
        self.assertIn("B.TABLE_NAME = A.TABLE_NAME", query)
        conn = FakeConnection()
        result = service.detect(conn, {**payload, "maxViolationRows": 1})
        self.assertEqual(result["discoveryRunId"], 39)
        self.assertEqual(result["detectedRunId"], 41)
        reads = [event for event in conn.events if event[0] in {"XAI_RUN_SUMMARY", "XAI_RULE_LIST"}]
        self.assertTrue(all(event[1]["runId"] == 39 for event in reads))
        updates = [event for event in conn.events if event[0] == "XAI_UPDATE_RULE_MATCHES"]
        self.assertTrue(all(event[1]["runId"] == 39 for event in updates))
        writes = [event for event in conn.events if event[0] in {"XAI_INSERT_VIOLATION", "XAI_INSERT_RUN"}]
        self.assertTrue(all(event[1]["runId"] == 41 for event in writes))

    def test_empty_candidate_set_succeeds_without_scanning_source_or_inventing_scores(self):
        conn = FakeConnection()
        conn.rules = []
        conn.summary = {"ruleCount": 0, "warnings": ["NO_RELIABLE_SURROGATE_RULE_CANDIDATES"]}
        result = service.detect(conn, PAYLOAD)
        self.assertEqual(result["ruleMatchCount"], 0)
        self.assertEqual(result["savedViolationCount"], 0)
        self.assertFalse(any(event[0] in {"XAI_MATCH_COUNTS", "XAI_MATCH_PREVIEW", "XAI_INSERT_VIOLATION"} for event in conn.events))

    def test_empty_source_aggregate_nulls_mean_zero_matches(self):
        conn = FakeConnection()
        conn.match_counts = [None, None]
        result = service.detect(conn, PAYLOAD)
        self.assertEqual(result["ruleMatchCount"], 0)
        self.assertFalse(any(event[0] == "XAI_MATCH_PREVIEW" for event in conn.events))

    def test_preview_rowid_alias_cannot_overwrite_same_named_source_feature(self):
        conn = FakeConnection(columns=[{"COLUMN_NAME": "XAI_CASE_ID", "DATA_TYPE": "VARCHAR2", "DATA_LENGTH": 40}])
        conn.rules = [{"RULE_ID": "R1", "RULE_PURITY": .8,
                       "CONDITION_JSON": json.dumps({"column": "XAI_CASE_ID", "operator": "=", "value": "business-value"})}]
        conn.match_counts = [2]
        conn.preview_description = [("XAI_CASE_ID",), ("XAI_CASE_ID",)]
        result = service.detect(conn, {**PAYLOAD, "maxViolationRows": 2})
        self.assertEqual(result["savedViolationCount"], 2)
        inserted = [event[1] for event in conn.events if event[0] == "XAI_INSERT_VIOLATION"]
        self.assertEqual([params["caseId"] for params in inserted], ["ROW0", "ROW1"])
        self.assertTrue(all(json.loads(params["rowDataJson"]) == {"XAI_CASE_ID": "business-value"} for params in inserted))

    def test_missing_schema_and_access_denial_do_not_create_or_modify_objects(self):
        conn = FakeConnection()
        conn.schema = []
        with self.assertRaises(HTTPException) as caught:
            service._discover_anomaly_v1(conn, PAYLOAD)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual([event[0] for event in conn.events], ["XAI_SCHEMA_CHECK"])
        conn = FakeConnection()
        conn.authorized = False
        with self.assertRaises(HTTPException) as caught:
            service.require_scope(conn, PAYLOAD, 7)
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(conn.events[0][1]["userId"], 7)
        self.assertIn("P.USER_ID = :userId", conn.events[0][2])

    def test_memory_byte_cap_stops_source_materialization_before_row_cap(self):
        columns = [{"COLUMN_NAME": f"TEXT_{i}", "DATA_TYPE": "VARCHAR2", "DATA_LENGTH": 4000} for i in range(3)]
        source = [{f"TEXT_{i}": "x" * 4000 for i in range(3)}] * 5000
        conn = FakeConnection(source, columns)
        with patch("backend.services.mixed_xai_algorithm.analyze_mixed_rows", return_value=analysis_result()) as analyze:
            # The mock's rule must name a real column for the safe compiler.
            analyze.return_value = {**analysis_result(), "rules": []}
            result = service._discover_anomaly_v1(conn, {**PAYLOAD, "sampleRows": 5000})
        self.assertTrue(result["sampleByteLimitReached"])
        self.assertLess(result["sampleCount"], 5000)
        self.assertLessEqual(result["sampleCount"] * (4064 * 3), 32 * 1024 * 1024)
        self.assertLessEqual(max(conn.fetch_sizes), 250)

    def test_requested_unknown_or_excluded_features_fail_before_sampling(self):
        for features in [["UNKNOWN"], ["VALUE"]]:
            conn = FakeConnection()
            with self.assertRaises(HTTPException) as caught:
                service._discover_anomaly_v1(conn, {**PAYLOAD, "featureColumns": features, "excludeColumns": ["VALUE"]})
            self.assertEqual(caught.exception.status_code, 400)
            self.assertFalse(any(event[0] == "XAI_SOURCE_SAMPLE" for event in conn.events))

    def test_malformed_contamination_is_a_client_error_before_clearing_results(self):
        conn = FakeConnection()
        with self.assertRaises(HTTPException) as caught:
            service._discover_anomaly_v1(conn, {**PAYLOAD, "contamination": "not-a-number"})
        self.assertEqual(caught.exception.status_code, 400)
        self.assertFalse(any(event[0].startswith("XAI_CLEAR") for event in conn.events))

    def test_nonfinite_or_fractional_integral_options_are_client_errors(self):
        for option, value in [("runId", float("inf")), ("sampleRows", 100.5), ("maxDepth", float("inf")),
                              ("maxCategories", True), ("minSamplesLeaf", "bad"), ("contamination", float("nan"))]:
            conn = FakeConnection()
            with self.subTest(option=option), self.assertRaises(HTTPException) as caught:
                service._discover_anomaly_v1(conn, {**PAYLOAD, option: value})
            self.assertEqual(caught.exception.status_code, 400)
            self.assertFalse(any(event[0].startswith("XAI_CLEAR") for event in conn.events))

    def test_server_caps_are_bounded_by_algorithm_limits_and_one_input_feature_works(self):
        conn = FakeConnection()
        with patch.object(service.ml, "_ml_in_memory_row_limit", return_value=90000), \
                patch.object(service.ml, "_ml_input_feature_limit", return_value=900), \
                patch("backend.services.mixed_xai_algorithm.analyze_mixed_rows", return_value=analysis_result()) as analyze:
            service._discover_anomaly_v1(conn, PAYLOAD)
        options = analyze.call_args.args[2]
        self.assertEqual(options["maxRows"], 50000)
        self.assertEqual(options["maxColumns"], 128)
        self.assertEqual(options["maxFeatures"], 4096)
        conn = FakeConnection()
        with patch.object(service.ml, "_ml_input_feature_limit", return_value=1):
            result = service._discover_anomaly_v1(conn, PAYLOAD)
        self.assertEqual(result["encoding"]["encodedFeatureCount"], 2)

    def test_result_access_checks_ownership_before_reading_candidate_tables(self):
        conn = FakeConnection()
        conn.authorized = False
        with self.assertRaises(HTTPException) as caught:
            service.read_results(conn, 41, 7)
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual([event[0] for event in conn.events], ["XAI_FLOW_ACCESS"])
        conn = FakeConnection()
        result = service.read_results(conn, 41, 7)
        self.assertEqual(result["data"]["summary"]["ruleCount"], 2)


if __name__ == "__main__":
    unittest.main()
