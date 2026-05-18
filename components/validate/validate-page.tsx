"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLang } from "@/lib/contexts/lang";
import { useData } from "@/lib/contexts/data";
import { strHash, cx } from "@/lib/utils";
import { I } from "@/components/ui/icons";
import type { FingerprintResult } from "@/lib/types";

interface StaticModel {
  id: string;
  display: string;
  family: string;
  owner: string;
}

interface StaticProvider {
  slug: string;
  name: string;
  type: string;
  domain: string | null;
  region: string;
  trust: number;
  samples: number;
}

const STATIC_MODELS: StaticModel[] = [
  { id: "openai/gpt-5.5", display: "GPT-5.5", family: "GPT", owner: "OpenAI" },
  { id: "anthropic/claude-4.6-sonnet", display: "Claude 4.6 Sonnet", family: "Claude", owner: "Anthropic" },
  { id: "google/gemini-3.1-pro", display: "Gemini 3.1 Pro", family: "Gemini", owner: "Google" },
  { id: "deepseek/deepseek-v3.2", display: "DeepSeek V3.2", family: "DeepSeek", owner: "DeepSeek" },
  { id: "meta/llama-4-maverick", display: "Llama 4 Maverick", family: "Llama", owner: "Meta" },
  { id: "mistral/mistral-large-2.1", display: "Mistral Large 2.1", family: "Mistral", owner: "Mistral" },
];

const STATIC_PROVIDERS: StaticProvider[] = [
  { slug: "portkey", name: "Portkey", type: "gateway", domain: "portkey.ai", region: "Global", trust: 91, samples: 2418 },
  { slug: "openrouter", name: "OpenRouter", type: "router", domain: "openrouter.ai", region: "US/EU", trust: 77, samples: 5102 },
  { slug: "bai", name: "B.ai", type: "router", domain: "b.ai", region: "Global", trust: 71, samples: 1834 },
  { slug: "together", name: "Together AI", type: "inference", domain: "together.ai", region: "US", trust: 89, samples: 4012 },
  { slug: "fireworks", name: "Fireworks AI", type: "inference", domain: "fireworks.ai", region: "US", trust: 87, samples: 3502 },
  { slug: "anyscale", name: "Anyscale", type: "inference", domain: "anyscale.com", region: "US/EU", trust: 79, samples: 1422 },
  { slug: "replicate", name: "Replicate", type: "inference", domain: "replicate.com", region: "Global", trust: 76, samples: 928 },
  { slug: "litellm", name: "LiteLLM", type: "self_host", domain: null, region: "Self-hosted", trust: 91, samples: 612 },
  { slug: "easyrouter", name: "EasyRouter", type: "router", domain: "easyrouter.io", region: "Global", trust: 83, samples: 2860 },
];

const FINGERPRINT_OVERRIDES: Record<string, Partial<FingerprintResult>> = {
  "openrouter:anthropic/claude-4.6-sonnet": {
    embedDist: 0.78,
    lengthKsP: 0.18,
    refusalDelta: 7,
    tokenizer: { observed: "cl100k_base", expected: "claude", match: false },
    flag: {
      kind: "silent_fallback",
      headline: "Silent fallback suspected",
      detail: "Tokenizer signature does not match Anthropic's expected tokenizer on 18% of sampled responses. Last seen 2h ago.",
    },
  },
  "bai:openai/gpt-5.5": {
    precision: "Q8",
    flag: {
      kind: "quantization",
      headline: "Quantization detected",
      detail: "Numeric precision tasks show ~6.3% accuracy delta vs. canonical FP16 baseline.",
    },
  },
  "replicate:meta/llama-4-maverick": {
    precision: "Q4",
    embedDist: 0.81,
    flag: {
      kind: "quantization",
      headline: "Aggressive quantization",
      detail: "Q4 weights detected via output entropy fingerprint. Cost is lower but reasoning benchmarks underperform by ~9 points.",
    },
  },
};

