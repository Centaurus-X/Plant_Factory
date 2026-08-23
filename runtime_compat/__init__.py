"""PF-LOGIC-V1 functional runtime compatibility package."""

from runtime_compat.automation_system_adapter import canonical_signal_facts
from runtime_compat.automation_system_adapter import execute_cycle
from runtime_compat.automation_system_adapter import logical_cross_command
from runtime_compat.plant_logic_runtime import evaluate_diagram
from runtime_compat.plant_logic_runtime import evaluate_model

__all__ = [
    "canonical_signal_facts",
    "execute_cycle",
    "logical_cross_command",
    "evaluate_diagram",
    "evaluate_model",
]
