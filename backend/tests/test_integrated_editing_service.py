"""Exercise the actual four-stage dispatch with SQL-backed result persistence.

Only Oracle stored procedures/dialect and the authenticated connection boundary
are adapted. Python profiling, rule discovery, AST evaluation, orchestration,
scope checks and transaction handling run normally. This is not Oracle testing.
"""
import copy
import json
import re
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from backend.database_helper import SqlLoader
from backend.routers import ml_analysis as router
from backend.services import api_call_service as api
from backend.services import integrated_editing_service as service
from backend.services import ml_analysis_service as ml
from backend.services import mixed_pattern_service as patterns
from backend.services import mixed_xai_service as xai
from backend.services import data_work_service as jobs
from backend.services import flow_work_service as flows
from backend.services import scenario_default_design_service as defaults
from backend.tests.test_mixed_pattern_service import SqlConnection, SqlCursor, stored_rule, PAYLOAD
from backend.tests.test_mixed_xai_builtin_provisioning import RecordingDatabase, SCOPE
from backend.tests.test_xai_sql_compatibility import schema_columns, sqlite_statement


class UnifiedCursor(SqlCursor):
    def close(self):
        self.cursor.close()
        self.connection.closed_cursors += 1

    def execute(self, sql, params=None):
        sql_id = next((key for key, value in SqlLoader._query_map.items() if value == sql), None)
        if (sql_id and sql_id.startswith(("XAI_", "PATTERN_"))) or '"APP_OWNER"."SOURCE_DATA"' in sql:
            return super().execute(sql, params)
        params = params or {}
        expected = set(re.findall(r":([A-Za-z][A-Za-z0-9_]*)", sql))
        if expected != set(params):
            raise AssertionError(f"Bind mismatch for {sql_id}: {expected} != {set(params)}")
        self.connection.events.append((sql_id or "LEGACY_SQL", copy.deepcopy(params), sql))
        if sql.startswith("ALTER SESSION DISABLE PARALLEL"):
            return None
        adapted = sqlite_statement(sql)
        if adapted.strip().startswith("BEGIN"):
            for statement in re.findall(r"DELETE.*?;", adapted, re.S):
                self.cursor.execute(statement, params)
            return None
        if sql_id == "ML_ANALYSIS_INTEGRATED_TASK_ROLLBACK":
            adapted = adapted.replace("ROLLBACK TO SAVEPOINT", "ROLLBACK TO")
        if sql_id == "ML_ANALYSIS_ASSOC_RULE_MODEL_FOR_RUN":
            adapted = adapted.replace("WHERE ROWNUM = 1", "LIMIT 1")
        return self.cursor.execute(adapted, params)

    def callproc(self, name, args):
        db = self.connection
        db.procedures.append((name, copy.deepcopy(args)))
        if name == "INIT$_SP_PREDICTED_TYPE":
            owner, table, method, source, run_id = args
            db.insert("INIT$_TB_COLTYPE_RESULT", {"OWNER": owner, "TABLE_NAME": table,
                "RUN_SOURCE_TYPE": source, "RUN_ID": run_id, "COLUMN_NAME": "GROUP_CODE"})
        elif name == "INIT$_SP_RELATION_MATRIX_ANALYZE":
            pass  # The SQL boundary returns no passed edges for this fixture.
        elif name == "INIT$_SP_APRIORI_ASSOC_MODEL":
            rule = stored_rule("LEGACY_1", expected="L")
            rule.update(MODEL_NAME=args[0], MODEL_TYPE="APRIORI_ASSOCIATION", RULE_SOURCE="CONDITIONAL_FREQUENCY",
                        CONDITION_JSON=None, RESULT_JSON=None, VALIDATION_JSON=None, RESULT_KIND=None,
                        CREATE_DT="2026-01-01")
            db.insert(patterns.RULE_TABLE, rule)
        elif name == "INIT$_SP_RULE_VIOLATION_DETECT":
            model = args[1]
            if model.startswith("XAI_PATTERN_"):
                raise AssertionError("The legacy detector selected the mixed model")
            db.insert(patterns.VIOLATION_TABLE, {"RUN_SOURCE_TYPE": args[13], "RUN_ID": args[14],
                "TARGET_OWNER": args[2], "TARGET_TABLE": args[3], "MODEL_NAME": model,
                "RULE_ID": "LEGACY_1", "CASE_ID": "401", "RESULT_COLUMN": "VALUE",
                "EXPECTED_VALUE": "L", "ACTUAL_VALUE": "X", "VIOLATION_REASON": "LEGACY_TEST"})
        else:
            raise AssertionError(f"Unexpected Oracle procedure: {name}")
        if db.fail_procedure == name:
            raise RuntimeError("Injected Oracle procedure failure")


