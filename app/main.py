from pathlib import Path

from fastapi import FastAPI, Request, Depends
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi import status
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.exceptions import DomainError
from app.db.session import engine
from app.health.routes import router as health_partials_router
from app.config import settings
try:
    from app.auth.routes import router as auth_router  # type: ignore
except Exception as e:  # pragma: no cover - allow tests without auth deps
    import sys
    import traceback

    print(f"ERROR: Failed to import auth router: {e}", file=sys.stderr)
    traceback.print_exc()
    auth_router = None
try:
    from app.system_admin.routes import router as sys_router  # type: ignore
except Exception:
    sys_router = None
from app.quotes.routes import router as quotes_router
from app.admin_ratecards.api_routes import router as admin_ratecards_api_router
from app.rate_cards.routes import router as rate_cards_router
try:
    from app.integrations.telemetry.routes import router as telemetry_router  # type: ignore
except Exception:
    telemetry_router = None
try:
    from app.integrations.myob.routes import router as myob_router  # type: ignore
except Exception:
    myob_router = None
try:
    # Test imports step by step
    try:
        from app.customers import service
        print("✓ customers.service imported successfully")
    except Exception as e:
        import sys
        import traceback
        print(f"✗ ERROR: Failed to import customers.service: {e}", file=sys.stderr)
        traceback.print_exc()
        raise
    
    try:
        from app.customers.schemas import CustomerCreateRequest
        print("✓ customers.schemas imported successfully")
    except Exception as e:
        import sys
        import traceback
        print(f"✗ ERROR: Failed to import customers.schemas: {e}", file=sys.stderr)
        traceback.print_exc()
        raise
    
    # Import router
    from app.customers.routes import router as customers_router  # type: ignore
    print(f"✓ customers_router imported successfully")
    print(f"  - Router prefix: {customers_router.prefix}")
    print(f"  - Router routes count: {len(customers_router.routes)}")
    print(f"  - Router type: {type(customers_router)}")
except Exception as e:  # pragma: no cover - allow tests without customer deps
    import sys
    import traceback

    print(f"✗ ERROR: Failed to import customers router: {e}", file=sys.stderr)
    traceback.print_exc()
    customers_router = None
try:
    # Test imports step by step
    try:
        from app.products import service as _products_service  # noqa: F401
        print("✓ products.service imported successfully")
    except Exception as e:
        import sys
        import traceback
        print(f"✗ ERROR: Failed to import products.service: {e}", file=sys.stderr)
        traceback.print_exc()
        raise
    try:
        from app.products.schemas import SpecPayload, CreateProductRequest  # noqa: F401
        print("✓ products.schemas imported successfully")
    except Exception as e:
        import sys
        import traceback
        print(f"✗ ERROR: Failed to import products.schemas: {e}", file=sys.stderr)
        traceback.print_exc()
        raise
    # Import routers
    from app.products.routes import router as products_router  # type: ignore
    print(f"✓ products_router imported successfully")
    print(f"  - Router prefix: {products_router.prefix}")
    print(f"  - Router routes count: {len(products_router.routes)}")
    print(f"  - Router type: {type(products_router)}")
except Exception as e:  # pragma: no cover - allow tests without product deps
    import sys
    import traceback
    print(f"✗ ERROR: Failed to import products router: {e}", file=sys.stderr)
    traceback.print_exc()
    products_router = None

try:
    from app.job_sheets.routes import router as job_sheets_router  # type: ignore
except Exception:
    job_sheets_router = None
try:
    from app.orders.routes import router as orders_router  # type: ignore
except Exception:
    orders_router = None
try:
    from app.scheduling.routes import router as scheduling_router  # type: ignore
except Exception:
    scheduling_router = None
try:
    from app.production_calendar.routes import router as production_calendar_router  # type: ignore
except Exception:
    production_calendar_router = None
try:
    from app.production.routes import router as production_router  # type: ignore
except Exception:
    production_router = None
try:
    from app.inventory.routes import router as inventory_router  # type: ignore
except Exception:
    inventory_router = None
try:
    from app.dispatch.routes import router as dispatch_router  # type: ignore
except Exception:
    dispatch_router = None
try:
    from app.tools.routes import router as tools_admin_router  # type: ignore
except Exception:
    tools_admin_router = None
try:
    from app.dashboard.routes import router as dashboard_router  # type: ignore
except Exception:
    dashboard_router = None
try:
    from app.auth.middleware import IdentityMiddleware  # type: ignore
except Exception:  # pragma: no cover
    class IdentityMiddleware:  # type: ignore
        def __init__(self, app):
            self.app = app
        async def __call__(self, scope, receive, send):
            return await self.app(scope, receive, send)


app = FastAPI(title="Production Software")


@app.on_event("startup")
async def _mark_stale_myob_import_jobs() -> None:
    """Mark in-DB ``running`` MYOB import jobs as interrupted so imports can be resumed after deploy/crash."""
    try:
        from app.integrations.myob.myob_import_job import mark_interrupted_jobs_on_startup

        n = mark_interrupted_jobs_on_startup()
        if n:
            import sys

            print(f"MYOB import: marked {n} running job(s) as interrupted (resume via POST /api/myob/import/jobs/{{id}}/resume).", file=sys.stderr)
    except Exception as e:  # pragma: no cover - DB may be unavailable in odd boot orders
        import sys

        print(f"WARN: MYOB import startup hook failed: {e}", file=sys.stderr)

# Identity dependency (fallback if auth deps unavailable)
try:
    from app.auth.deps import current_identity  # type: ignore
except Exception:  # pragma: no cover
    async def current_identity(_request: Request):  # type: ignore
        return {"user": None, "roles": [], "csrf": None}

# Attach middleware for loading current user/session identity
app.add_middleware(IdentityMiddleware)

