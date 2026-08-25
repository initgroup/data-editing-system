import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException, Response

from backend import auth_context, target_database
from backend.routers import auth


ROOT = Path(__file__).resolve().parents[2]


class _Cursor:
    def __init__(self, rowcount=1):
        self.rowcount = rowcount
        self.executions = []
        self.closed = False

    def execute(self, sql, params=None):
        self.executions.append((sql, params))

    def close(self):
        self.closed = True


class _Connection:
    def __init__(self, cursor=None):
        self._cursor = cursor or _Cursor()
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


class TargetDbSessionSwitchTests(unittest.TestCase):
    def test_response_refresh_keeps_rotated_session_cookie(self):
        request = SimpleNamespace(
            state=SimpleNamespace(session_cookie_token_override="new-token"),
        )
        response = Response()

        with (
            patch.object(auth_context, "_get_session_token", return_value="old-token"),
            patch.object(auth_context, "set_session_cookie") as set_cookie,
        ):
            auth_context.refresh_session_cookie(request, response)

        set_cookie.assert_called_once_with(response, "new-token", request)

    def test_rotate_session_revokes_old_token_and_sets_cookie_override(self):
        cursor = _Cursor(rowcount=1)
        conn = _Connection(cursor)
        request = SimpleNamespace(state=SimpleNamespace())

        with (
            patch.object(auth_context, "_get_session_token", return_value="old-token"),
            patch.object(auth_context, "create_login_session", return_value="new-token"),
            patch.object(auth_context.SqlLoader, "get_sql", return_value="REVOKE SQL"),
            patch.object(auth_context, "_release_session_touch_reservation") as release_touch,
            patch.object(auth_context, "_invalidate_verified_session") as invalidate_session,
        ):
            token = auth_context.rotate_login_session_target(conn, request, 7, 22)

        self.assertEqual(token, "new-token")
        self.assertEqual(request.state.session_cookie_token_override, "new-token")
        self.assertEqual(conn.commits, 1)
        self.assertEqual(conn.rollbacks, 0)
        self.assertEqual(cursor.executions[0][1]["userId"], 7)
        release_touch.assert_called_once()
        invalidate_session.assert_called_once()

    def test_rotate_session_rolls_back_when_old_session_was_not_revoked(self):
        conn = _Connection(_Cursor(rowcount=0))
        request = SimpleNamespace(state=SimpleNamespace())

        with (
            patch.object(auth_context, "_get_session_token", return_value="old-token"),
            patch.object(auth_context, "create_login_session", return_value="new-token"),
            patch.object(auth_context.SqlLoader, "get_sql", return_value="REVOKE SQL"),
        ):
            with self.assertRaises(HTTPException) as raised:
                auth_context.rotate_login_session_target(conn, request, 7, 22)

        self.assertEqual(raised.exception.status_code, 401)
        self.assertEqual(conn.commits, 0)
        self.assertEqual(conn.rollbacks, 1)

    def test_target_header_must_match_authenticated_server_session(self):
        request = SimpleNamespace(
            state=SimpleNamespace(
                internal_api_authorized=False,
                auth_user={"targetConnectionId": 22},
            ),
            headers={"X-Target-Connection-Id": "11"},
        )

        with self.assertRaises(HTTPException) as raised:
            target_database.get_target_connection_id(request)

        self.assertEqual(raised.exception.status_code, 409)

    def test_switch_endpoint_rotates_to_authorized_enabled_connection(self):
        conn = _Connection()
        request = SimpleNamespace(state=SimpleNamespace(), cookies={})
        response = Response()
        connection_row = {
            "CONNECTION_ID": 22,
            "CONNECTION_NAME": "LOCAL",
            "DB_TYPE": "ORACLE",
            "CONNECTION_SCOPE": "PRIVATE",
            "USE_YN": "Y",
        }

        with (
            patch.object(auth, "authenticate_request", return_value={"userId": 7}),
            patch.object(auth, "get_db_connection", return_value=conn),
            patch.object(auth, "_get_connection_detail", return_value=connection_row) as get_detail,
            patch.object(auth, "load_server_resource_limits", return_value={"MAX_ROWS": 100}) as load_limits,
            patch.object(auth, "rotate_login_session_target", return_value="new-token") as rotate_session,
            patch.object(auth, "set_session_cookie") as set_cookie,
        ):
            result = auth.switch_target_session(
                auth.ConnectionIdRequest(connectionId=22),
                request,
                response,
            )

        self.assertEqual(result["targetConnectionId"], 22)
        self.assertEqual(result["connection"]["connectionName"], "LOCAL")
        get_detail.assert_called_once_with(conn, 22, 7)
        load_limits.assert_called_once_with(conn, 7, 22, force_refresh=True)
        rotate_session.assert_called_once_with(conn, request, 7, 22)
        set_cookie.assert_called_once_with(response, "new-token", request)
        self.assertTrue(conn.closed)

    def test_frontend_switches_server_session_before_browser_context(self):
        app_source = (ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
        server_switch = app_source.index("/M91001/session/target")
        local_switch = app_source.index(
            'sessionStorage.setItem("targetConnectionId", switchedConnectionId)',
            server_switch,
        )

        self.assertLess(server_switch, local_switch)
        self.assertIn('new BroadcastChannel("init.target-context.v1")', app_source)

        report_source = (ROOT / "frontend" / "js" / "report-viewer.js").read_text(encoding="utf-8")
        self.assertIn("TARGET_DB_CHANGED", report_source)
        self.assertIn("closeViewer()", report_source)


if __name__ == "__main__":
    unittest.main()
