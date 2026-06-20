"""
@file           M03001.py
@description    Data profiling workbench API
"""

from backend.services.data_work_router import create_data_work_router


router = create_data_work_router(
    menu_code="M03001",
    sql_prefix="M03001",
    default_job_group="M03001",
    messages={
        "job_saved": "Profile job saved.",
        "job_queued": "Profile job queued.",
        "job_executed": "Profile job executed.",
        "job_started": "Profile job started.",
        "run_all_empty": "No enabled profile jobs to execute.",
        "run_all_done": "profile jobs executed."
    }
)
