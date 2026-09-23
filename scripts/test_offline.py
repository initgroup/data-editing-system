"""Run backend regressions without loading .env or contacting Oracle/the network."""
from pathlib import Path
import io
import logging
import sys
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def blocked(*_args, **_kwargs):
    raise RuntimeError("External connections are disabled in offline tests.")


def main():
    # Patch before test discovery: app imports may initialize DB clients/logging.
    logging.disable(logging.CRITICAL)
    with (
        patch("dotenv.load_dotenv", return_value=False),
        patch("oracledb.connect", side_effect=blocked),
        patch("oracledb.create_pool", side_effect=blocked),
        patch("socket.create_connection", side_effect=blocked),
        patch("socket.socket.connect", side_effect=blocked),
        patch("logging.FileHandler._open", lambda _handler: io.StringIO()),
    ):
        loader = unittest.TestLoader()
        suite = (loader.loadTestsFromNames(sys.argv[1:]) if sys.argv[1:]
                 else loader.discover(str(ROOT / "backend/tests"), top_level_dir=str(ROOT)))
        result = unittest.TextTestRunner(verbosity=1).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
