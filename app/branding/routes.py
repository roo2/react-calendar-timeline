from fastapi import APIRouter

router = APIRouter(prefix="/admin/branding", tags=["branding"])


@router.get("/stub")
async def branding_stub():
    return {"status": "not_implemented"}


