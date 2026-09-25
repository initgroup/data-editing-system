"""Check route registration and the real auth middleware with no sockets/DB."""
import unittest
from unittest.mock import patch

from fastapi import Request
from fastapi.responses import JSONResponse

import main


class IntegratedHttpPolicyTests(unittest.TestCase):
    def test_health_and_unified_routes_are_registered_and_require_session(self):
        async def direct_threadpool(fn, *args):
            return fn(*args)

        async def health(request):
            self.assertEqual("/api/health", request.url.path)
            return JSONResponse(main.read_root())

        def invoke(path):
            request = Request({"type": "http", "method": "POST", "path": path,
                               "headers": [(b"x-login-user-id", b"1"), (b"x-login-role", b"ADMIN")],
                               "query_string": b"userId=1&role=ADMIN"})
            coroutine = main.enforce_api_authentication(request, health)
            # Every awaited operation completes synchronously through the adapter;
            # no event loop/self-pipe or background worker is needed in this test.
            try:
                coroutine.send(None)
            except StopIteration as completed:
                return completed.value
            finally:
                coroutine.close()
            self.fail("Unexpected asynchronous I/O")

        registered = {route.path for route in main.app.routes}
        with patch.object(main, "run_in_threadpool", direct_threadpool), \
             patch("backend.routers.ml_analysis.get_target_db_connection") as connection:
            self.assertEqual(200, invoke("/api/health").status_code)
            for stage in ("profile", "relation", "discover", "detect"):
                path = f"/api/mlAnalysis/unified-editing-{stage}"
                self.assertIn(path, registered)
                self.assertNotIn(path, main.PUBLIC_API_PATHS)
                self.assertEqual(401, invoke(path).status_code)
            connection.assert_not_called()


if __name__ == "__main__":
    unittest.main()
