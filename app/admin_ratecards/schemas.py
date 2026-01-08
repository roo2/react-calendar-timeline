from pydantic import BaseModel


class RateCard(BaseModel):
    table: str


