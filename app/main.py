from fastapi import FastAPI, Request, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
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
try:
    from app.integrations.telemetry.routes import router as telemetry_router  # type: ignore
except Exception:
    telemetry_router = None
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
    from app.products.routes import suggestions_router as product_suggestions_router  # type: ignore
    print(f"✓ products_router imported successfully")
    print(f"  - Router prefix: {products_router.prefix}")
    print(f"  - Router routes count: {len(products_router.routes)}")
    print(f"  - Router type: {type(products_router)}")
    print(f"✓ product_suggestions_router imported successfully")
    print(f"  - Suggestions router prefix: {product_suggestions_router.prefix}")
    print(f"  - Suggestions router routes count: {len(product_suggestions_router.routes)}")
except Exception as e:  # pragma: no cover - allow tests without product deps
    import sys
    import traceback
    print(f"✗ ERROR: Failed to import products router: {e}", file=sys.stderr)
    traceback.print_exc()
    products_router = None
    product_suggestions_router = None
try:
    from app.orders.routes import router as orders_router  # type: ignore
except Exception:
    orders_router = None
try:
    from app.scheduling.routes import router as scheduling_router  # type: ignore
except Exception:
    scheduling_router = None
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
templates = Jinja2Templates(directory="app/templates")

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
if product_suggestions_router is not None:
    app.include_router(product_suggestions_router)
    try:
        print(f"✓ Product suggestions router registered with {len(product_suggestions_router.routes)} routes")
        for route in getattr(product_suggestions_router, "routes", []):
            if hasattr(route, "path") and hasattr(route, "methods"):
                methods = ", ".join(sorted(route.methods))
                print(f"  - {methods} {route.path}")
        print(f"  - Suggestions router prefix: {product_suggestions_router.prefix}")
    except Exception as _e:  # pragma: no cover
        import sys
        import traceback
        print(f"⚠ WARN: Failed to enumerate product suggestions routes: {_e}", file=sys.stderr)
        traceback.print_exc()
else:
    import sys
    print("✗ ERROR: Product suggestions router is None - routes will not be available!", file=sys.stderr)
app.include_router(quotes_router)
if orders_router is not None:
    app.include_router(orders_router)
if scheduling_router is not None:
    app.include_router(scheduling_router)
if production_router is not None:
    app.include_router(production_router)
if inventory_router is not None:
    app.include_router(inventory_router)
if dispatch_router is not None:
    app.include_router(dispatch_router)
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


@app.exception_handler(DomainError)
async def domain_error_handler(_, exc: DomainError):
    return JSONResponse(status_code=400, content={"error": exc.message})


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """User-friendly HTML for common HTTP errors; JSON for others."""
    status_code = exc.status_code
    # 401: redirect to login
    if status_code == status.HTTP_401_UNAUTHORIZED:
        from fastapi.responses import RedirectResponse
        return RedirectResponse(
            url="/auth/login?error=Please%20log%20in%20to%20access%20this%20page",
            status_code=status.HTTP_303_SEE_OTHER,
        )
    # 404: render page
    if status_code == status.HTTP_404_NOT_FOUND:
        identity = getattr(request.state, "identity", {"user": None, "roles": [], "csrf": None})
        return templates.TemplateResponse(
            "errors/404.html",
            {"request": request, "title": "Page Not Found", "identity": identity},
            status_code=status_code,
        )
    # 403: render page
    if status_code == status.HTTP_403_FORBIDDEN:
        identity = getattr(request.state, "identity", {"user": None, "roles": [], "csrf": None})
        return templates.TemplateResponse(
            "errors/403.html",
            {"request": request, "title": "Access Forbidden", "identity": identity},
            status_code=status_code,
        )
    # Default: return JSON for other HTTP errors
    return JSONResponse(status_code=status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """500 handler with friendly page; dev mode shows details."""
    import traceback
    import sys

    print(f"Unhandled exception: {exc}", file=sys.stderr)
    traceback.print_exc()

    identity = getattr(request.state, "identity", {"user": None, "roles": [], "csrf": None})
    error_detail = None
    if settings.ENV == "dev":
        error_detail = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return templates.TemplateResponse(
        "errors/500.html",
        {"request": request, "title": "Internal Server Error", "identity": identity, "error_detail": error_detail, "settings": settings},
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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


@app.get("/", response_class=HTMLResponse)
async def index(request: Request, identity=Depends(current_identity)):
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "title": "Home", "identity": identity},
    )


