from __future__ import annotations
import json
from pydantic import BaseModel, Field
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.models.registry import MODEL_REGISTRY, ModelSpec, _DEFAULT_SLUGS, _ALL_PROVIDERS
from app.services.llm_caller import (
    call_openai_gpt,
    call_anthropic_claude,
    call_google_gemini,
    call_openrouter_gpt,
    call_openrouter_claude,
    call_openrouter_gemini,
    call_easyrouter_gpt,
    call_easyrouter_claude,
    call_easyrouter_gemini,
    call_bai_gpt,
    call_bai_claude,
    call_edenai_gpt,
    call_edenai_claude,
    call_edenai_gemini,
)

router = APIRouter(prefix="/stream-test-result", tags=["stream-test"])

# (provider, model_family) → async call function returning LLMResult
_FUNCS: dict[tuple[str, str], object] = {
    ("OpenAI",    "GPT"):    call_openai_gpt,
    ("Anthropic", "Claude"): call_anthropic_claude,
    ("Google",    "Gemini"): call_google_gemini,

    ("OpenRouter", "GPT"):    call_openrouter_gpt,
    ("OpenRouter", "Claude"): call_openrouter_claude,
    ("OpenRouter", "Gemini"): call_openrouter_gemini,

    ("EasyRouter", "GPT"):    call_easyrouter_gpt,
    ("EasyRouter", "Claude"): call_easyrouter_claude,
    ("EasyRouter", "Gemini"): call_easyrouter_gemini,

    ("B.ai", "GPT"):    call_bai_gpt,
    ("B.ai", "Claude"): call_bai_claude,
    # B.ai + Gemini 不支持

    ("EdenAI", "GPT"):    call_edenai_gpt,
    ("EdenAI", "Claude"): call_edenai_claude,
    ("EdenAI", "Gemini"): call_edenai_gemini,
}

class StreamTestRequest(BaseModel):
    prompt:        str   = Field(..., min_length=1, max_length=8000)
    system_prompt: str   = Field(default="", max_length=4000)
    temperature:   float = Field(default=0.0, ge=0.0, le=2.0)
    models: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_SLUGS),
        description="Model slugs, e.g. ['gpt-5.4-mini']",
    )
    providers: list[str] = Field(
        default=_ALL_PROVIDERS,
        description="Providers: OpenAI / Anthropic / Google / OpenRouter / EasyRouter / B.ai",
    )
    max_tokens: int = Field(default=1024, ge=1, le=16384)

    def resolved_models(self) -> list[ModelSpec]:
        return [MODEL_REGISTRY[slug] for slug in self.models if slug in MODEL_REGISTRY]


@router.post("")
async def stream_test_result(req: StreamTestRequest):
    """
    对每个 (model × provider) 发起真实 API 调用，返回统一 LLMResult 结构。
    不在支持列表里的组合自动跳过（如 B.ai + Gemini）。
    """
    async def generate():
        for model in req.resolved_models():
            for provider in req.providers:
                func = _FUNCS.get((provider, model.model_family))
                if func is None:
                    continue

                yield f"data: {json.dumps({'__start__': True, 'provider': provider, 'model': model.display_name, 'model_id': model.model_id})}\n\n"

                try:
                    result = await func(model.model_id, req.prompt, req.temperature, req.system_prompt, req.max_tokens)
                    payload = result.model_dump()
                    payload["provider"] = provider
                    payload["model"] = model.display_name
                    payload["model_id"] = model.model_id
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                except Exception as exc:
                    yield f"data: {json.dumps({'__error__': True, 'provider': provider, 'model': model.display_name, 'error': str(exc)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
