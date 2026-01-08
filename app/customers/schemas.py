from pydantic import BaseModel


class Customer(BaseModel):
    customer_id: int | None = None
    name: str