class UnifiedConnection(SqlConnection):
    def __init__(self):
        rows = [("A" if index % 2 else "B", "L" if index % 2 else "H", index) for index in range(1, 401)]
        rows += [("A", "X", 401), ("B", None, 402)]
        super().__init__(rows)
        self.procedures = []
        self.fail_procedure = None
        self.closed_connections = 0
        all_tables = schema_columns()
        needed = ("INIT$_TB_COLTYPE_RESULT", "INIT$_TB_COLTYPE_PROFILE", "INIT$_TB_COLTYPE_FINAL",
                  "INIT$_TB_COLREL_PAIR", "INIT$_TB_COLREL_NETWORK_NODE", "INIT$_TB_COLREL_NETWORK_EDGE",
                  "INIT$_TB_COLREL_LASSO_FEATURE", "INIT$_TB_RULEDISC_SYMBOLIC", "INIT$_TB_RULEVIOL_SYMBOLIC",
                  "INIT$_TB_PROJECT", "INIT$_TB_TABLES", "INIT$_TB_FLOW_WORK", "INIT$_TB_FLOW_WORK_RUN",
                  "INIT$_TB_DATA_WORK_RUN", "INIT$_TB_DATA_WORK_JOB")
        for table in needed:
            columns = ", ".join('"' + column + '"' for column in all_tables[table])
            self.db.execute('CREATE TABLE "' + table + '" (' + columns + ')')
        self.db.executescript("""
            UPDATE ALL_TAB_COLS SET DATA_TYPE='VARCHAR2' WHERE COLUMN_NAME='VALUE';
            CREATE VIEW ALL_TAB_COLUMNS AS SELECT *, NULL AS DATA_PRECISION, NULL AS DATA_SCALE, 'Y' AS NULLABLE FROM ALL_TAB_COLS;
            CREATE TABLE ALL_COL_COMMENTS (OWNER, TABLE_NAME, COLUMN_NAME, COMMENTS);
        """)
        self.insert("INIT$_TB_PROJECT", {"PROJECT_ID": 1, "USER_ID": 7})
        self.insert("INIT$_TB_TABLES", {"PROJECT_ID": 1, "SCENARIO_ID": 2,
                    "OWNER_NAME": "APP_OWNER", "TABLE_NAME": "SOURCE_DATA"})
        self.insert("INIT$_TB_FLOW_WORK", {"FLOW_ID": 3, "PROJECT_ID": 1, "SCENARIO_ID": 2})
        self.insert("INIT$_TB_FLOW_WORK_RUN", {"FLOW_RUN_ID": 41, "FLOW_ID": 3})
        self.db.commit()

    def cursor(self):
        return UnifiedCursor(self)

    def close(self):
        self.closed_connections += 1


