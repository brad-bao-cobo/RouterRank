from __future__ import annotations
import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Supabase ─────────────────────────────────────────────────────────────
    supabase_url: str
    supabase_service_role_key: str

    # ── Official API keys ────────────────────────────────────────────────────
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    google_api_key: str = ""

    # ── Third-party API keys & base URLs ─────────────────────────────────────
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    easyrouter_api_key: str = ""
    easyrouter_base_url: str = "https://api.easyrouter.io/v1"

    bai_api_key: str = ""
    bai_base_url: str = "https://api.b.ai/v1"

    edenai_api_key: str = ""
    edenai_base_url: str = "https://api.edenai.run/v3"

    # Third-party providers use the same official model slug.
    # OpenRouter requires a "family/model" prefix; that is applied in llm_caller.py.
    # To mark a (provider, model_family) combo as unsupported, add it to
    # THIRD_PARTY_UNSUPPORTED in llm_caller.py — no config change needed.

    class Config:
        env_file = os.getenv("ENV_FILE", "../.env"), ".env"
        extra = "ignore"


settings = Settings()
