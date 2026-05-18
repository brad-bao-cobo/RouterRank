"use client";

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLang } from "@/lib/contexts/lang";
import { useToast } from "@/lib/contexts/toast";
import { BENCHMARK_TEMPLATES } from "@/lib/benchmarks";
import { useData } from "@/lib/contexts/data";
import { useStreamingText } from "@/lib/use-streaming-text";
import { copyToClipboard, cx, fmtUSD } from "@/lib/utils";
import { I } from "@/components/ui/icons";
import { ModelDropdown } from "@/components/ui/model-dropdown";
import { ProviderMark } from "@/components/ui/provider-mark";
import { RangeInput } from "@/components/ui/range-input";
import { TrustBadge } from "@/components/ui/trust-badge";
import { Modal } from "@/components/ui/modal";
import type { SVGProps } from "react";

// ─── inline SVG icons not in the shared I object ────────────────────────────

type IconProps = SVGProps<SVGSVGElement>;

function IconSend(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}>
      <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

function IconThumbUp(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

function IconThumbDown(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
      <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
    </svg>
  );
}

function IconSliders(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

// ─── message types ───────────────────────────────────────────────────────────

interface Response {
  slug: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  thumb: "up" | "down" | null;
  latency?: number;
  ttft?: number;
  cost?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  content?: string | null;
  error?: string | null;
}

interface UserMessage {
  id: string;
  role: "user";
  ts: number;
  content: string;
}

interface AssistantMessage {
  id: string;
  role: "assistant";
  ts: number;
  turnId: string;
  responses: Response[];
}

type Message = UserMessage | AssistantMessage;

// ─── public export ────────────────────────────────────────────────────────────

export function RunPageBody() {
  return (
    <Suspense fallback={null}>
      <RunPageInner />
    </Suspense>
  );
}

// ─── main inner component ─────────────────────────────────────────────────────

function RunPageInner() {
  const { t } = useLang();
  const { providers, models } = useData();
  const toast = useToast();
  const params = useSearchParams();

  // URL-supplied overrides (computed once at mount)
  const urlProviders = useMemo(() => {
    const single = params.get("provider");
    const multi = (params.get("providers") || "").split(",").filter(Boolean);
    if (single) return [single];
    return multi.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [model, setModel] = useState<string>(() => params.get("model") || "");
  const [activeProviders, setActiveProviders] = useState<string[]>(urlProviders);
  const [temperature, setTemperature] = useState(0);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [compose, setCompose] = useState("");
  const [showParams, setShowParams] = useState(false);
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const composeRef = useRef<HTMLTextAreaElement | null>(null);
  const threadBottomRef = useRef<HTMLDivElement | null>(null);
  const latestUserAnchorRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const defaultsInitialized = useRef(false);

  // Set model + provider defaults from API data the first time they load
  useEffect(() => {
    if (defaultsInitialized.current) return;
    if (providers.length === 0 || models.length === 0) return;
    defaultsInitialized.current = true;

    const targetModel = model || models[0].id;
    if (!model) setModel(targetModel);

    if (activeProviders.length === 0) {
      const defaults = providers
        .filter((p) => p.type !== "inference" && p.modelPricing[targetModel])
        .slice(0, 3)
        .map((p) => p.slug);
      setActiveProviders(
        defaults.length > 0
          ? defaults
          : providers.filter((p) => p.type !== "inference").slice(0, 3).map((p) => p.slug),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, models]);

  const inFlight = useMemo(
    () =>
      messages.some(
        (m) =>
          m.role === "assistant" &&
          m.responses.some((r) => r.status === "pending" || r.status === "running"),
      ),
    [messages],
  );

  const supportedSlugs = useMemo(
    () =>
      new Set(
        providers.filter((p) => p.modelPricing && p.modelPricing[model]).map((p) => p.slug),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, providers],
  );

  // Drop any active providers that don't support the new model
  useEffect(() => {
    const filtered = activeProviders.filter((s) => supportedSlugs.has(s));
    if (filtered.length === activeProviders.length) return;
    const padded =
      filtered.length === 0 && supportedSlugs.size > 0
        ? [Array.from(supportedSlugs)[0]]
        : filtered;
    setActiveProviders(padded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Scroll latest user message to viewport top after submit (ChatGPT-style)
  useEffect(() => {
    if (latestUserAnchorRef.current) {
      latestUserAnchorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [messages.length]);

  const updateResponse = (
    prev: Message[],
    turnId: string,
    slug: string,
    updater: (r: Response) => Response,
  ): Message[] =>
    prev.map((m) =>
      m.role === "assistant" && m.turnId === turnId
        ? { ...m, responses: m.responses.map((r) => (r.slug === slug ? updater(r) : r)) }
        : m,
    );

  const fanOut = async (turnId: string, text: string, slugs: string[]) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const providerNames = slugs
      .map((s) => providers.find((p) => p.slug === s)?.name)
      .filter((n): n is string => Boolean(n));

    const BASE =
      (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
      "http://localhost:8000";

    let res: globalThis.Response;
    try {
      res = await fetch(`${BASE}/stream-test-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          temperature,
          max_tokens: maxTokens,
          models: [model],
          providers: providerNames,
          ...(systemPrompt.trim() && { system_prompt: systemPrompt.trim() }),
        }),
        signal: ctrl.signal,
      });
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "assistant" && m.turnId === turnId
            ? {
                ...m,
                responses: m.responses.map((r) =>
                  r.status !== "cancelled" ? { ...r, status: "failed", error: msg } : r,
                ),
              }
            : m,
        ),
      );
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(dataStr) as Record<string, unknown>;
          } catch {
            continue;
          }
          const pName = event.provider as string;
          const slug = providers.find((p) => p.name === pName)?.slug;
          if (!slug || !slugs.includes(slug)) continue;

          if (event.__start__) {
            setMessages((prev) =>
              updateResponse(prev, turnId, slug, (r) =>
                r.status === "cancelled" ? r : { ...r, status: "running" },
              ),
            );
          } else if (event.__error__) {
            setMessages((prev) =>
              updateResponse(prev, turnId, slug, (r) =>
                r.status === "cancelled"
                  ? r
                  : { ...r, status: "failed", error: event.error as string },
              ),
            );
          } else {
            const prov = providers.find((p) => p.slug === slug);
            const inTok = event.prompt_tokens as number | undefined;
            const outTok = event.output_tokens as number | undefined;
            // Use per-model listed price (with discount) for the model actually being tested
            const mp = prov?.modelPricing[model];
            const cost =
              mp && inTok != null && outTok != null
                ? (inTok * mp.listedIn) / 1e6 + (outTok * mp.listedOut) / 1e6
                : null;
            setMessages((prev) =>
              updateResponse(prev, turnId, slug, (r) =>
                r.status === "cancelled"
                  ? r
                  : {
                      ...r,
                      status: "completed",
                      content: (event.output as string) || "",
                      inputTokens: inTok,
                      outputTokens: outTok,
                      ttft:
                        (event.ttft_ms as number | null) != null
                          ? (event.ttft_ms as number) / 1000
                          : undefined,
                      latency:
                        (event.e2e_ms as number | null) != null
                          ? (event.e2e_ms as number) / 1000
                          : undefined,
                      cost,
                    },
              ),
            );
          }
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") return;
    } finally {
      // any provider that never got a response (unsupported combo) → mark failed
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "assistant" && m.turnId === turnId
            ? {
                ...m,
                responses: m.responses.map((r) =>
                  r.status === "pending" || r.status === "running"
                    ? { ...r, status: "failed", error: "No response from provider" }
                    : r,
                ),
              }
            : m,
        ),
      );
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  const submit = () => {
    const text = compose.trim();
    if (!text || inFlight || activeProviders.length === 0) return;
    const turnId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const userMsg: UserMessage = { id: `u_${turnId}`, role: "user", ts: Date.now(), content: text };
    const assistantMsg: AssistantMessage = {
      id: `a_${turnId}`,
      role: "assistant",
      ts: Date.now(),
      turnId,
      responses: activeProviders.map((slug) => ({ slug, status: "pending", thumb: null })),
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setCompose("");
    fanOut(turnId, text, activeProviders);
  };

  const retry = (turnId: string, slug: string) => {
    const aIdx = messages.findIndex((m) => m.role === "assistant" && m.turnId === turnId);
    if (aIdx < 1) return;
    const userText = (messages[aIdx - 1] as UserMessage)?.content || "";
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "assistant" && m.turnId === turnId
          ? {
              ...m,
              responses: m.responses.map((r) =>
                r.slug === slug ? { slug, status: "pending", thumb: null } : r,
              ),
            }
          : m,
      ),
    );
    fanOut(turnId, userText, [slug]);
  };

  const setThumb = (turnId: string, slug: string, thumb: "up" | "down") => {
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "assistant" && m.turnId === turnId
          ? {
              ...m,
              responses: m.responses.map((r) =>
                r.slug === slug ? { ...r, thumb: r.thumb === thumb ? null : thumb } : r,
              ),
            }
          : m,
      ),
    );
  };

  const resetChat = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setShowResetConfirm(false);
    setEditingId(null);
    setEditDraft("");
    setTimeout(() => composeRef.current?.focus(), 50);
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages((prev) =>
      prev.map((m) =>
        m.role !== "assistant"
          ? m
          : {
              ...m,
              responses: m.responses.map((r) =>
                r.status === "pending" || r.status === "running"
                  ? { ...r, status: "cancelled" as const, error: "Cancelled" }
                  : r,
              ),
            },
      ),
    );
  };

  const regenerateTurn = (targetTurnId: string) => {
    if (inFlight) return;
    const aIdx = messages.findIndex(
      (m) => m.role === "assistant" && m.turnId === targetTurnId,
    );
    if (aIdx < 1) return;
    const userText = (messages[aIdx - 1] as UserMessage)?.content || "";
    if (!userText) return;
    abortRef.current?.abort();
    abortRef.current = null;
    const turnId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setMessages((prev) => {
      const truncated = prev.slice(0, aIdx + 1);
      return truncated.map((m, i) =>
        i === aIdx
          ? {
              ...(m as AssistantMessage),
              ts: Date.now(),
              turnId,
              responses: activeProviders.map((slug) => ({ slug, status: "pending" as const, thumb: null })),
            }
          : m,
      );
    });
    fanOut(turnId, userText, activeProviders);
  };

  const startEdit = (msg: UserMessage) => {
    if (inFlight) return;
    setEditingId(msg.id);
    setEditDraft(msg.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const resubmitEdit = () => {
    const text = editDraft.trim();
    if (!text) return;
    const idx = messages.findIndex((m) => m.id === editingId);
    if (idx < 0) return;
    abortRef.current?.abort();
    abortRef.current = null;
    const truncated = messages.slice(0, idx);
    const turnId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const userMsg: UserMessage = { id: `u_${turnId}`, role: "user", ts: Date.now(), content: text };
    const assistantMsg: AssistantMessage = {
      id: `a_${turnId}`,
      role: "assistant",
      ts: Date.now(),
      turnId,
      responses: activeProviders.map((slug) => ({ slug, status: "pending", thumb: null })),
    };
    setMessages([...truncated, userMsg, assistantMsg]);
    setEditingId(null);
    setEditDraft("");
    fanOut(turnId, text, activeProviders);
  };

  // Cmd+Enter → submit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose, activeProviders, inFlight]);

  const turnCount = useMemo(() => messages.filter((m) => m.role === "user").length, [messages]);
  const modelDisplay = models.find((m) => m.id === model)?.display || model;

  return (
    <Fragment>
      {/* ── TOP BAR ──────────────────────────────────────────────────────── */}
      <section className="sticky top-16 z-30 border-b border-ink-600 bg-ink/85 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <div className="shrink-0">
              <div className="micro text-smoke">{t("run.tool")}</div>
              <div className="text-bone tracking-tight text-[14px] -mt-0.5">
                {t("run.chatTitle")}
              </div>
            </div>
            <div className="h-8 w-px bg-ink-600 hidden sm:block shrink-0" />
            <div className="shrink-0">
              <ModelDropdown value={model} onChange={setModel} disabled={inFlight} />
            </div>
            <div className="shrink-0">
              <button
                onClick={() => setShowPickerModal(true)}
                disabled={inFlight}
                className="px-3 py-1.5 text-[12px] border border-ink-500 hover:border-bone text-bone inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <span className="micro text-smoke">{t("run.topbarProvidersLabel")}</span>
                <span className="flex -space-x-1">
                  {activeProviders.slice(0, 4).map((slug) => (
                    <span key={slug} className="ring-1 ring-ink-800 inline-block leading-none">
                      <ProviderMark slug={slug} size={14} />
                    </span>
                  ))}
                  {activeProviders.length > 4 && (
                    <span className="w-3.5 h-3.5 ring-1 ring-ink-800 bg-ink-700 flex items-center justify-center text-[8px] num text-ash">
                      +{activeProviders.length - 4}
                    </span>
                  )}
                </span>
                <span className="num">{activeProviders.length}</span>
                <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-ash">
                  <path d="M3 5l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.25" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowParams(true)}
              className="text-smoke hover:text-bone p-2 transition-colors"
              title={t("run.paramsLabel")}
            >
              <IconSliders className="w-4 h-4" />
            </button>
            <button
              onClick={() => (messages.length === 0 ? null : setShowResetConfirm(true))}
              disabled={messages.length === 0}
              className="px-3 py-1.5 text-[12px] border border-ink-500 hover:border-bone/40 text-ash hover:text-bone inline-flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <I.refresh className="w-3.5 h-3.5" /> {t("run.newChat")}
            </button>
          </div>
        </div>
      </section>

      {/* ── BODY ─────────────────────────────────────────────────────────── */}
      {messages.length === 0 ? (
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
          <EmptyChatHero
            onPick={(p) => {
              setCompose(p);
              composeRef.current?.focus();
            }}
            activeProviders={activeProviders}
            providers={providers}
            composeNode={
              <ComposeBox
                value={compose}
                onChange={setCompose}
                onSubmit={submit}
                onStop={stop}
                inFlight={inFlight}
                disabled={activeProviders.length === 0}
                disabledReason={activeProviders.length === 0 ? t("run.composeNoProviders") : null}
                inputRef={composeRef}
                providerCount={activeProviders.length}
                t={t}
              />
            }
            t={t}
          />
        </div>
      ) : (
        <Fragment>
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-32">
            <MessageList
              messages={messages}
              onThumb={setThumb}
              onRetry={retry}
              onRegenerate={regenerateTurn}
              canRegenerate={!inFlight}
              editingId={editingId}
              editDraft={editDraft}
              onEditDraftChange={setEditDraft}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onSubmitEdit={resubmitEdit}
              canEdit={!inFlight}
              latestUserAnchorRef={latestUserAnchorRef}
              providers={providers}
              t={t}
              toast={toast}
            />
            <div ref={threadBottomRef} />
          </div>
          {/* Fixed bottom compose */}
          <div className="fixed bottom-0 left-0 right-0 z-20 bg-ink/95 backdrop-blur-md border-t border-ink-600">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3">
              <ComposeBox
                value={compose}
                onChange={setCompose}
                onSubmit={submit}
                onStop={stop}
                inFlight={inFlight}
                disabled={activeProviders.length === 0}
                disabledReason={activeProviders.length === 0 ? t("run.composeNoProviders") : null}
                inputRef={composeRef}
                providerCount={activeProviders.length}
                t={t}
              />
            </div>
          </div>
        </Fragment>
      )}

      {/* ── NEW CHAT CONFIRM MODAL ────────────────────────────────────────── */}
      {showResetConfirm && (
        <Modal onClose={() => setShowResetConfirm(false)} size="md">
          <h3 className="serif text-2xl tracking-editorial mb-3">
            {t("run.newChatConfirmTitle")}
          </h3>
          <p className="text-[13px] text-ash leading-relaxed mb-6">
            {t("run.newChatConfirmBody", { n: turnCount })}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowResetConfirm(false)}
              className="btn-ghost px-4 py-2 text-[12px]"
            >
              {t("run.newChatConfirmKeep")}
            </button>
            <button onClick={resetChat} className="btn-brand px-4 py-2 text-[12px]">
              {t("run.newChatConfirmReset")}
            </button>
          </div>
        </Modal>
      )}

      {/* ── PARAMS MODAL ─────────────────────────────────────────────────── */}
      {showParams && (
        <Modal onClose={() => setShowParams(false)} size="md">
          <h3 className="serif text-2xl tracking-editorial mb-2">
            {t("run.paramsModalTitle")}
          </h3>
          <p className="micro text-smoke mb-6">{t("run.paramsChangesHint")}</p>
          <div className="space-y-6">
            <div>
              <div className="micro text-smoke mb-2">{t("run.temperature")}</div>
              <div className="grid grid-cols-[1fr_56px] items-center gap-3">
                <RangeInput
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={setTemperature}
                />
                <span className="num text-bone text-right">{temperature.toFixed(1)}</span>
              </div>
            </div>
            <div>
              <div className="micro text-smoke mb-2">{t("run.maxTokens")}</div>
              <div className="grid grid-cols-[1fr_56px] items-center gap-3">
                <RangeInput
                  min={128}
                  max={4096}
                  step={128}
                  value={maxTokens}
                  onChange={setMaxTokens}
                />
                <span className="num text-bone text-right">{maxTokens}</span>
              </div>
            </div>
            <div>
              <div className="micro text-smoke mb-2">{t("run.systemPromptLabel")}</div>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                placeholder={t("run.systemPromptPlaceholder")}
                className="w-full bg-ink-800 border border-ink-500 focus:border-brand/60 outline-none p-3 text-[13px] resize-none text-bone leading-relaxed"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* ── PROVIDERS PICKER MODAL ────────────────────────────────────────── */}
      {showPickerModal && (() => {
        const supported = providers.filter((p) => supportedSlugs.has(p.slug));
        const unsupported = providers.filter((p) => !supportedSlugs.has(p.slug));

        const renderRow = (p: (typeof providers)[0]) => {
          const on = activeProviders.includes(p.slug);
          const isSupp = supportedSlugs.has(p.slug);
          return (
            <button
              key={p.slug}
              onClick={() => {
                if (!isSupp) return;
                if (on) {
                  if (activeProviders.length === 1) return;
                  setActiveProviders(activeProviders.filter((x) => x !== p.slug));
                } else if (activeProviders.length < 5) {
                  setActiveProviders([...activeProviders, p.slug]);
                } else {
                  toast.show(t("run.max5Providers"));
                }
              }}
              disabled={!isSupp}
              title={
                !isSupp
                  ? t("run.providersUnsupportedByModel", { model: modelDisplay })
                  : ""
              }
              className={cx(
                "w-full flex items-center gap-3 px-3 py-2 border transition-colors text-left",
                on ? "border-brand/60 bg-brand/5" : "border-ink-600 hover:border-bone/30",
                !isSupp && "opacity-50 cursor-not-allowed",
              )}
            >
              <span className={cx("check", on && "on")}>
                {on && <I.check className="w-2.5 h-2.5 text-ink" />}
              </span>
              <ProviderMark slug={p.slug} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-bone truncate">{p.name}</div>
                <div className="micro text-smoke">{p.type}</div>
              </div>
              {isSupp ? (
                <TrustBadge score={p.trust} />
              ) : (
                <span className="text-[11px] text-amber italic shrink-0">
                  {t("run.providersUnsupportedByModel", { model: modelDisplay })}
                </span>
              )}
            </button>
          );
        };

        return (
          <Modal onClose={() => setShowPickerModal(false)} size="md">
            <h3 className="serif text-2xl tracking-editorial mb-2">
              {t("run.providersPickerLabel")}
            </h3>
            <p className="micro text-smoke mb-2">{t("run.providersChangesHint")}</p>
            {unsupported.length > 0 && (
              <p className="text-[12px] text-amber mb-4 flex items-start gap-1.5 leading-relaxed">
                <I.info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  {t("run.providersFilterHint", {
                    n: unsupported.length,
                    model: modelDisplay,
                  })}
                </span>
              </p>
            )}
            <div className="space-y-1">{supported.map(renderRow)}</div>
            {unsupported.length > 0 && (
              <Fragment>
                <div className="mt-4 mb-2 micro text-smoke">
                  {t("run.providersUnsupportedSection")}
                </div>
                <div className="space-y-1">{unsupported.map(renderRow)}</div>
              </Fragment>
            )}
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setShowPickerModal(false)}
                className="btn-brand px-4 py-2 text-[12px]"
              >
                {t("run.providersClose")}
              </button>
            </div>
          </Modal>
        );
      })()}
    </Fragment>
  );
}

// ─── EmptyChatHero ────────────────────────────────────────────────────────────

interface EmptyChatHeroProps {
  onPick: (prompt: string) => void;
  activeProviders: string[];
  providers: { slug: string; name: string }[];
  composeNode: React.ReactNode;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function EmptyChatHero({
  onPick,
  activeProviders,
  providers,
  composeNode,
  t,
}: EmptyChatHeroProps) {
  return (
    <div className="min-h-[calc(100vh-180px)] flex items-center justify-center py-12">
      <div className="w-full max-w-3xl">
        <h2 className="serif text-3xl sm:text-4xl lg:text-5xl tracking-editorial text-center mb-3">
          {t("run.emptyHeroTitle")}
        </h2>
        {activeProviders.length > 0 ? (
          <div className="flex items-center justify-center gap-2 flex-wrap text-[12px] text-ash mb-8">
            <span className="text-smoke">{t("run.emptyDestinationLabel")}</span>
            {activeProviders.map((slug, i) => {
              const p = providers.find((x) => x.slug === slug);
              if (!p) return null;
              return (
                <Fragment key={slug}>
                  <span className="inline-flex items-center gap-1.5">
                    <ProviderMark slug={slug} size={16} />
                    <span className="text-bone">{p.name}</span>
                  </span>
                  {i < activeProviders.length - 1 && <span className="text-smoke">·</span>}
                </Fragment>
              );
            })}
          </div>
        ) : (
          <p className="text-[12px] text-amber text-center mb-8">
            {t("run.composeNoProviders")}
          </p>
        )}
        {composeNode}
        <div className="mt-8 flex flex-wrap gap-1.5 justify-center">
          {BENCHMARK_TEMPLATES.map((tpl) => {
            return (
              <button
                key={tpl.id}
                onClick={() => onPick(t("run.tplPrompts." + tpl.id))}
                className="px-3 py-1.5 text-[12px] border border-ink-500 hover:border-brand hover:text-brand text-ash transition-colors"
              >
                {t("run.tpl" + tpl.id.charAt(0).toUpperCase() + tpl.id.slice(1))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── MessageList ──────────────────────────────────────────────────────────────

interface MessageListProps {
  messages: Message[];
  onThumb: (turnId: string, slug: string, thumb: "up" | "down") => void;
  onRetry: (turnId: string, slug: string) => void;
  onRegenerate: (turnId: string) => void;
  canRegenerate: boolean;
  editingId: string | null;
  editDraft: string;
  onEditDraftChange: (v: string) => void;
  onStartEdit: (msg: UserMessage) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  canEdit: boolean;
  latestUserAnchorRef: React.RefObject<HTMLDivElement | null>;
  providers: { slug: string; name: string; trust: number; latency: number; ttft: number }[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  toast: { show: (msg: string) => void };
}

function MessageList({
  messages,
  onThumb,
  onRetry,
  onRegenerate,
  canRegenerate,
  editingId,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  canEdit,
  latestUserAnchorRef,
  providers,
  t,
  toast,
}: MessageListProps) {
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);

  const lastUserId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].id;
    }
    return null;
  }, [messages]);

  return (
    <div className="space-y-6">
      {messages.map((m) =>
        m.role === "user" ? (
          <UserBubble
            key={m.id}
            msg={m}
            isLast={m.id === lastUserId}
            canEdit={canEdit}
            isEditing={editingId === m.id}
            editDraft={editDraft}
            onEditDraftChange={onEditDraftChange}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onSubmitEdit={onSubmitEdit}
            anchorRef={m.id === lastUserId ? latestUserAnchorRef : null}
            t={t}
          />
        ) : (
          <AssistantRow
            key={m.id}
            row={m as AssistantMessage}
            onThumb={onThumb}
            onRetry={onRetry}
            isLast={m.id === lastAssistantId}
            onRegenerate={onRegenerate}
            canRegenerate={canRegenerate}
            providers={providers}
            t={t}
            toast={toast}
          />
        ),
      )}
      {messages.length > 0 && (
        <div aria-hidden="true" style={{ minHeight: "calc(100vh - 320px)" }} />
      )}
    </div>
  );
}

// ─── UserBubble ───────────────────────────────────────────────────────────────

interface UserBubbleProps {
  msg: UserMessage;
  isLast: boolean;
  canEdit: boolean;
  isEditing: boolean;
  editDraft: string;
  onEditDraftChange: (v: string) => void;
  onStartEdit: (msg: UserMessage) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null> | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function UserBubble({
  msg,
  isLast,
  canEdit,
  isEditing,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  anchorRef,
  t,
}: UserBubbleProps) {
  const time = new Date(msg.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const showEditAffordance = canEdit && !isEditing;
  const scrollPadStyle = { scrollMarginTop: "140px" };

  if (isEditing) {
    return (
      <div ref={anchorRef} style={scrollPadStyle} className="flex justify-end">
        <div className="w-full max-w-[90%] sm:max-w-[80%] md:max-w-[70%]">
          <textarea
            value={editDraft}
            onChange={(e) => onEditDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                onSubmitEdit();
              }
              if (e.key === "Escape") onCancelEdit();
            }}
            autoFocus
            rows={3}
            className="w-full bg-ink-800 border border-brand/60 outline-none p-3 text-[14px] resize-y text-bone leading-relaxed"
            style={{ minHeight: 72 }}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button onClick={onCancelEdit} className="btn-ghost px-3 py-1.5 text-[12px]">
              {t("run.editCancel")}
            </button>
            <button
              onClick={onSubmitEdit}
              disabled={!editDraft.trim()}
              className="btn-brand px-3 py-1.5 text-[12px] inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <I.refresh className="w-3 h-3" /> {t("run.editResubmit")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={anchorRef} style={scrollPadStyle} className="flex justify-end group">
      <div className="max-w-[90%] sm:max-w-[70%] md:max-w-[60%]">
        <div className="micro text-smoke mb-1 text-right flex items-center justify-end gap-2">
          {showEditAffordance && (
            <button
              onClick={() => onStartEdit(msg)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-smoke hover:text-bone inline-flex items-center gap-1"
              title={t("run.editBtn")}
            >
              <I.refresh className="w-3 h-3" />
              <span className="micro">{t("run.editBtn")}</span>
            </button>
          )}
          <span>
            {t("run.youLabel")} · {time}
          </span>
        </div>
        <div className="bg-ink-700/60 border border-ink-500 px-4 py-2.5 text-bone text-[14px] leading-relaxed whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    </div>
  );
}

// ─── AssistantRow ─────────────────────────────────────────────────────────────

interface AssistantRowProps {
  row: AssistantMessage;
  onThumb: (turnId: string, slug: string, thumb: "up" | "down") => void;
  onRetry: (turnId: string, slug: string) => void;
  isLast: boolean;
  onRegenerate: (turnId: string) => void;
  canRegenerate: boolean;
  providers: { slug: string; name: string; trust: number; latency: number; ttft: number }[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  toast: { show: (msg: string) => void };
}

function AssistantRow({
  row,
  onThumb,
  onRetry,
  isLast,
  onRegenerate,
  canRegenerate,
  providers,
  t,
  toast,
}: AssistantRowProps) {
  const n = row.responses.length;
  const gridCls =
    n === 1
      ? "grid-cols-1"
      : n === 2
        ? "grid-cols-1 md:grid-cols-2"
        : n === 3
          ? "grid-cols-1 md:grid-cols-3"
          : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
  const allDone = row.responses.every(
    (r) => r.status === "completed" || r.status === "failed" || r.status === "cancelled",
  );
  const showRegenerate = canRegenerate && allDone;

  return (
    <div>
      <div className={cx("grid gap-3", gridCls)}>
        {row.responses.map((r) => (
          <ResponseCard
            key={r.slug}
            r={r}
            turnId={row.turnId}
            onThumb={onThumb}
            onRetry={onRetry}
            providers={providers}
            t={t}
            toast={toast}
          />
        ))}
      </div>
      {showRegenerate && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => onRegenerate(row.turnId)}
            className="px-3 py-1.5 text-[11px] border border-ink-500 hover:border-bone/40 text-ash hover:text-bone inline-flex items-center gap-1.5 transition-colors"
            title={isLast ? t("run.regenerateBtn") : t("run.regenerateBtnOlder")}
          >
            <I.refresh className="w-3 h-3" /> {t("run.regenerateBtn")}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MarkdownBody ─────────────────────────────────────────────────────────────

function MarkdownBody({ text }: { text: string }) {
  const html = useMemo(() => {
    if (!text) return "";
    if (typeof window === "undefined") return null;
    // Use `marked` if available as a global (CDN), otherwise fall back to plain text
    const w = window as unknown as { marked?: { parse: (t: string, opts?: object) => string } };
    if (!w.marked) return null;
    try {
      return w.marked.parse(text, { breaks: true, gfm: true });
    } catch {
      return null;
    }
  }, [text]);

  if (html === null) {
    return (
      <pre className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-bone font-mono">
        {text}
      </pre>
    );
  }
  return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── ResponseCard ─────────────────────────────────────────────────────────────

interface ResponseCardProps {
  r: Response;
  turnId: string;
  onThumb: (turnId: string, slug: string, thumb: "up" | "down") => void;
  onRetry: (turnId: string, slug: string) => void;
  providers: { slug: string; name: string; trust: number }[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  toast: { show: (msg: string) => void };
}

function ResponseCard({ r, turnId, onThumb, onRetry, providers, t, toast }: ResponseCardProps) {
  const p = providers.find((x) => x.slug === r.slug);
  const responseText = r.status === "completed" ? r.content || "" : "";
  const stream = useStreamingText(responseText, 14);

  const phaseLabel: Record<Response["status"], string> = {
    pending: t("run.phaseQueued"),
    running: t("run.phaseStreaming"),
    completed: t("run.phaseComplete"),
    failed: t("run.phaseFailed"),
    cancelled: t("run.phaseCancelled"),
  };

  const onCopy = () => {
    if (!r.content) return;
    copyToClipboard(r.content);
    toast.show(t("run.copiedResponse", { name: p?.name ?? r.slug }));
  };

  if (!p) return null;

  return (
    <div className="card p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-ink-600">
        <div className="flex items-center gap-2.5 min-w-0">
          <ProviderMark slug={r.slug} size={28} />
          <div className="min-w-0">
            <div className="text-[13px] text-bone truncate">{p.name}</div>
            <div className="micro text-smoke flex items-center gap-1.5">
              {r.status === "running" && (
                <span className="w-1.5 h-1.5 bg-brand rounded-full pulse-dot" />
              )}
              {r.status === "completed" && stream.done && (
                <span className="w-1.5 h-1.5 bg-brand rounded-full" />
              )}
              {r.status === "completed" && !stream.done && (
                <span className="w-1.5 h-1.5 bg-brand rounded-full pulse-dot" />
              )}
              {r.status === "failed" && (
                <span className="w-1.5 h-1.5 bg-coral rounded-full" />
              )}
              {(r.status === "cancelled" || r.status === "pending") && (
                <span className="w-1.5 h-1.5 bg-smoke rounded-full" />
              )}
              <span
                className={cx(
                  r.status === "failed"
                    ? "text-coral"
                    : r.status === "cancelled"
                      ? "text-smoke"
                      : r.status === "completed"
                        ? "text-ash"
                        : "text-brand",
                )}
              >
                {r.status === "completed" && !stream.done
                  ? t("run.phaseStreaming")
                  : phaseLabel[r.status]}
              </span>
            </div>
          </div>
        </div>
        <TrustBadge score={p.trust} />
      </div>

      {/* Body */}
      <div className="py-3 flex-1 min-h-[140px]">
        {r.status === "pending" && (
          <div className="text-[12px] text-smoke">{t("run.phaseQueued")}…</div>
        )}
        {r.status === "running" && (
          <div className="space-y-2">
            <div className="shimmer h-2.5 w-3/4" />
            <div className="shimmer h-2.5 w-5/6" />
            <div className="shimmer h-2.5 w-1/2" />
          </div>
        )}
        {r.status === "cancelled" && (
          <div className="text-smoke text-[12px]">
            <I.x className="w-3.5 h-3.5 inline mr-1" />
            {t("run.phaseCancelled")}
          </div>
        )}
        {r.status === "failed" && (
          <div className="text-coral text-[12px]">
            <I.x className="w-3.5 h-3.5 inline mr-1" />
            {t("run.failedPrefix")}
            {r.error}
          </div>
        )}
        {r.status === "completed" &&
          (stream.done ? (
            <MarkdownBody text={stream.shown} />
          ) : (
            <div className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-bone">
              {stream.shown}
              <span className="inline-block w-1.5 h-3.5 bg-brand ml-0.5 align-middle pulse-dot" />
            </div>
          ))}
      </div>

      {/* Footer */}
      <div className="mt-2 pt-3 border-t border-ink-600 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 text-[11px] num text-ash overflow-x-auto no-scroll-x">
          {r.ttft != null && (
            <span title={t("run.colTtft")}>{(r.ttft * 1000) | 0}ms</span>
          )}
          {r.latency != null && (
            <span title={t("run.colLatency")}>{r.latency.toFixed(2)}s</span>
          )}
          {r.cost != null && (
            <span title={t("run.colCost")}>{fmtUSD(r.cost, 4)}</span>
          )}
          {r.outputTokens != null && (
            <span title={t("run.colTokens")}>
              {r.inputTokens}/{r.outputTokens}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {r.status === "completed" && (
            <Fragment>
              <button
                onClick={() => onThumb(turnId, r.slug, "up")}
                title={t("run.thumbUpTip")}
                className={cx(
                  "p-1.5 transition-colors",
                  r.thumb === "up" ? "text-brand" : "text-smoke hover:text-bone",
                )}
              >
                <IconThumbUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onThumb(turnId, r.slug, "down")}
                title={t("run.thumbDownTip")}
                className={cx(
                  "p-1.5 transition-colors",
                  r.thumb === "down" ? "text-coral" : "text-smoke hover:text-bone",
                )}
              >
                <IconThumbDown className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onCopy}
                title={t("run.copyResponse")}
                className="text-smoke hover:text-bone p-1.5 transition-colors"
              >
                <I.copy className="w-3.5 h-3.5" />
              </button>
            </Fragment>
          )}
          {r.status === "failed" && (
            <button
              onClick={() => onRetry(turnId, r.slug)}
              title={t("run.retryThis")}
              className="px-2 py-1 text-[11px] border border-ink-600 hover:border-bone/40 text-ash hover:text-bone inline-flex items-center gap-1 transition-colors"
            >
              <I.refresh className="w-3 h-3" /> {t("run.retry")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ComposeBox ───────────────────────────────────────────────────────────────

interface ComposeBoxProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  inFlight: boolean;
  disabled: boolean;
  disabledReason: string | null;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  providerCount: number;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function ComposeBox({
  value,
  onChange,
  onSubmit,
  onStop,
  inFlight,
  disabled,
  disabledReason,
  inputRef,
  providerCount,
  t,
}: ComposeBoxProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = inputRef || localRef;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [value, textareaRef]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!inFlight) onSubmit();
    }
  };

  const placeholder = t("run.composePlaceholder", {
    n: providerCount,
    s: providerCount === 1 ? "" : "s",
  });

  const canSend = !disabled && !inFlight && value.trim().length > 0;

  return (
    <div>
      <div
        className={cx(
          "relative bg-ink-800 border transition-colors",
          disabled ? "border-ink-600" : "border-ink-500 focus-within:border-brand/60",
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-transparent outline-none px-4 py-3 pr-16 text-[13px] resize-none text-bone leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ minHeight: 52, maxHeight: 180 }}
        />
        {inFlight ? (
          <button
            onClick={onStop}
            aria-label={t("run.composeStop")}
            title={t("run.composeStop")}
            className="absolute bottom-2 right-2 w-9 h-9 flex items-center justify-center bg-coral text-ink transition-colors hover:opacity-90"
          >
            <span className="w-3 h-3 bg-ink block" />
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!canSend}
            aria-label={t("run.composeSend")}
            className={cx(
              "absolute bottom-2 right-2 w-9 h-9 flex items-center justify-center transition-colors",
              canSend ? "btn-brand" : "bg-ink-700 text-smoke cursor-not-allowed",
            )}
          >
            <IconSend className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="mt-1.5 px-0.5 min-h-[14px] flex items-center justify-between gap-2">
        <span className="micro text-smoke">
          {disabledReason ||
            (inFlight ? t("run.composeInFlightHint") : t("run.composeHotkeyHint"))}
        </span>
      </div>
    </div>
  );
}