class IntegratedEditingTests(unittest.TestCase):
    def connection(self):
        db = UnifiedConnection()
        self.addCleanup(db.db.close)
        return db

    def payload(self, **extra):
        return {**PAYLOAD, "P_RULE_PARTS": "CATEGORICAL", "P_SAMPLING_STRATEGY": "FIRST_ROWS", **extra}

    def request(self, **extra):
        request = Request({"type": "http", "headers": []})
        request.state.user_id = 7
        return router.MlAnalysisRequest(**self.payload(**extra)), request

    def test_actual_four_stage_pipeline_keeps_legacy_and_mixed_rules_and_provenance(self):
        db = self.connection()
        results = []
        for method in service.METHODS:
            result = api.execute_internal_python_api(db, method, self.payload())
            self.assertEqual("success", result["status"])
            self.assertEqual("UNIFIED_EDITING", result["algorithm"])
            self.assertEqual(41, result["runId"])
            results.append(result)
            db.commit()
        names = [name for name, _ in db.procedures]
        self.assertEqual(["INIT$_SP_PREDICTED_TYPE", "INIT$_SP_RELATION_MATRIX_ANALYZE",
                          "INIT$_SP_APRIORI_ASSOC_MODEL", "INIT$_SP_RULE_VIOLATION_DETECT"], names)
        self.assertEqual(["APP_OWNER", "SOURCE_DATA", "AUTO", "FLOW_WORK", 41], db.procedures[0][1])
        model_name = db.procedures[2][1][0]
        self.assertRegex(model_name, r"^UA_F_41_[A-F0-9]{8}$")
        self.assertEqual(model_name, db.procedures[3][1][1])
        self.assertEqual("N", db.procedures[3][1][12])
        self.assertEqual([model_name], results[2]["resultModels"])
        rules = db.records(patterns.RULE_TABLE)
        self.assertIn("CONDITIONAL_FREQUENCY", {r["RULE_SOURCE"] for r in rules})
        self.assertIn("MIXED_PATTERN_TREE", {r["RULE_SOURCE"] for r in rules})
        self.assertGreater(results[2]["mixedRuleCount"], 0)
        violations = db.records(patterns.VIOLATION_TABLE)
        self.assertIn("LEGACY_TEST", {r["VIOLATION_REASON"] for r in violations})
        self.assertTrue(any(str(r["VIOLATION_REASON"]).startswith("PATTERN_") for r in violations))
        summary = json.loads(db.records(xai.TABLES[0])[0]["SUMMARY_JSON"])
        self.assertEqual("MIXED_PATTERN_TREE", summary["algorithm"])
        self.assertEqual({"PROFILE", "RELATION", "DISCOVER", "DETECT"}, set(summary["integratedEditing"]["stages"]))
        self.assertIn("profile", summary)
        self.assertIn("relationships", summary)
        self.assertEqual(0, getattr(ml._ml_execution_state, "depth", 0))

    def test_payload_options_do_not_change_other_family_or_scope(self):
        ctx, legacy, mixed = service._payloads(self.payload(P_MIN_CONFIDENCE=.75, P_MAX_RULES=500,
            P_MIXED_MIN_CONFIDENCE=.995, mixedOptions={"maxRules": 24}, APP_ML_MAX_IN_MEMORY_ROWS=1200,
            P_COMMIT_YN="Y", P_CONTINUE_ON_ERROR="Y"))
        self.assertEqual(.75, legacy["P_MIN_CONFIDENCE"])
        self.assertEqual(500, legacy["P_MAX_RULES"])
        self.assertEqual(.995, mixed["P_MIN_CONFIDENCE"])
        self.assertEqual(24, mixed["P_MAX_RULES"])
        self.assertEqual(1200, mixed["APP_ML_MAX_IN_MEMORY_ROWS"])
        self.assertEqual("N", legacy["P_COMMIT_YN"])
        self.assertEqual("N", legacy["P_CONTINUE_ON_ERROR"])
        for extra in ({"mixedOptions": {"targetOwner": "OTHER"}}, {"P_MIXED_RUN_ID": 9},
                      {"mixedOptions": []}, {"discoveryRunId": 42}):
            with self.subTest(extra=extra), self.assertRaises(HTTPException):
                service._payloads(self.payload(**extra))

    def test_shipped_discovery_defaults_keep_legacy_and_mixed_limits_independent(self):
        rows = defaults.load_builtin_api_resource_rows(defaults.UNIFIED_STAGES[2])
        payload = {row["PARAM_NAME"]: row["DEFAULT_VALUE"] for row in rows}
        payload.update(P_TARGET_OWNER="APP_OWNER", P_TARGET_TABLE="SOURCE_DATA",
                       P_RUN_SOURCE_TYPE="FLOW_WORK", P_RUN_ID=41)
        _, legacy, mixed = service._payloads(payload)
        self.assertEqual("ALL", legacy["P_RULE_PARTS"])
        self.assertEqual("10", legacy["P_MAX_AUTO_TARGETS"])
        self.assertEqual("16", mixed["P_MAX_CONTINUOUS_TARGETS"])
        self.assertEqual("true", mixed["P_CONTINUOUS_ENABLED"])
        self.assertEqual("50000", legacy["P_SAMPLE_ROWS"])
        self.assertEqual("50000", mixed["P_SAMPLE_ROWS"])
        self.assertEqual("HASH", mixed["P_SAMPLING_STRATEGY"])
        self.assertFalse(any(key.startswith("P_MIXED_") for key in legacy))
        self.assertNotIn("P_MAX_AUTO_TARGETS", mixed)

    def test_persisted_summary_keeps_legacy_zero_reasons_separate_from_mixed_formula_and_sample_limits(self):
        db = self.connection()
        actual = service.discover(db, self.payload())
        ctx = xai.context(self.payload())
        legacy = {
            "status": "success", "parts": ["CATEGORICAL", "CONTINUOUS"], "taskCount": 3,
            "successCount": 1, "failedCount": 0, "skippedCount": 2,
            "continuousCriteria": {"minR2Score": .7, "maxAutoTargets": 10},
            "results": [
                {"task": "CATEGORICAL_APRIORI", "status": "success"},
                {"task": "CONTINUOUS_LASSO", "status": "success", "skippedYn": "Y",
                 "skipReason": "NO_USABLE_CONTINUOUS_DATA", "message": "No complete numeric rows.",
                 "targetSelection": {"eligibleColumns": ["A", "B"], "selectedColumns": ["A"], "omittedColumns": ["B"]},
                 "targets": [{"targetColumn": "A", "selectedCount": 0,
                              "memoryLimits": {"truncatedFeatureCount": 34, "truncatedFeatures": ["B"],
                                               "sampleSelection": "FIRST_ROWS", "sourceCompletenessKnown": False},
                              "rawTrainingMatrix": [[1, 2]]}],
                 "skippedTargets": [{"targetColumn": "A", "message": "No complete numeric rows."}]},
                {"task": "CONTINUOUS_SYMBOLIC", "status": "success", "skippedYn": "Y",
                 "skipReason": "NO_QUALIFIED_LASSO_TARGET", "message": "No target passed the LASSO criteria."},
            ],
        }
        mixed = {**actual["mixed"], "continuous": {"enabled": True, "status": "NO_VALIDATED_RULES",
                  "eligibleTargetCount": 16, "publishedRuleCount": 0, "rejectionReasons": {"LOW_VALIDATION_R2": 12}},
                 "sampling": "HASH", "sourceRowCountAtSampling": 30881, "sampleLimit": 25000,
                 "sampleCount": 2400, "sampleByteLimitReached": True,
                 "samplingWarnings": ["HASH_SAMPLE_BYTE_TRUNCATED_NOT_REPRESENTATIVE"]}
        result = service._combined("DISCOVER", ctx, legacy, mixed)
        service._persist_stage(db, ctx, {}, result)
        summary = json.loads(db.records(xai.TABLES[0])[0]["SUMMARY_JSON"])
        stored = summary["integratedEditing"]["stages"]["DISCOVER"]
        self.assertEqual("success", stored["status"])
        self.assertEqual(2, stored["legacySkippedCount"])
        diagnostics = stored["legacyDiagnostics"]
        self.assertEqual(legacy["continuousCriteria"], diagnostics["continuousCriteria"])
        self.assertEqual("NO_USABLE_CONTINUOUS_DATA", diagnostics["tasks"][1]["skipReason"])
        self.assertEqual(legacy["results"][1]["targetSelection"], diagnostics["tasks"][1]["targetSelection"])
        self.assertEqual(34, diagnostics["tasks"][1]["targets"][0]["memoryLimits"]["truncatedFeatureCount"])
        self.assertNotIn("rawTrainingMatrix", diagnostics["tasks"][1]["targets"][0])
        self.assertEqual("NO_QUALIFIED_LASSO_TARGET", diagnostics["tasks"][2]["skipReason"])
        self.assertEqual(mixed["continuous"], stored["mixedContinuousDiagnostics"])
        self.assertEqual(30881, stored["samplingDiagnostics"]["sourceRowCountAtSampling"])
        self.assertEqual(2400, stored["samplingDiagnostics"]["sampleCount"])
        self.assertTrue(stored["samplingDiagnostics"]["sampleByteLimitReached"])
        # A later stage retains discovery diagnostics, which the result API reads.
        service.detect(db, self.payload())
        after_detect = json.loads(db.records(xai.TABLES[0])[0]["SUMMARY_JSON"])
        self.assertEqual(stored, after_detect["integratedEditing"]["stages"]["DISCOVER"])

    def test_real_saved_discovery_job_binds_model_and_independent_thresholds(self):
        registry = RecordingDatabase()
        with patch.object(defaults, "execute_query", side_effect=registry.query), \
             patch.object(jobs, "execute_query", side_effect=registry.query):
            saved, _ = defaults.ensure_default_job(registry, defaults.UNIFIED_STAGES[2],
                                                   **{**SCOPE, "table_name": "SOURCE_DATA"})
        for param in saved["PARAMS"]:
            if param["itemName"] == "P_RULE_PARTS":
                param["itemDefault"] = "CATEGORICAL"
            if param["itemName"] == "P_SAMPLING_STRATEGY":
                param["itemDefault"] = "FIRST_ROWS"
        step = {"nodePayload": {"ownerName": "APP_OWNER", "tableName": "SOURCE_DATA",
                "resultCreateYn": "T", "resultOwner": "APP_OWNER", "resultTableName": patterns.RULE_TABLE}}
        runtime = flows.build_step_system_bind_values(step, {}, 41)
        db = self.connection()
        execution = api.execute_api_job(db, saved, runtime, run_id=41, include_result=True)
        result = execution["result"]
        self.assertEqual("success", result["status"])
        self.assertRegex(result["modelName"], r"^UA_F_41_[A-F0-9]{8}$")
        self.assertNotEqual(runtime["INIT$ResultModelName"], result["modelName"])
        self.assertEqual(.7, db.procedures[0][1][4])
        self.assertEqual(.99, result["mixed"]["options"]["minConfidence"])
        self.assertEqual(0, db.commits)

    def test_reexecuting_earlier_stage_invalidates_downstream_success_markers(self):
        db = self.connection()
        for method in service.METHODS:
            service.execute(db, method, self.payload())
        service.discover(db, self.payload())
        summary = json.loads(db.records(xai.TABLES[0])[0]["SUMMARY_JSON"])
        self.assertEqual({"PROFILE", "RELATION", "DISCOVER"}, set(summary["integratedEditing"]["stages"]))
        service.profile(db, self.payload())
        summary = json.loads(db.records(xai.TABLES[0])[0]["SUMMARY_JSON"])
        self.assertEqual({"PROFILE"}, set(summary["integratedEditing"]["stages"]))
        self.assertEqual("success", summary["integratedEditing"]["stages"]["PROFILE"]["status"])

    def test_automatic_models_are_scoped_to_source_run_and_target_but_explicit_name_is_kept(self):
        names = set()
        for source, run, table in (("FLOW_WORK", 41, "SOURCE_DATA"), ("FLOW_WORK", 42, "SOURCE_DATA"),
                                   ("DATA_WORK", 41, "SOURCE_DATA"), ("FLOW_WORK", 41, "OTHER_TABLE")):
            payload = self.payload(runSourceType=source, runId=run, targetTable=table)
            ctx, legacy, _ = service._payloads(payload)
            service._default_model(legacy, ctx)
            names.add(legacy["P_ASSOC_MODEL_NAME"])
        self.assertEqual(4, len(names))
        self.assertTrue(all(len(name) <= 30 for name in names))
        ctx, legacy, _ = service._payloads(self.payload(P_ASSOC_MODEL_NAME="MY_SAVED_MODEL"))
        service._default_model(legacy, ctx)
        self.assertEqual("MY_SAVED_MODEL", legacy["P_ASSOC_MODEL_NAME"])

    def test_legacy_custom_query_cannot_move_analysis_outside_the_scoped_source(self):
        for query in ('SELECT * FROM "APP_OWNER"."SOURCE_DATA"', 'select * from APP_OWNER.SOURCE_DATA;'):
            _, legacy, _ = service._payloads(self.payload(P_DATA_QUERY=query))
            self.assertNotIn("P_DATA_QUERY", legacy)
        for query in ('SELECT * FROM OTHER.TABLE1', 'SELECT * FROM APP_OWNER.SOURCE_DATA WHERE VALUE=1',
                      'SELECT * FROM APP_OWNER.SOURCE_DATA UNION ALL SELECT * FROM OTHER.TABLE1'):
            with self.subTest(query=query), self.assertRaises(HTTPException) as caught:
                service._payloads(self.payload(P_DATA_QUERY=query))
            self.assertEqual(422, caught.exception.status_code)

    def test_legacy_scope_clear_preserves_mixed_rules_and_violations(self):
        for sql_id in ("ML_ANALYSIS_RULE_DISCOVERY_SCOPE_CLEAR", "ML_ANALYSIS_RULE_VIOLATION_SCOPE_CLEAR"):
            with self.subTest(sql_id=sql_id):
                db = self.connection()
                db.seed_rules()
                legacy_rule = stored_rule("LEGACY_1")
                legacy_rule.update(MODEL_NAME="OLD_OML", RULE_SOURCE="CONDITIONAL_FREQUENCY", MODEL_TYPE="APRIORI_ASSOCIATION")
                db.insert(patterns.RULE_TABLE, legacy_rule)
                other = {**legacy_rule, "RUN_ID": 99}
                db.insert(patterns.RULE_TABLE, other)
                for model, run in (("OLD_OML", 41), ("XAI_PATTERN_41", 41), ("OLD_OML", 99)):
                    db.insert(patterns.VIOLATION_TABLE, {"RUN_SOURCE_TYPE": "FLOW_WORK", "RUN_ID": run,
                        "TARGET_OWNER": "APP_OWNER", "TARGET_TABLE": "SOURCE_DATA", "MODEL_NAME": model})
                ml.clear_integrated_analysis_scope(db, sql_id, "APP_OWNER", "SOURCE_DATA", "FLOW_WORK", 41)
                rules = db.records(patterns.RULE_TABLE)
                violations = db.records(patterns.VIOLATION_TABLE)
                self.assertEqual(2, sum(r["RULE_SOURCE"] == "MIXED_PATTERN_TREE" for r in rules))
                self.assertEqual({("XAI_PATTERN_41", 41), ("OLD_OML", 99)},
                                 {(r["MODEL_NAME"], r["RUN_ID"]) for r in violations})
                self.assertEqual(sql_id.endswith("VIOLATION_SCOPE_CLEAR"),
                                 any(r["MODEL_NAME"] == "OLD_OML" and r["RUN_ID"] == 41 for r in rules))

    def test_missing_schema_fails_before_legacy_procedures_or_writes(self):
        db = self.connection()
        db.db.execute("DELETE FROM USER_TAB_COLUMNS WHERE COLUMN_NAME='RESULT_JSON'")
        with self.assertRaises(HTTPException) as caught:
            service.profile(db, self.payload())
        self.assertEqual(409, caught.exception.status_code)
        self.assertEqual([], db.procedures)
        self.assertEqual([], db.records("INIT$_TB_COLTYPE_RESULT"))

    def test_http_scope_check_rejects_other_user_before_execution(self):
        db = self.connection()
        req, request = self.request()
        with patch.object(router, "get_target_db_connection", return_value=db), \
             patch.object(router, "get_request_user_id", return_value=8), self.assertRaises(HTTPException) as caught:
            router.unified_editing_profile(req, request)
        self.assertEqual(404, caught.exception.status_code)
        self.assertEqual([], db.procedures)
        self.assertEqual((0, 1, 1), (db.commits, db.rollbacks, db.closed_connections))

    def test_mixed_persistence_failure_rolls_back_and_retry_preserves_legacy_rows(self):
        db = self.connection()
        req, request = self.request()
        db.fail_on = "PATTERN_INSERT_RULE"
        with patch.object(router, "get_target_db_connection", return_value=db), \
             patch.object(router, "get_request_user_id", return_value=7):
            with self.assertRaisesRegex(RuntimeError, "Injected statement failure"):
                router.unified_editing_discover(req, request)
            self.assertEqual([], db.records(patterns.RULE_TABLE))
            self.assertEqual([], db.records(xai.TABLES[0]))
            self.assertEqual((0, 1), (db.commits, db.rollbacks))
            db.fail_on = None
            first = router.unified_editing_discover(req, request)
            count = len(db.records(patterns.RULE_TABLE))
            second = router.unified_editing_discover(req, request)
        self.assertEqual(count, len(db.records(patterns.RULE_TABLE)))
        self.assertEqual(first["mixedRuleCount"], second["mixedRuleCount"])
        self.assertEqual(1, sum(r["RULE_SOURCE"] == "CONDITIONAL_FREQUENCY" for r in db.records(patterns.RULE_TABLE)))
        self.assertEqual((2, 1, 3), (db.commits, db.rollbacks, db.closed_connections))

    def test_legacy_error_cannot_silently_return_mixed_only_success(self):
        db = self.connection()
        db.fail_procedure = "INIT$_SP_APRIORI_ASSOC_MODEL"
        req, request = self.request()
        with patch.object(router, "get_target_db_connection", return_value=db), \
             patch.object(router, "get_request_user_id", return_value=7), \
             self.assertRaisesRegex(RuntimeError, "Injected Oracle procedure failure"):
            router.unified_editing_discover(req, request)
        self.assertEqual([], db.records(patterns.RULE_TABLE))
        self.assertEqual([], db.records(xai.TABLES[0]))
        self.assertEqual((0, 1), (db.commits, db.rollbacks))

    def test_partial_result_is_rejected_and_existing_methods_still_registered(self):
        with self.assertRaises(HTTPException) as caught:
            service._require_complete({"status": "partial_success", "failedTasks": [
                {"task": "CONTINUOUS", "message": "resource limit"}]}, "discovery")
        self.assertIn("resource limit", caught.exception.detail)
        for method in (*service.METHODS, "MIXED_XAI_RULE_DISCOVER", "INTEGRATED_RULE_DISCOVER"):
            self.assertIn(method, api.INTERNAL_METHODS)
            self.assertEqual(method, ml.normalize_method(method))
        self.assertEqual("UNIFIED_EDITING_PROFILE", ml.get_method_from_spec(json.dumps({"endpoint": "/api/mlAnalysis/unified-editing-profile"})))


if __name__ == "__main__":
    unittest.main()
