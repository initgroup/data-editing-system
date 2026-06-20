"""
@file           M03003.py
@description    Automatic rule discovery workbench API
"""

from backend.services.data_work_router import create_data_work_router


router = create_data_work_router(
    menu_code="M03003",
    sql_prefix="M03003",
    default_job_group="M03003",
    messages={
        "job_saved": "Work job saved.",
        "job_queued": "Work job queued.",
        "job_executed": "Work job executed.",
        "job_started": "Work job started.",
        "run_all_empty": "No enabled work jobs to execute.",
        "run_all_done": "work jobs executed."
    }
)
