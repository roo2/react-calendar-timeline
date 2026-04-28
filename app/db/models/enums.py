from __future__ import annotations

from enum import Enum


class OperationType(str, Enum):
    EXTRUSION = "extrusion"
    PRINTING_INLINE = "printing_inline"
    PRINTING_UTECO = "printing_uteco"
    CONVERSION = "conversion"
    PACKAGING_DISPATCH = "packaging_dispatch"


class JobStatus(str, Enum):
    PLANNED = "planned"
    SCHEDULED = "scheduled"
    RUNNING = "running"
    DISPATCHED = "dispatched"
    CANCELLED = "cancelled"


class OrderStatus(str, Enum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    # Invoiced in MYOB (sale invoice open) or legacy in-app dispatch.
    DISPATCHED = "dispatched"
    # MYOB invoice lines: ShipQuantity sums below order line quantities (by item UID).
    PARTIALLY_FULFILLED = "partially_fulfilled"
    CLOSED = "closed"
    CANCELLED = "cancelled"


class RunStatus(str, Enum):
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"


class QCCheckResult(str, Enum):
    PASS_ = "pass"
    FAIL = "fail"
    NA = "na"


class QCSource(str, Enum):
    MANUAL = "manual"
    SENSOR = "sensor"


class InventoryCategory(str, Enum):
    RAW_MATERIAL = "raw_material"
    WIP_EXTRUDED_ROLL = "wip_extruded_roll"
    WIP_PRINTED_ROLL = "wip_printed_roll"
    FINISHED_GOODS = "finished_goods"
    PACKAGING_MATERIAL = "packaging_material"
    SCRAP = "scrap"


class DispatchStatus(str, Enum):
    PENDING = "pending"
    READY = "ready"
    DISPATCHED = "dispatched"


class ToolReservationStatus(str, Enum):
    PLANNED = "planned"
    CONFLICTED = "conflicted"
    CANCELLED = "cancelled"
    FULFILLED = "fulfilled"


class JobQCSummaryStatus(str, Enum):
    DRAFT = "draft"
    FINAL_PASS = "final_pass"
    FINAL_FAIL = "final_fail"
    FINAL_PASS_WITH_DEVIATION = "final_pass_with_deviation"


# Additional internal enums
class QueueStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    REMOVED = "removed"


class MachineType(str, Enum):
    EXTRUDER = "extruder"
    PRINTER_UTECO = "printer_uteco"
    CONVERTER_BAGGER = "converter_bagger"


class SensorType(str, Enum):
    TEMPERATURE = "temperature"
    PRESSURE = "pressure"
    SPEED = "speed"
    HUMIDITY = "humidity"
    THICKNESS = "thickness"
    OTHER = "other"


class SensorProtocol(str, Enum):
    OPCUA = "opcua"
    MODBUS = "modbus"
    MQTT = "mqtt"
    HTTP = "http"
    FILE = "file"
    OTHER = "other"


class PrintingMethod(str, Enum):
    NONE = "none"
    INLINE = "inline"
    UTECO = "uteco"


def enum_db_values(py_enum: type[Enum]) -> list[str]:
    """Strings persisted in VARCHAR enum columns (Alembic uses native_enum=False)."""
    return [member.value for member in py_enum]
