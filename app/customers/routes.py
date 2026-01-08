from fastapi import APIRouter, Depends
from app.auth.deps import require_roles, allow_roles_any, csrf_protect

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_customers():
    # Placeholder only; business logic out of scope
    return {"ok": True, "data": []}


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_customer():
    # Placeholder only; business logic out of scope
    return {"ok": True}


