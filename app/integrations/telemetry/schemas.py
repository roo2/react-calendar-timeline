from pydantic import BaseModel


class TelemetryEvent(BaseModel):
    sensor_id: str
    recorded_at: str
    value: float | str


