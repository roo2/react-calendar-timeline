from fastapi import APIRouter

router = APIRouter(prefix="/admin/rate-cards", tags=["admin_ratecards"])


@router.get("/stub")
async def ratecards_stub():
    return {"status": "not_implemented"}


