import os
import truststore
truststore.inject_into_ssl()
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import pricing, stream_test, test_run, model_evaluation, providers

app = FastAPI(
    title="Check4U API",
    description="Pricing transparency & token billing audit for AI router providers",
    version="0.2.0",
)

_extra = os.getenv("CORS_ORIGINS", "")
_allowed = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    *[o.strip() for o in _extra.split(",") if o.strip()],
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pricing.router)
app.include_router(stream_test.router)
app.include_router(test_run.router)
app.include_router(model_evaluation.router)
app.include_router(providers.router)


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}
