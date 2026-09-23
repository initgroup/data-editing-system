import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException
from backend.routers import ml_analysis
from backend.services import mixed_xai_service, flow_contract_service, flow_work_service


class MixedXaiRoutesTests(unittest.TestCase):
    def test_discovery_http_uses_session_owner_and_commits_after_scope_check(self):
        conn = Mock()
        request = SimpleNamespace(state=SimpleNamespace(server_resource_limits={}))
        req = ml_analysis.MlAnalysisRequest(targetOwner="APP", targetTable="INITUP$T", runId=10, runSourceType="FLOW_WORK")
        with patch.object(ml_analysis, "get_target_db_connection", return_value=conn), \
             patch.object(ml_analysis, "get_request_user_id", return_value=7), \
             patch.object(mixed_xai_service, "require_scope") as access, \
             patch.object(mixed_xai_service, "discover", return_value={"status": "success"}) as operation:
            result = ml_analysis.mixed_xai_rule_discover(req, request)
        self.assertEqual(result["status"], "success")
        self.assertEqual(access.call_args.args[2], 7)
        self.assertEqual(operation.call_count, 1)
        conn.commit.assert_called_once()
        conn.close.assert_called_once()
        conn.rollback.assert_not_called()

    def test_early_stages_use_same_authenticated_scope_and_transaction(self):
        from backend.services import mixed_analysis_profile_service
        for route_name, operation_name in [("mixed_xai_profile", "profile"), ("mixed_xai_relation", "relationships")]:
            conn = Mock()
            request = SimpleNamespace(state=SimpleNamespace(server_resource_limits={}))
            req = ml_analysis.MlAnalysisRequest(targetOwner="APP", targetTable="INITUP$T", runId=10)
            with patch.object(ml_analysis, "get_target_db_connection", return_value=conn), \
                 patch.object(ml_analysis, "get_request_user_id", return_value=7), \
                 patch.object(mixed_xai_service, "require_scope") as scope, \
                 patch.object(mixed_analysis_profile_service, operation_name, return_value={"status": "success"}) as operation:
                getattr(ml_analysis, route_name)(req, request)
            scope.assert_called_once()
            self.assertEqual(7, scope.call_args.args[2])
            operation.assert_called_once()
            conn.commit.assert_called_once()
            conn.close.assert_called_once()

    def test_scope_failure_never_runs_model_and_rolls_back(self):
        conn = Mock()
        request = SimpleNamespace(state=SimpleNamespace(server_resource_limits={}))
        req = ml_analysis.MlAnalysisRequest(runId=10)
        with patch.object(ml_analysis, "get_target_db_connection", return_value=conn), \
             patch.object(ml_analysis, "get_request_user_id", return_value=7), \
             patch.object(mixed_xai_service, "require_scope", side_effect=HTTPException(404, "Unknown run")), \
             patch.object(mixed_xai_service, "discover") as operation:
            with self.assertRaises(HTTPException):
                ml_analysis.mixed_xai_rule_discover(req, request)
        operation.assert_not_called()
        conn.commit.assert_not_called()
        conn.rollback.assert_called_once()
        conn.close.assert_called_once()

    def test_detection_failure_rolls_back_and_closes(self):
        conn = Mock()
        request = SimpleNamespace(state=SimpleNamespace(server_resource_limits={}))
        req = ml_analysis.MlAnalysisRequest(runId=10, discoveryRunId=9)
        with patch.object(ml_analysis, "get_target_db_connection", return_value=conn), \
             patch.object(ml_analysis, "get_request_user_id", return_value=7), \
             patch.object(mixed_xai_service, "require_scope") as access, \
             patch.object(mixed_xai_service, "detect", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                ml_analysis.mixed_xai_rule_detect(req, request)
        self.assertEqual(access.call_count, 2)
        self.assertEqual(access.call_args_list[1].args[1]["P_RUN_ID"], 9)
        conn.rollback.assert_called_once()
        conn.close.assert_called_once()

    def test_flow_contract_requires_same_run_discovery_and_rejects_legacy_mix(self):
        discover = {"nodeKey": "discover", "execMethod": "MIXED_XAI_RULE_DISCOVER"}
        detect = {"nodeKey": "detect", "execMethod": "MIXED_XAI_RULE_DETECT"}
        legacy = {"nodeKey": "profile", "execObjectName": "INIT$_SP_PREDICTED_TYPE"}
        self.assertTrue(flow_contract_service.validate_flow_contracts([detect], []))
        edge = {"fromNodeKey": "discover", "toNodeKey": "detect", "fromPort": "xai-rules", "toPort": "xai-rules"}
        self.assertEqual(flow_contract_service.validate_flow_contracts([discover, detect], [edge]), [])
        self.assertTrue(any("separate FLOW" in error for error in flow_contract_service.validate_flow_contracts([legacy, discover, detect], [edge])))

    def test_lightweight_saved_history_uses_persisted_flow_type(self):
        data = flow_work_service.build_quick_edit_history_detail({"STATUS": "SUCCESS", "FLOW_TYPE": "MIXED_XAI_SCENARIO", "FLOW_RUN_ID": 10}, [])
        self.assertEqual(data["restoreState"]["processType"], "MIXED_XAI")
        legacy = flow_work_service.build_quick_edit_history_detail({"STATUS": "SUCCESS", "FLOW_RUN_ID": 9}, [])
        self.assertEqual(legacy["restoreState"]["processType"], "LEGACY")


if __name__ == "__main__":
    unittest.main()