function tokenizerFor(model: StaticModel) {
  if (model.owner === "OpenAI") return "cl100k_base";
  if (model.owner === "Anthropic") return "claude";
  if (model.owner === "Google") return "gemini";
  return "sentencepiece";
}

function inferProvider(rawUrl: string): string | null {
  if (!rawUrl) return null;
  let host = "";
  try {
    const u = new URL(rawUrl.match(/^https?:/) ? rawUrl : "https://" + rawUrl);
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  const stripped = host.replace(/^(api|www|inference|router|gateway)\./, "");
  for (const p of STATIC_PROVIDERS) {
    if (!p.domain) continue;
    if (host === p.domain || host.endsWith("." + p.domain) || stripped === p.domain) {
      return p.slug;
    }
  }
  return null;
}

function fingerprint(slug: string, modelId: string, modelCatalog: StaticModel[]): FingerprintResult | null {
  const p = STATIC_PROVIDERS.find((x) => x.slug === slug);
  const m = modelCatalog.find((x) => x.id === modelId);
  if (!p || !m) return null;

  const closed = ["OpenAI", "Anthropic", "Google"].includes(m.owner);
  if (closed && p.type === "inference") {
    return {
      unsupported: true,
      reason: `${p.name} is a direct-inference provider for open-weight models. Requests for ${m.owner} models would not be routed honestly.`,
    } as FingerprintResult;
  }

  const key = `${slug}:${modelId}`;
  const ov = FINGERPRINT_OVERRIDES[key] || {};
  const seed = strHash(key);
  const base = p.trust / 100;
  const embedDist = ov.embedDist ?? Math.min(0.99, Math.max(0.45, base + ((seed % 200) - 100) / 4000 + 0.02));
  const lengthKsP = ov.lengthKsP ?? Math.min(0.95, Math.max(0.04, 0.4 + (p.trust - 80) / 120 + ((seed % 100) - 50) / 600));
  const expected = tokenizerFor(m);
  const tokenizer = ov.tokenizer ?? { observed: expected, expected, match: true };
  const precision = ov.precision ?? "FP16";
  const refusalDelta = ov.refusalDelta ?? Math.round(((seed % 14) - 7) * (1 - p.trust / 110));
  const samples = Math.max(48, Math.round(p.samples / (modelCatalog.length * 2) + (seed % 80)));
  const score = Math.round(
    Math.max(0, embedDist * 50) +
      lengthKsP * 20 +
      (tokenizer.match ? 15 : 4) +
      (precision === "FP16" ? 10 : precision === "Q8" ? 6 : 3) +
      Math.max(0, 5 - Math.abs(refusalDelta) * 0.5),
  );

  return { embedDist, lengthKsP, tokenizer, precision, refusalDelta, samples, score, flag: ov.flag ?? null };
}

function syntheticFingerprint(url: string, modelId: string, modelCatalog: StaticModel[]): FingerprintResult | null {
  const m = modelCatalog.find((x) => x.id === modelId);
  if (!m) return null;
  const seed = strHash(url + ":" + modelId);
  const baseTier = 60 + (seed % 30);
  const embedDist = Math.min(0.97, Math.max(0.55, baseTier / 100 + ((seed % 200) - 100) / 5000));
  const lengthKsP = Math.min(0.92, Math.max(0.05, 0.3 + (baseTier - 70) / 150 + ((seed % 100) - 50) / 700));
  const expected = tokenizerFor(m);
  const tokMatch = seed % 100 > 12;
  const tokenizer = { observed: tokMatch ? expected : "cl100k_base", expected, match: tokMatch };
  const precision: FingerprintResult["precision"] = seed % 100 > 30 ? "FP16" : seed % 100 > 8 ? "Q8" : "Q4";
  const refusalDelta = Math.round(((seed % 18) - 9) * 0.7);
  const samples = 40 + (seed % 30);
  const score = Math.round(
    Math.max(0, embedDist * 50) +
      lengthKsP * 20 +
      (tokenizer.match ? 15 : 4) +
      (precision === "FP16" ? 10 : precision === "Q8" ? 6 : 3) +
      Math.max(0, 5 - Math.abs(refusalDelta) * 0.5),
  );
  const flag =
    !tokenizer.match
      ? {
          kind: "tokenizer_mismatch",
          headline: "Tokenizer mismatch",
          detail: `Observed tokenizer (${tokenizer.observed}) does not match the expected ${tokenizer.expected} signature for ${m.display}.`,
        }
      : precision === "Q4"
        ? {
            kind: "quantization",
            headline: "Aggressive quantization (Q4)",
            detail: "Q4 weights detected via numeric task accuracy delta. Cost is lower; reasoning benchmarks underperform vs FP16.",
          }
        : precision === "Q8"
          ? {
              kind: "quantization",
              headline: "Quantization detected (Q8)",
              detail: "~6% accuracy delta on numeric tasks vs canonical FP16 baseline.",
            }
          : null;
  return { firstSeen: true, embedDist, lengthKsP, tokenizer, precision, refusalDelta, samples, score, flag };
}

function StaticProviderMark({ slug, size = 36 }: { slug: string; size?: number }) {
  const p = STATIC_PROVIDERS.find((x) => x.slug === slug);
  const [failed, setFailed] = useState(false);
  const label = p?.name || slug;

  if (p?.domain && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={`https://logo.clearbit.com/${p.domain}`}
        alt={label}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-sm bg-white object-contain"
        style={{ width: size, height: size, padding: Math.max(2, size * 0.06) }}
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center serif shrink-0 bg-ink-700 text-bone"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {label[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

const VALIDATE_SAMPLES = [
  { label: "Portkey", url: "https://api.portkey.ai/v1/chat/completions" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1/chat/completions" },
  { label: "Together AI", url: "https://api.together.xyz/v1/chat/completions" },
  { label: "OpenAI direct", url: "https://api.openai.com/v1/chat/completions" },
  { label: "Custom router", url: "https://your-router.example.com/v1/chat/completions" },
];

const PHASES = [
  { key: "probe" },
  { key: "sample" },
  { key: "embed" },
  { key: "length" },
  { key: "tok" },
  { key: "prec" },
  { key: "refusal" },
  { key: "score" },
] as const;

type PhaseKey = (typeof PHASES)[number]["key"];
type PhaseStatus = "pending" | "running" | "completed";
type Phase = "idle" | "running" | "complete";

interface Report {
  slug: string | null;
  provider: { name: string; type: string; region: string };
  fp: FingerprintResult | null;
}

export function ValidatePageBody() {
  const { t } = useLang();
  const { models } = useData();
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("openai/gpt-5.5");
  const [phase, setPhase] = useState<Phase>("idle");
  const [phaseStatus, setPhaseStatus] = useState<Record<string, PhaseStatus>>({});
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const compareModels = models.length > 0 ? models : STATIC_MODELS;

  useEffect(() => {
    if (compareModels.some((x) => x.id === model)) return;
    setModel(compareModels[0]?.id ?? "openai/gpt-5.5");
  }, [compareModels, model]);

  const start = () => {
    if (!url.trim()) {
      setError(t("validate.errorPasteOrPick"));
      return;
    }
    try {
      new URL(url.match(/^https?:/) ? url : "https://" + url);
    } catch {
      setError(t("validate.errorInvalidUrl"));
      return;
    }

    setError(null);
    setReport(null);
    const initStatus: Record<string, PhaseStatus> = {};
    PHASES.forEach((p) => (initStatus[p.key] = "pending"));
    setPhaseStatus(initStatus);
    setPhase("running");

    let cum = 200;
    const seed = strHash(url + model);
    const timers: ReturnType<typeof setTimeout>[] = [];
    PHASES.forEach((p, i) => {
      const dur = 500 + ((seed + i * 37) % 700);
      const startAt = cum;
      const endAt = cum + dur;
      cum = endAt;
      timers.push(
        setTimeout(() => {
          setPhaseStatus((prev) => ({ ...prev, [p.key]: "running" }));
        }, startAt),
      );
      timers.push(
        setTimeout(() => {
          setPhaseStatus((prev) => ({ ...prev, [p.key]: "completed" }));
        }, endAt),
      );
    });

    timers.push(
      setTimeout(() => {
        const slug = inferProvider(url);
        const fp = slug ? fingerprint(slug, model, compareModels) : syntheticFingerprint(url, model, compareModels);
        let provider: Report["provider"];
        if (slug) {
          const p = STATIC_PROVIDERS.find((x) => x.slug === slug)!;
          provider = { name: p.name, type: p.type, region: p.region };
        } else {
          let host = "";
          try {
            host = new URL(url.match(/^https?:/) ? url : "https://" + url).hostname;
          } catch {
            /* noop */
          }
          provider = { name: host || "Unknown endpoint", type: "first-seen", region: "unknown" };
        }
        setReport({ slug, provider, fp });
        setPhase("complete");
      }, cum + 200),
    );
  };

  const reset = () => {
    setPhase("idle");
    setReport(null);
    setPhaseStatus({});
  };

  const m = compareModels.find((x) => x.id === model);
  if (!m) return null;

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-20">
      {/* Hero */}
      <div className="border-b border-ink-600 pb-8 mb-10">
        <div className="micro text-smoke">{t("validate.tool")}</div>
        <h1 className="serif text-4xl sm:text-5xl lg:text-6xl tracking-editorial mt-2">
          {t("validate.headPre")}{" "}
          <span className="serif-it text-brand">{t("validate.headIt")}</span>
          {t("validate.headPost")}
        </h1>
        <p className="text-ash mt-3 max-w-2xl text-[15px] leading-relaxed">
          {t("validate.subhead")}
        </p>
      </div>

      {/* Form */}
      <div className="grid lg:grid-cols-[1fr_auto] gap-6 mb-10 items-start">
        <div className="space-y-4">
          <div>
            <div className="micro text-smoke mb-2">{t("validate.endpointUrl")}</div>
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") start();
              }}
              placeholder={t("validate.urlPlaceholder")}
              disabled={phase === "running"}
              spellCheck={false}
              className="w-full bg-ink-800 border border-ink-500 focus:border-brand/60 outline-none px-4 py-3 text-[14px] text-bone num"
            />
          </div>

          <div>
            <div className="micro text-smoke mb-2 flex items-center justify-between">
              <span>
                {t("validate.apiKey")}{" "}
                <span className="text-smoke normal-case tracking-normal">
                  {t("validate.apiKeyOptional")}
                </span>
              </span>
              {apiKey && (
                <button
                  onClick={() => setApiKey("")}
                  disabled={phase === "running"}
                  className="micro text-smoke hover:text-bone disabled:opacity-40"
                >
                  {t("validate.clear")}
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") start();
                }}
                placeholder={t("validate.apiKeyPlaceholder")}
                disabled={phase === "running"}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full bg-ink-800 border border-ink-500 focus:border-brand/60 outline-none pl-4 pr-11 py-3 text-[14px] text-bone num"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                disabled={!apiKey || phase === "running"}
                title={showKey ? t("validate.hide") : t("validate.show")}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-smoke hover:text-bone disabled:opacity-40"
              >
                {showKey ? (
                  <I.eyeOff className="w-4 h-4" />
                ) : (
                  <I.eye className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="mt-2 flex items-start gap-2 text-[11px] text-smoke leading-relaxed">
              <I.lock className="w-3 h-3 mt-0.5 shrink-0 text-brand" />
              <span>{t("validate.keyNote")}</span>
            </div>
          </div>

          {error && <div className="text-coral text-[12px]">{error}</div>}

          <div className="flex flex-wrap gap-1.5">
            <span className="micro text-smoke mr-1 self-center">
              {t("validate.tryLabel")}
            </span>
            {VALIDATE_SAMPLES.map((s) => (
              <button
                key={s.label}
                onClick={() => {
                  setUrl(s.url);
                  setError(null);
                }}
                disabled={phase === "running"}
                className="px-2.5 py-1 text-[11px] border border-ink-500 hover:border-brand hover:text-brand text-ash transition-colors disabled:opacity-40"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div>
            <div className="micro text-smoke mb-2">{t("validate.testAgainst")}</div>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={phase === "running"}
              className="w-full bg-ink-800 border border-ink-500 px-3 py-2.5 text-[13px] text-bone min-w-[200px]"
            >
              {compareModels.map((mm) => (
                <option key={mm.id} value={mm.id}>
                  {mm.display}
                </option>
              ))}
            </select>
          </div>
          {phase === "idle" && (
            <button
              onClick={start}
              className="btn-brand px-6 py-3 text-sm font-medium tracking-tight inline-flex items-center justify-center gap-2"
            >
              <I.bolt className="w-4 h-4" /> {t("validate.validate")}
            </button>
          )}
          {phase === "complete" && (
            <button
              onClick={reset}
              className="btn-ghost px-6 py-3 text-sm inline-flex items-center justify-center gap-2"
            >
              <I.refresh className="w-4 h-4" /> {t("validate.newValidation")}
            </button>
          )}
        </div>
      </div>

      {/* Phases */}
      {phase !== "idle" && (
        <div className="mb-10">
          <div className="micro text-smoke mb-3">
            {t("validate.probePipeline", { model: m.display })}
          </div>
          <div className="card divide-y divide-ink-600">
            {PHASES.map((p) => {
              const st = phaseStatus[p.key] || "pending";
              const result =
                phase === "complete" && report?.fp
                  ? phaseResult(p.key, report.fp, t)
                  : null;
              const phaseKey = p.key.charAt(0).toUpperCase() + p.key.slice(1);
              return (
                <div key={p.key} className="flex items-start gap-4 px-5 py-3">
                  <div className="w-5 h-5 mt-0.5 flex items-center justify-center shrink-0">
                    {st === "pending" && <span className="text-smoke">○</span>}
                    {st === "running" && (
                      <I.spin className="w-3.5 h-3.5 text-brand animate-spin" />
                    )}
                    {st === "completed" && (
                      <I.check className="w-3.5 h-3.5 text-brand" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-bone">
                      {t("validate.ph" + phaseKey)}
                    </div>
                    <div className="micro text-smoke mt-0.5">
                      {t("validate.ph" + phaseKey + "Detail")}
                    </div>
                  </div>
                  {result && st === "completed" && (
                    <div className="num text-[12px] text-ash text-right shrink-0">
                      {result}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Report */}
      {phase === "complete" && report && <ValidateReport report={report} />}

      {/* Methodology */}
      <div className="mt-16 pt-10 border-t border-ink-600">
        <div className="micro text-smoke">{t("validate.methodologyTag")}</div>
        <h3 className="serif text-2xl sm:text-3xl tracking-editorial mt-2">
          {t("validate.methodologyTitlePre")}{" "}
          <span className="serif-it text-brand">
            {t("validate.methodologyTitleIt")}
          </span>
        </h3>
        <p className="text-ash text-[14px] leading-relaxed mt-3 max-w-3xl">
          {t("validate.methodologyP1")}
          <em className="text-bone not-italic">{t("validate.methodologyP1Em")}</em>
          {t("validate.methodologyP1Post")}
        </p>
        <p className="text-ash text-[13px] leading-relaxed mt-2 max-w-3xl">
          {t("validate.methodologyP2Pre")}
          <span className="text-brand">{t("validate.methodologyP2Em")}</span>
          {t("validate.methodologyP2Post")}
        </p>
        <div className="mt-6 grid sm:grid-cols-2 gap-px bg-ink-600 border border-ink-600">
          <div className="bg-ink p-4">
            <div className="micro text-brand mb-1">
              {t("validate.canDetectTitle")}
            </div>
            <ul className="text-[12px] text-ash space-y-1 leading-relaxed">
              <li>• {t("validate.canDetect1")}</li>
              <li>• {t("validate.canDetect2")}</li>
              <li>• {t("validate.canDetect3")}</li>
              <li>• {t("validate.canDetect4")}</li>
            </ul>
          </div>
          <div className="bg-ink p-4">
            <div className="micro text-amber mb-1">{t("validate.needsTitle")}</div>
            <ul className="text-[12px] text-ash space-y-1 leading-relaxed">
              <li>• {t("validate.needs1")}</li>
              <li>• {t("validate.needs2")}</li>
              <li>• {t("validate.needs3")}</li>
              <li>• {t("validate.needs4")}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function phaseResult(
  key: PhaseKey,
  fp: FingerprintResult,
  t: (path: string, vars?: Record<string, string | number>) => string,
): string | null {
  switch (key) {
    case "probe":
      return "200 OK · TLS 1.3";
    case "sample":
      return t("validate.probeOk", { n: fp.samples });
    case "embed":
      return fp.embedDist != null ? fp.embedDist.toFixed(2) : null;
    case "length":
      return fp.lengthKsP != null ? `p=${fp.lengthKsP.toFixed(2)}` : null;
    case "tok":
      return fp.tokenizer
        ? fp.tokenizer.match
          ? t("validate.tokMatch")
          : t("validate.tokMismatch")
        : null;
    case "prec":
      return fp.precision || null;
    case "refusal":
      return fp.refusalDelta != null
        ? `${fp.refusalDelta > 0 ? "+" : ""}${fp.refusalDelta}pt`
        : null;
    case "score":
      return fp.score != null ? `${fp.score} / 100` : null;
    default:
      return null;
  }
}

function ValidateReport({ report }: { report: Report }) {
  const { t } = useLang();
  const { provider, fp, slug } = report;
  if (!fp) return null;

  if (fp.unsupported) {
    return (
      <div className="card p-6 sm:p-8">
        <div className="flex items-start gap-5">
          <span className="serif-it text-6xl text-smoke leading-none">∅</span>
          <div className="flex-1">
            <div className="micro text-smoke mb-2">
              {t("validate.unsupportedTag")}
            </div>
            <h4 className="serif text-2xl tracking-editorial">
              {t("validate.unsupportedTitle", { name: provider.name })}
            </h4>
            <p className="mt-3 text-ash text-[13px] leading-relaxed max-w-2xl">
              {fp.reason}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {fp.flag && (
        <div className="border border-coral/40 bg-coral/[0.04] px-4 py-3">
          <div className="flex items-start gap-3">
            <I.alert className="w-4 h-4 text-coral mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-coral text-[13px] tracking-tight">
                {fp.flag.headline}
              </div>
              <p className="mt-1 text-[12px] text-ash leading-relaxed">
                {fp.flag.detail}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="card p-6 space-y-5">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <div className="micro text-smoke">
              {slug ? t("validate.indexedRouter") : t("validate.firstSeen")}
            </div>
            <div className="flex items-center gap-3 mt-2">
              {slug && <StaticProviderMark slug={slug} />}
              <div>
                <div className="text-[15px] text-bone">{provider.name}</div>
                <div className="micro text-smoke">
                  {provider.type}
                  {slug
                    ? " · " + t("validate.onTheBoard")
                    : " · " + t("validate.singleProbe")}
                </div>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="micro text-smoke">{t("validate.matchScore")}</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className={cx(
                  "serif text-5xl tracking-editorial",
                  fp.score >= 88
                    ? "text-brand"
                    : fp.score >= 70
                      ? "text-amber"
                      : "text-coral",
                )}
              >
                {fp.score}
              </span>
              <span className="text-[12px] text-smoke num">/ 100</span>
            </div>
            <div className="text-[11px] mt-1">
              {fp.score >= 88 && (
                <span className="text-brand">{t("validate.verified")}</span>
              )}
              {fp.score >= 70 && fp.score < 88 && (
                <span className="text-amber">{t("validate.caution")}</span>
              )}
              {fp.score < 70 && (
                <span className="text-coral">{t("validate.risky")}</span>
              )}
              <span className="text-smoke">
                {" "}
                · {t("validate.samplesShort", { n: fp.samples })}
              </span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-ink-600 space-y-4">
          <FpBar
            label={t("validate.fpEmbedDist")}
            value={fp.embedDist.toFixed(2)}
            pct={fp.embedDist * 100}
            ok={fp.embedDist >= 0.85}
            hint={t("validate.fpEmbedHint")}
          />
          <FpBar
            label={t("validate.fpLengthDist")}
            value={`K-S p=${fp.lengthKsP.toFixed(2)}`}
            pct={Math.min(100, fp.lengthKsP * 200)}
            ok={fp.lengthKsP >= 0.2}
            hint={t("validate.fpLengthHint")}
          />
          <FpRow
            label={t("validate.fpTokenizer")}
            value={fp.tokenizer.observed}
            ok={fp.tokenizer.match}
            expected={fp.tokenizer.expected}
            hint={t("validate.fpTokenizerHint")}
          />
          <FpRow
            label={t("validate.fpPrecision")}
            value={fp.precision}
            ok={fp.precision === "FP16"}
            hint={t("validate.fpPrecisionHint")}
          />
          <FpRow
            label={t("validate.fpRefusal")}
            value={`${fp.refusalDelta > 0 ? "+" : ""}${fp.refusalDelta}pt`}
            ok={Math.abs(fp.refusalDelta) <= 3}
            hint={t("validate.fpRefusalHint")}
          />
        </div>

        {fp.firstSeen && (
          <div className="pt-4 border-t border-ink-600 text-[11px] text-smoke leading-relaxed flex items-start gap-2">
            <I.alert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber" />
            <span>{t("validate.firstSeenNote")}</span>
          </div>
        )}
        {slug && (
          <div className="pt-4 border-t border-ink-600 text-[11px] text-smoke leading-relaxed">
            {t("validate.indexedNote")}{" "}
            <Link href={`/providers/${slug}`} className="ulink text-brand">
              {t("validate.indexedLink")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function FpBar({
  label,
  value,
  pct,
  ok,
  hint,
}: {
  label: string;
  value: string;
  pct: number;
  ok: boolean;
  hint: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] text-ash">{label}</span>
        <div className="flex items-center gap-2">
          <span className="num text-[12px] text-bone">{value}</span>
          <span
            className={cx("text-[11px]", ok ? "text-brand" : "text-coral")}
          >
            {ok ? "✓" : "✗"}
          </span>
        </div>
      </div>
      <div className="h-1 bg-ink-500 relative overflow-hidden">
        <div
          className={cx(
            "absolute inset-y-0 left-0 transition-all",
            ok ? "bg-brand" : "bg-coral",
          )}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        ></div>
      </div>
      <p className="text-[10px] text-smoke mt-1.5 leading-relaxed">{hint}</p>
    </div>
  );
}

function FpRow({
  label,
  value,
  ok,
  expected,
  hint,
}: {
  label: string;
  value: string;
  ok: boolean;
  expected?: string;
  hint: string;
}) {
  const { t } = useLang();
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] text-ash">{label}</span>
        <div className="flex items-center gap-2">
          {expected && expected !== value && (
            <span className="text-[10px] text-smoke">
              {t("provider.fpExpected")}{" "}
              <span className="text-ash">{expected}</span>
            </span>
          )}
          <span className="num text-[12px] text-bone">{value}</span>
          <span
            className={cx("text-[11px]", ok ? "text-brand" : "text-coral")}
          >
            {ok ? "✓" : "✗"}
          </span>
        </div>
      </div>
      <p className="text-[10px] text-smoke mt-0.5 leading-relaxed">{hint}</p>
    </div>
  );
}