# Static files (CSS/JS/assets)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Frontend (React build artifacts)
_REPO_ROOT = Path(__file__).resolve().parents[1]
_FRONTEND_DIST = _REPO_ROOT / "frontend" / "dist"
_FRONTEND_INDEX = _FRONTEND_DIST / "index.html"
_FRONTEND_ASSETS = _FRONTEND_DIST / "assets"
if _FRONTEND_ASSETS.exists():
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_ASSETS)), name="spa-assets")

# Routers
if auth_router is not None:
    app.include_router(auth_router)
    try:
        print(f"✓ Auth router registered with {len(auth_router.routes)} routes")
        for route in getattr(auth_router, "routes", []):
            if hasattr(route, "path") and hasattr(route, "methods"):
                methods = ", ".join(sorted(route.methods))
                print(f"  - {methods} {route.path}")
    except Exception as _e:  # pragma: no cover
        import sys
        print(f"WARN: Failed to enumerate auth routes: {_e}", file=sys.stderr)
else:
    import sys
    print("✗ ERROR: Auth router is None - routes will not be available!", file=sys.stderr)
if sys_router is not None:
    app.include_router(sys_router)
if customers_router is not None:
    app.include_router(customers_router)
    try:
        print(f"✓ Customers router registered with {len(customers_router.routes)} routes")
        for route in getattr(customers_router, "routes", []):
            if hasattr(route, "path") and hasattr(route, "methods"):
                methods = ", ".join(sorted(route.methods))
                print(f"  - {methods} {route.path}")
        # Also print router prefix to verify
        print(f"  - Router prefix: {customers_router.prefix}")
    except Exception as _e:  # pragma: no cover
        import sys
        import traceback
        print(f"⚠ WARN: Failed to enumerate customer routes: {_e}", file=sys.stderr)
        traceback.print_exc()
else:
    import sys
    print("✗ ERROR: Customers router is None - routes will not be available!", file=sys.stderr)
if products_router is not None:
    app.include_router(products_router)
    try:
        print(f"✓ Products router registered with {len(products_router.routes)} routes")
        for route in getattr(products_router, "routes", []):
            if hasattr(route, "path") and hasattr(route, "methods"):
                methods = ", ".join(sorted(route.methods))
                print(f"  - {methods} {route.path}")
        print(f"  - Router prefix: {products_router.prefix}")
    except Exception as _e:  # pragma: no cover
        import sys
        import traceback
        print(f"⚠ WARN: Failed to enumerate product routes: {_e}", file=sys.stderr)
        traceback.print_exc()
else:
    import sys
    print("✗ ERROR: Products router is None - routes will not be available!", file=sys.stderr)

if job_sheets_router is not None:
    app.include_router(job_sheets_router)

app.include_router(quotes_router)
app.include_router(admin_ratecards_api_router)
try:
    from app.resell_products.routes import router as resell_admin_router
    from app.resell_products.routes import public_router as resell_public_router
except Exception:  # pragma: no cover
    resell_admin_router = None
    resell_public_router = None
if resell_admin_router is not None:
    app.include_router(resell_admin_router)
if resell_public_router is not None:
    app.include_router(resell_public_router)
app.include_router(rate_cards_router)
if orders_router is not None:
    app.include_router(orders_router)
if scheduling_router is not None:
    app.include_router(scheduling_router)
if production_calendar_router is not None:
    app.include_router(production_calendar_router)
if production_router is not None:
    app.include_router(production_router)
if inventory_router is not None:
    app.include_router(inventory_router)
if dispatch_router is not None:
    app.include_router(dispatch_router)
if tools_admin_router is not None:
    app.include_router(tools_admin_router)
# Dashboard
if dashboard_router is not None:
    app.include_router(dashboard_router)
# HTMX partials
app.include_router(health_partials_router)
# from app.admin_ratecards.routes import router as ratecards_router
# from app.system_admin.routes import router as sys_router
# from app.branding.routes import router as branding_router
if telemetry_router is not None:
    app.include_router(telemetry_router)
if myob_router is not None:
    app.include_router(myob_router)


@app.exception_handler(DomainError)
async def domain_error_handler(_, exc: DomainError):
    return JSONResponse(status_code=400, content={"error": exc.message})


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """JSON for HTTP errors (SPA handles UI rendering)."""
    status_code = exc.status_code
    return JSONResponse(status_code=status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """500 handler: JSON in all cases; SPA handles UI."""
    import traceback
    import sys

    print(f"Unhandled exception: {exc}", file=sys.stderr)
    traceback.print_exc()

    error_detail = None
    if settings.ENV == "dev":
        error_detail = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal Server Error", "error_detail": error_detail},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/health/db")
async def health_db():
    try:
        with engine.connect() as conn:
            # Explicit 1s statement timeout at the session level
            conn.execute(text("SET statement_timeout = '1s'"))
            result = conn.execute(text("SELECT 1"))
            _ = result.fetchone()  # force execution
        return {"status": "ok", "db": "ok"}
    except (SQLAlchemyError, Exception) as e:
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "db": "error", "message": str(e)},
        )


@app.get("/", include_in_schema=False)
async def spa_index():
    # Serve built React app in production-like runs.
    if _FRONTEND_INDEX.exists():
        return FileResponse(_FRONTEND_INDEX)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Frontend not built. Run `cd frontend && npm install && npm run build` (or `npm run dev` for dev)."
        },
    )


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    # Let API/static routes behave normally.
    if full_path.startswith(("api/", "static/", "assets/")):
        raise StarletteHTTPException(status_code=404, detail="Not Found")
    if _FRONTEND_INDEX.exists():
        return FileResponse(_FRONTEND_INDEX)
    raise StarletteHTTPException(status_code=404, detail="Not Found")


