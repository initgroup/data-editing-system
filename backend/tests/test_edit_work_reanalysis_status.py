import unittest
from pathlib import Path

from fastapi import HTTPException

from backend.services import edit_work_service


class EditWorkReanalysisStatusTests(unittest.TestCase):
    def test_applied_execution_can_be_reanalyzed(self):
        edit_work_service._require_reanalysis_execution({"SESSION_STATUS": "APPLIED"})

    def test_cancelled_execution_cannot_be_reanalyzed(self):
        with self.assertRaises(HTTPException) as raised:
            edit_work_service._require_reanalysis_execution({"SESSION_STATUS": "CANCELLED"})

        self.assertEqual(409, raised.exception.status_code)

    def test_m05003_enables_reanalysis_for_applied_execution(self):
        source = Path("frontend/js/MCOM_EDIT_WORK.js").read_text(encoding="utf-8")

        self.assertIn(
            '["DRAFT", "EDITING", "VALIDATED", "APPLY_READY", "APPLIED"].includes(sessionStatus)',
            source,
        )
        self.assertIn('await PageManager.load(', source)
        self.assertIn('PageManager.activePageCode !== "M04001"', source)


if __name__ == "__main__":
    unittest.main()
