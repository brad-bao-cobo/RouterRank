"""
LLM callers returning a unified LLMResult per provider × model family.
All timing metrics (TTFT, TPOT, E2E) are measured client-side.
"""
from __future__ import annotations
import json
import time
from typing import Optional
from urllib.parse import urlparse

import httpx
from openai import AsyncOpenAI
from anthropic import AsyncAnthropic
from pydantic import BaseModel

from app.config import settings


class LLMResult(BaseModel):
    prompt: str
    output: str = ""
    prompt_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    ttft_ms: Optional[float] = None       # Time to first token (ms)
    tpot_ms: Optional[float] = None       # Avg time per output token after first (ms)
    e2e_ms: float = 0.0                   # End-to-end latency (ms)
    first_token: Optional[str] = None
    first_token_logprob: Optional[float] = None
    stop_reason: Optional[str] = None


def _tpot(ttft_ms: Optional[float], e2e_ms: float, output_tokens: Optional[int]) -> Optional[float]:
    if ttft_ms is None or output_tokens is None or output_tokens <= 1:
        return None
    return (e2e_ms - ttft_ms) / (output_tokens - 1)


# ── Official providers ────────────────────────────────────────────────────────

async def call_openai_gpt(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    t0 = time.perf_counter()
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    stream = await client.chat.completions.create(
        model=model_id,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
        stream_options={"include_usage": True},
        logprobs=True,
    )
    chunks: list[str] = []
    first_token: Optional[str] = None
    first_token_logprob: Optional[float] = None
    ttft_ms: Optional[float] = None
    prompt_tokens = output_tokens = None
    stop_reason: Optional[str] = None

    async for chunk in stream:
        if chunk.choices:
            delta = chunk.choices[0].delta
            if delta.content:
                text = delta.content
                if ttft_ms is None:
                    ttft_ms = (time.perf_counter() - t0) * 1000
                    lp = chunk.choices[0].logprobs
                    if lp and lp.content:
                        first_token = lp.content[0].token
                        first_token_logprob = lp.content[0].logprob
                    else:
                        first_token = text
                chunks.append(text)
            if chunk.choices[0].finish_reason:
                stop_reason = chunk.choices[0].finish_reason
        if chunk.usage:
            prompt_tokens = chunk.usage.prompt_tokens
            output_tokens = chunk.usage.completion_tokens

    e2e_ms = (time.perf_counter() - t0) * 1000
    return LLMResult(
        prompt=prompt, output="".join(chunks),
        prompt_tokens=prompt_tokens, output_tokens=output_tokens,
        ttft_ms=ttft_ms, tpot_ms=_tpot(ttft_ms, e2e_ms, output_tokens),
        e2e_ms=e2e_ms, first_token=first_token, first_token_logprob=first_token_logprob,
        stop_reason=stop_reason,
    )


async def call_anthropic_claude(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    t0 = time.perf_counter()
    create_kwargs: dict = dict(
        model=model_id, max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature, stream=True,
    )
    if system_prompt:
        create_kwargs["system"] = system_prompt
    stream = await client.messages.create(**create_kwargs)
    chunks: list[str] = []
    first_token: Optional[str] = None
    ttft_ms: Optional[float] = None
    prompt_tokens = output_tokens = None
    stop_reason: Optional[str] = None

    async for event in stream:
        data = event.model_dump()
        etype = data.get("type")
        if etype == "content_block_delta":
            text = data.get("delta", {}).get("text", "")
            if text:
                if ttft_ms is None:
                    ttft_ms = (time.perf_counter() - t0) * 1000
                    first_token = text
                chunks.append(text)
        elif etype == "message_start":
            prompt_tokens = data.get("message", {}).get("usage", {}).get("input_tokens")
        elif etype == "message_delta":
            output_tokens = data.get("usage", {}).get("output_tokens")
            stop_reason = data.get("delta", {}).get("stop_reason")

    e2e_ms = (time.perf_counter() - t0) * 1000
    return LLMResult(
        prompt=prompt, output="".join(chunks),
        prompt_tokens=prompt_tokens, output_tokens=output_tokens,
        ttft_ms=ttft_ms, tpot_ms=_tpot(ttft_ms, e2e_ms, output_tokens),
        e2e_ms=e2e_ms, first_token=first_token, first_token_logprob=None,
        stop_reason=stop_reason,
    )


async def call_google_gemini(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model_id}:streamGenerateContent"
    )
    t0 = time.perf_counter()
    chunks: list[str] = []
    first_token: Optional[str] = None
    ttft_ms: Optional[float] = None
    prompt_tokens = output_tokens = None

    stop_reason: Optional[str] = None

    gemini_body: dict = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }
    if system_prompt:
        gemini_body["systemInstruction"] = {"parts": [{"text": system_prompt}]}

    async with httpx.AsyncClient(timeout=60, verify=False) as http:
        async with http.stream(
            "POST", url,
            params={"key": settings.google_api_key, "alt": "sse"},
            json=gemini_body,
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if not data_str:
                    continue
                data = json.loads(data_str)
                candidate = data.get("candidates", [{}])[0]
                text = (
                    candidate.get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                if text:
                    if ttft_ms is None:
                        ttft_ms = (time.perf_counter() - t0) * 1000
                        first_token = text
                    chunks.append(text)
                if candidate.get("finishReason"):
                    stop_reason = candidate["finishReason"]
                usage = data.get("usageMetadata", {})
                if usage:
                    prompt_tokens = usage.get("promptTokenCount")
                    output_tokens = usage.get("candidatesTokenCount")

    e2e_ms = (time.perf_counter() - t0) * 1000
    return LLMResult(
        prompt=prompt, output="".join(chunks),
        prompt_tokens=prompt_tokens, output_tokens=output_tokens,
        ttft_ms=ttft_ms, tpot_ms=_tpot(ttft_ms, e2e_ms, output_tokens),
        e2e_ms=e2e_ms, first_token=first_token, first_token_logprob=None,
        stop_reason=stop_reason,
    )


# ── OpenRouter ────────────────────────────────────────────────────────────────

_OPENROUTER_HEADERS = {
    "Authorization": f"Bearer {settings.openrouter_api_key}",
    "Content-Type": "application/json",
    "HTTP-Referer": "https://check4u.ai",
    "X-OpenRouter-Title": "Check4U",
}


async def _call_openrouter(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    t0 = time.perf_counter()
    chunks: list[str] = []
    first_token: Optional[str] = None
    first_token_logprob: Optional[float] = None
    ttft_ms: Optional[float] = None
    prompt_tokens = output_tokens = None
    stop_reason: Optional[str] = None

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    async with httpx.AsyncClient(timeout=60, verify=False) as http:
        async with http.stream(
            "POST",
            f"{settings.openrouter_base_url.rstrip('/')}/chat/completions",
            headers=_OPENROUTER_HEADERS,
            json={
                "model": model_id,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": True,
                "logprobs": True,
            },
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if not data_str or data_str == "[DONE]":
                    continue
                data = json.loads(data_str)
                choices = data.get("choices", [])
                if choices:
                    text = choices[0].get("delta", {}).get("content") or ""
                    if text:
                        if ttft_ms is None:
                            ttft_ms = (time.perf_counter() - t0) * 1000
                            lp_list = (choices[0].get("logprobs") or {}).get("content") or []
                            if lp_list:
                                first_token = lp_list[0].get("token", text)
                                first_token_logprob = lp_list[0].get("logprob")
                            else:
                                first_token = text
                        chunks.append(text)
                    if choices[0].get("finish_reason"):
                        stop_reason = choices[0]["finish_reason"]
                usage = data.get("usage")
                if usage:
                    prompt_tokens = usage.get("prompt_tokens")
                    output_tokens = usage.get("completion_tokens")

    e2e_ms = (time.perf_counter() - t0) * 1000
    return LLMResult(
        prompt=prompt, output="".join(chunks),
        prompt_tokens=prompt_tokens, output_tokens=output_tokens,
        ttft_ms=ttft_ms, tpot_ms=_tpot(ttft_ms, e2e_ms, output_tokens),
        e2e_ms=e2e_ms, first_token=first_token, first_token_logprob=first_token_logprob,
        stop_reason=stop_reason,
    )


async def call_openrouter_gpt(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    return await _call_openrouter(f"openai/{model_id}", prompt, temperature, system_prompt, max_tokens)

async def call_openrouter_claude(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    return await _call_openrouter(f"anthropic/{model_id}", prompt, temperature, system_prompt, max_tokens)

async def call_openrouter_gemini(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    return await _call_openrouter(f"google/{model_id}", prompt, temperature, system_prompt, max_tokens)


# ── EasyRouter ────────────────────────────────────────────────────────────────

async def call_easyrouter_gpt(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    t0 = time.perf_counter()
    chunks: list[str] = []
    first_token: Optional[str] = None
    ttft_ms: Optional[float] = None
    prompt_tokens = output_tokens = None
    stop_reason: Optional[str] = None

    input_field: object = prompt
    if system_prompt:
        input_field = [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}]

    async with httpx.AsyncClient(timeout=60, verify=False) as http:
        async with http.stream(
            "POST",
            f"{settings.easyrouter_base_url.rstrip('/')}/responses",
            headers={"Authorization": f"Bearer {settings.easyrouter_api_key}", "Content-Type": "application/json"},
            json={"model": model_id, "input": input_field, "temperature": temperature, "max_output_tokens": max_tokens, "stream": True},
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if not data_str:
                    continue
                data = json.loads(data_str)
                etype = data.get("type", "")
                if etype == "response.output_text.delta":
                    text = data.get("delta", "")
                    if text:
                        if ttft_ms is None:
                            ttft_ms = (time.perf_counter() - t0) * 1000
                            first_token = text
                        chunks.append(text)
                elif etype == "response.completed":
                    resp = data.get("response", {})
                    usage = resp.get("usage", {})
                    prompt_tokens = usage.get("input_tokens") or usage.get("prompt_tokens")
                    output_tokens = usage.get("output_tokens") or usage.get("completion_tokens")
                    stop_reason = resp.get("status") or resp.get("stop_reason")

    e2e_ms = (time.perf_counter() - t0) * 1000
    return LLMResult(
        prompt=prompt, output="".join(chunks),
        prompt_tokens=prompt_tokens, output_tokens=output_tokens,
        ttft_ms=ttft_ms, tpot_ms=_tpot(ttft_ms, e2e_ms, output_tokens),
        e2e_ms=e2e_ms, first_token=first_token, first_token_logprob=None,
        stop_reason=stop_reason,
    )


async def call_easyrouter_claude(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    t0 = time.perf_counter()
    chunks: list[str] = []
    first_token: Optional[str] = None
    ttft_ms: Optional[float] = None
    prompt_tokens = output_tokens = None
    stop_reason: Optional[str] = None

    er_claude_body: dict = {
        "model": model_id, "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature, "stream": True,
    }
    if system_prompt:
        er_claude_body["system"] = system_prompt

    async with httpx.AsyncClient(timeout=60, verify=False) as http:
        async with http.stream(
            "POST",
            f"{settings.easyrouter_base_url.rstrip('/')}/messages",
            headers={
                "Authorization": f"Bearer {settings.easyrouter_api_key}",
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
            },
            json=er_claude_body,
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if not data_str:
                    continue
                data = json.loads(data_str)
                etype = data.get("type", "")
                if etype == "content_block_delta":
                    text = data.get("delta", {}).get("text", "")
                    if text:
                        if ttft_ms is None:
                            ttft_ms = (time.perf_counter() - t0) * 1000
                            first_token = text
                        chunks.append(text)
                elif etype == "message_start":
                    prompt_tokens = data.get("message", {}).get("usage", {}).get("input_tokens")
                elif etype == "message_delta":
                    output_tokens = data.get("usage", {}).get("output_tokens")
                    stop_reason = data.get("delta", {}).get("stop_reason")

    e2e_ms = (time.perf_counter() - t0) * 1000
    return LLMResult(
        prompt=prompt, output="".join(chunks),
        prompt_tokens=prompt_tokens, output_tokens=output_tokens,
        ttft_ms=ttft_ms, tpot_ms=_tpot(ttft_ms, e2e_ms, output_tokens),
        e2e_ms=e2e_ms, first_token=first_token, first_token_logprob=None,
        stop_reason=stop_reason,
    )


_EASYROUTER_GEMINI_ID: dict[str, str] = {
    "gemini-3.1-flash-lite": "gemini-3.1-flash-lite-preview",
}


async def call_easyrouter_gemini(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    er_model_id = _EASYROUTER_GEMINI_ID.get(model_id, model_id)
    parsed = urlparse(settings.easyrouter_base_url)
    url = f"{parsed.scheme}://{parsed.netloc}/v1beta/models/{er_model_id}:generateContent"
    t0 = time.perf_counter()

    er_gemini_body: dict = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }
    if system_prompt:
        er_gemini_body["systemInstruction"] = {"parts": [{"text": system_prompt}]}

    async with httpx.AsyncClient(timeout=60, verify=False) as http:
        r = await http.post(
            url,
            headers={"Authorization": f"Bearer {settings.easyrouter_api_key}", "Content-Type": "application/json"},
            json=er_gemini_body,
        )
        r.raise_for_status()
        data = r.json()

    e2e_ms = (time.perf_counter() - t0) * 1000
    candidate = data.get("candidates", [{}])[0]
    text = (
        candidate.get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    usage = data.get("usageMetadata", {})
    return LLMResult(
        prompt=prompt, output=text,
        prompt_tokens=usage.get("promptTokenCount"),
        output_tokens=usage.get("candidatesTokenCount"),
        ttft_ms=e2e_ms,   # non-streaming: TTFT ≈ E2E
        tpot_ms=None,
        e2e_ms=e2e_ms,
        first_token=text[:1] if text else None,
        first_token_logprob=None,
        stop_reason=candidate.get("finishReason"),
    )


# ── B.ai ──────────────────────────────────────────────────────────────────────

async def _call_bai(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    t0 = time.perf_counter()
    chunks: list[str] = []
    first_token: Optional[str] = None
    first_token_logprob: Optional[float] = None
    ttft_ms: Optional[float] = None
    prompt_tokens = output_tokens = None
    stop_reason: Optional[str] = None

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    async with httpx.AsyncClient(timeout=60, verify=False) as http:
        async with http.stream(
            "POST",
            f"{settings.bai_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.bai_api_key}", "Content-Type": "application/json"},
            json={
                "model": model_id,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": True,
                "logprobs": True,
            },
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if not data_str or data_str == "[DONE]":
                    continue
                data = json.loads(data_str)
                choices = data.get("choices", [])
                if choices:
                    text = choices[0].get("delta", {}).get("content") or ""
                    if text:
                        if ttft_ms is None:
                            ttft_ms = (time.perf_counter() - t0) * 1000
                            lp_list = (choices[0].get("logprobs") or {}).get("content") or []
                            if lp_list:
                                first_token = lp_list[0].get("token", text)
                                first_token_logprob = lp_list[0].get("logprob")
                            else:
                                first_token = text
                        chunks.append(text)
                    if choices[0].get("finish_reason"):
                        stop_reason = choices[0]["finish_reason"]
                usage = data.get("usage")
                if usage:
                    prompt_tokens = usage.get("prompt_tokens")
                    output_tokens = usage.get("completion_tokens")

    e2e_ms = (time.perf_counter() - t0) * 1000
    return LLMResult(
        prompt=prompt, output="".join(chunks),
        prompt_tokens=prompt_tokens, output_tokens=output_tokens,
        ttft_ms=ttft_ms, tpot_ms=_tpot(ttft_ms, e2e_ms, output_tokens),
        e2e_ms=e2e_ms, first_token=first_token, first_token_logprob=first_token_logprob,
        stop_reason=stop_reason,
    )


async def call_bai_gpt(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    return await _call_bai(model_id, prompt, temperature, system_prompt, max_tokens)

async def call_bai_claude(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    return await _call_bai(model_id, prompt, temperature, system_prompt, max_tokens)


# ── EdenAI ────────────────────────────────────────────────────────────────────

async def _call_edenai(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    """OpenAI-compatible SSE call to EdenAI. model_id must already include the
    provider prefix, e.g. 'openai/gpt-5.4-mini'."""
    t0 = time.perf_counter()
    chunks: list[str] = []
    first_token: Optional[str] = None
    first_token_logprob: Optional[float] = None
    ttft_ms: Optional[float] = None
    prompt_tokens = output_tokens = None
    stop_reason: Optional[str] = None

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    async with httpx.AsyncClient(timeout=60, verify=False) as http:
        async with http.stream(
            "POST",
            f"{settings.edenai_base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.edenai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_id,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": True,
            },
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if not data_str or data_str == "[DONE]":
                    continue
                data = json.loads(data_str)
                choices = data.get("choices", [])
                if choices:
                    text = choices[0].get("delta", {}).get("content") or ""
                    if text:
                        if ttft_ms is None:
                            ttft_ms = (time.perf_counter() - t0) * 1000
                            first_token = text
                        chunks.append(text)
                    if choices[0].get("finish_reason"):
                        stop_reason = choices[0]["finish_reason"]
                usage = data.get("usage")
                if usage:
                    prompt_tokens = usage.get("prompt_tokens")
                    output_tokens = usage.get("completion_tokens")

    e2e_ms = (time.perf_counter() - t0) * 1000
    return LLMResult(
        prompt=prompt, output="".join(chunks),
        prompt_tokens=prompt_tokens, output_tokens=output_tokens,
        ttft_ms=ttft_ms, tpot_ms=_tpot(ttft_ms, e2e_ms, output_tokens),
        e2e_ms=e2e_ms, first_token=first_token, first_token_logprob=first_token_logprob,
        stop_reason=stop_reason,
    )


async def call_edenai_gpt(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    return await _call_edenai(f"openai/{model_id}", prompt, temperature, system_prompt, max_tokens)

async def call_edenai_claude(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    return await _call_edenai(f"anthropic/{model_id}", prompt, temperature, system_prompt, max_tokens)

async def call_edenai_gemini(model_id: str, prompt: str, temperature: float, system_prompt: str = "", max_tokens: int = 1024) -> LLMResult:
    return await _call_edenai(f"google/{model_id}", prompt, temperature, system_prompt, max_tokens)
