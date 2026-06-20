"""
@file           M04001.py
@description    Integrated data editing flow API
"""

from backend.services.flow_work_router import create_flow_work_router


router = create_flow_work_router(
    menu_code="M04001",
    sql_prefix="M04001",
    default_flow_group="M04001",
    default_flow_type="INTEGRATED_EDITING_SCENARIO",
    messages={
        "flow_saved": "Integrated editing flow saved.",
        "flow_valid": "Integrated editing flow validation succeeded.",
        "run_done": "Integrated editing flow queued for DAG execution.",
        "run_queued": "Integrated editing flow queued for DAG execution."
    }
)
