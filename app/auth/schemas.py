from pydantic import BaseModel, constr
from typing import List, Literal


class LoginRequest(BaseModel):
    username: constr(min_length=3, max_length=80)
    password: constr(min_length=8, max_length=128)


class LoginResponse(BaseModel):
    ok: bool


class CreateUserRequest(BaseModel):
    username: constr(min_length=3, max_length=80)
    password: constr(min_length=8, max_length=128)
    roles: List[Literal["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]]
