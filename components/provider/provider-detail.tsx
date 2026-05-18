"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/contexts/lang";
import { useData } from "@/lib/contexts/data";
import { fingerprint, trustHistory } from "@/lib/fingerprint";
import {
  cx,
  fmtPct,
  fmtUSD,
  strHash,
  trustLabel,
  trustTone,
  sevColor,
} from "@/lib/utils";
import { VELOCITY_NOTES } from "@/lib/velocity-notes";
import { I } from "@/components/ui/icons";
import { ProviderMark } from "@/components/ui/provider-mark";
import { Sparkline } from "@/components/ui/sparkline";
import { TierChip } from "@/components/ui/tier-chip";
import { Tooltip } from "@/components/ui/tooltip";
import { Dropdown } from "@/components/ui/dropdown";
import type { FingerprintResult, ModelDef, ModelPricingEntry, Provider, Tier } from "@/lib/types";

export function ProviderDetail({ slug }: { slug: string }) {
  const { t, lang } = useLang();
  const { providers, models, loading } = useData();
  const p = providers.find((x) => x.slug === slug);

  const supportedModels = useMemo(
    () => models.filter((m) => p?.modelPricing?.[m.id] || p?.modelEvals?.[m.id]),
    [models, p],
  );
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const effectiveModelId = selectedModelId || p?.defaultModelId || supportedModels[0]?.id || "";
  const selectedModel = models.find((m) => m.id === effectiveModelId) ?? supportedModels[0] ?? null;

  if (loading) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-32 text-center text-smoke animate-pulse">
        <div className="serif-it text-3xl">{t("provider.loading") || "Loading…"}</div>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-32 text-center text-smoke">
        {t("provider.notFound")}
      </div>
    );
  }

  const descText = typeof p.desc === "string" ? p.desc : (p.desc as Record<string, string>)?.[lang] || (p.desc as Record<string, string>)?.en || "";
  const websiteLabel = p.website ? p.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";

  const TitleRow = (
    <div className="flex items-center gap-4 mb-5">
      <ProviderMark slug={slug} size={64} />
      <h1 className="serif text-4xl sm:text-5xl lg:text-6xl tracking-editorial inline-flex items-baseline gap-3 group-hover:text-brand transition-colors">
        <span>{p.name}</span>
        {p.website && (
          <I.external className="w-5 h-5 text-smoke group-hover:text-brand transition-colors -translate-y-[6px]" />
        )}
      </h1>
    </div>
  );

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-12">
      <Link
        href="/"
        className="micro text-smoke hover:text-bone inline-flex items-center gap-1.5 mb-8"
      >
        <span>←</span> {t("provider.backToRanking")}
      </Link>

      {/* Header */}
      <div className="border-b border-ink-600 pb-10 mb-12 flex items-end justify-between flex-wrap gap-6">
        <div className="max-w-3xl">
          {p.website ? (
            <a
              href={p.website}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-block"
              aria-label={`${p.name} · ${websiteLabel}`}
            >
              {TitleRow}
            </a>
          ) : (
            TitleRow
          )}
          <p className="text-ash text-[15px] leading-relaxed">{descText}</p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <Link
            href={`/run?provider=${slug}`}
            className="btn-brand px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2"
          >
            {t("provider.openInRun")} <I.arrow className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* MODEL CONTEXT BAR */}
      <ModelContextBar p={p} model={selectedModel} models={models} onChange={setSelectedModelId} />

      {/* TOP METRICS */}
      <TopMetrics p={p} modelId={effectiveModelId} model={selectedModel} />

      {/* MAIN GRID */}
      <div className="grid lg:grid-cols-3 gap-10 lg:gap-12">
        <div className="lg:col-span-2 space-y-16">
          <CostSection p={p} selectedModelId={effectiveModelId} />
          <PerformanceSection p={p} />
          <FingerprintPanel p={p} modelId={effectiveModelId} onModelChange={setSelectedModelId} />
        </div>
        <ScoreSidebar p={p} modelId={effectiveModelId} model={selectedModel} />
      </div>

      {/* INCIDENTS */}
      <IncidentsSection p={p} />
    </div>
  );
}

/* ─── Model context bar ─── */

function ModelContextBar({
  p, model, models, onChange,
}: {
  p: Provider;
  model: ModelDef | null;
  models: ModelDef[];
  onChange: (id: string) => void;
}) {
  const { t } = useLang();
  const supported = models.filter((m) => p.modelPricing?.[m.id] || p.modelEvals?.[m.id]);
  if (supported.length === 0 || !model) return null;
  return (
    <div className="mb-10 flex items-center gap-3 flex-wrap border border-ink-600 px-5 py-3 bg-ink-800/40">
      <span className="micro text-smoke shrink-0">{t("provider.modelContextLabel")}</span>
      <Dropdown
        label={t("provider.selectModel")}
        value={model.display}
        options={supported.map((m) => ({ v: m.id, l: m.display }))}
        onChange={onChange}
      />
      <span className="text-[12px] text-ash">
        {t("provider.modelContextSupported", { n: supported.length })}
      </span>
    </div>
  );
}

/* ─── Top metrics bar ─── */

function TopMetrics({ p, modelId, model }: { p: Provider; modelId: string; model: ModelDef | null }) {
  const { t } = useLang();

  const mp = p.modelPricing?.[modelId];
  const ev = p.modelEvals?.[modelId];

  // Cost: use model's listed price with delta vs official
  const costIn = mp?.listedIn ?? p.costIn;
  const costOut = mp?.listedOut ?? p.costOut;
  const officialIn = model?.officialIn ?? 0;
  const officialOut = model?.officialOut ?? 0;
  const avgListed = (costIn + costOut) / 2;
  const avgRef = (officialIn + officialOut) / 2;
  const costDelta = avgRef > 0 ? ((avgListed - avgRef) / avgRef) * 100 : 0;
  const costDeltaTone = costDelta < 0 ? "brand" : costDelta > 5 ? "coral" : "bone";

  // TTFT from model eval
  const ttftP50ms = ev?.ttftP50Ms ?? Math.round(p.ttft * 1000);
  const ttftP95ms = ev?.ttftP95Ms ?? Math.round(p.ttftP95 * 1000);

  // Success from model eval
  const success = ev?.successRate ?? p.success;

  // Overall score from model eval
  const modelScore = ev?.totalScore ?? p.overall;
  const modelTier = ev?.rating ?? p.tier;
  const modelScoreTone = modelScore >= 80 ? "brand" : modelScore >= 65 ? "amber" : "coral";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-ink-600 mb-12">
      <Metric
        label={t("provider.m1MTokInOut")}
        value={`${fmtUSD(costIn)} / ${fmtUSD(costOut)}`}
        sub={`${costDelta >= 0 ? "+" : ""}${costDelta.toFixed(1)}% vs official`}
        tone={costDeltaTone}
      />
      <TrustHistoryCard p={p} />
      <Metric
        label={t("provider.mTtft")}
        value={`${ttftP50ms}ms`}
        sub={t("provider.mTtftSub", { ms: String(ttftP95ms) })}
      />
      <Metric
        label={t("provider.mSuccess")}
        value={fmtPct(success, 1)}
        sub={t("provider.mSamples", { n: (ev?.e2eP50Ms ? Math.round(ev.e2eP50Ms) : p.samples).toLocaleString() })}
      />
    </div>
  );
}

/* ─── Cost section (listed vs observed per model) ─── */

interface CostEntry {
  m: ModelDef;
  mp: ModelPricingEntry;
  refIn: number;
  refOut: number;
  markupVsOfficial: number;
  driftVsListed: number;
}

function useCostEntries(p: Provider): CostEntry[] {
  const { models } = useData();
  return useMemo(() => {
    return models.filter((m) => p.modelPricing?.[m.id]).map((m) => {
      const mp = p.modelPricing[m.id];
      const refIn  = m.officialIn;
      const refOut = m.officialOut;
      const listedBlended   = (mp.listedIn   + mp.listedOut)   / 2;
      const refBlended      = (refIn         + refOut)         / 2;
      const observedBlended = (mp.observedIn + mp.observedOut) / 2;
      const markupVsOfficial = refBlended > 0 ? ((listedBlended - refBlended) / refBlended) * 100 : 0;
      const driftVsListed    = listedBlended > 0 ? ((observedBlended - listedBlended) / listedBlended) * 100 : 0;
      return { m, mp, refIn, refOut, markupVsOfficial, driftVsListed };
    });
  }, [p]);
}

function PreviewChip() {
  const { t } = useLang();
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] tracking-wider uppercase border border-amber/50 text-amber">
      <I.dot className="w-1.5 h-1.5" />
      {t("provider.previewChip")}
    </span>
  );
}

function BillingTrustChip({ status }: { status: "clean" | "minor" | "concern" }) {
  const { t } = useLang();
  const map = {
    clean:   { cls: "border-brand/40 text-brand",  key: "provider.billingClean"   as const },
    minor:   { cls: "border-amber/40 text-amber",  key: "provider.billingMinor"   as const },
    concern: { cls: "border-coral/40 text-coral",  key: "provider.billingConcern" as const },
  };
  const { cls, key } = map[status];
  return (
    <span className={cx("inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] tracking-wider uppercase border", cls)}>
      <I.dot className="w-1.5 h-1.5" />
      {t(key)}
    </span>
  );
}

function PerCallEstimator({ entries, initialModelId }: { entries: CostEntry[]; initialModelId: string }) {
  const { t } = useLang();
  const [selectedId, setSelectedId] = useState(initialModelId || (entries[0]?.m.id ?? ""));

  useEffect(() => {
    if (initialModelId && entries.some((e) => e.m.id === initialModelId)) {
      setSelectedId(initialModelId);
    }
  }, [initialModelId, entries]);

  const sel = entries.find((e) => e.m.id === selectedId) || entries[0];
  if (!sel) return null;

  const inTok = 250, outTok = 750;
  const observedReq = (inTok * sel.mp.observedIn + outTok * sel.mp.observedOut) / 1e6;
  const refReq      = (inTok * sel.refIn         + outTok * sel.refOut)         / 1e6;
  const perCallDelta = observedReq - refReq;
  const cheaper = perCallDelta < 0;
  const matched = Math.abs(perCallDelta) < 1e-7;
  const tone = matched ? "text-smoke" : cheaper ? "text-brand" : "text-coral";

  const tiers = [100, 1000, 10000, 100000];

  return (
    <div className="card p-6 space-y-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap pb-4 border-b border-ink-600">
        <div>
          <h4 className="serif text-xl tracking-editorial">{t("provider.costAnalyzerTitle")}</h4>
          <div className="micro text-smoke mt-1.5">{t("provider.perTypicalChat", { inTok, outTok })}</div>
        </div>
        <Dropdown
          label={t("provider.selectModel")}
          value={sel.m.display}
          options={entries.map((e) => ({ v: e.m.id, l: e.m.display }))}
          onChange={setSelectedId}
        />
      </div>

      <div className="grid grid-cols-2 gap-px bg-ink-600 border border-ink-600">
        <div className="bg-ink px-4 py-4">
          <div className="micro text-smoke mb-1.5">{t("provider.officialPrice")}</div>
          <div className="num text-[20px] text-smoke tracking-tight">{fmtUSD(refReq, 4)}</div>
        </div>
        <div
          className="px-4 py-4 border-l-2 border-amber/50"
          style={{ background: "rgb(var(--amber) / 0.06)" }}
        >
          <div className="micro text-amber mb-1.5 flex items-center gap-1.5">
            {t("provider.observedShort")} <PreviewChip />
          </div>
          <div className="num text-[20px] text-bone font-medium tracking-tight">{fmtUSD(observedReq, 4)}</div>
        </div>
      </div>

      {!matched && (
        <div className="pt-4 border-t border-ink-600">
          <div className="micro text-smoke mb-3">
            {cheaper ? t("provider.atScaleSavings") : t("provider.atScalePremium")}
          </div>
          <div>
            {tiers.map((n) => {
              const daily = Math.abs(perCallDelta) * n;
              return (
                <div key={n} className="flex items-baseline justify-between text-[12px] py-2 border-b border-ink-600 last:border-0">
                  <span className="num text-ash">{t("provider.callsPerDay", { n: n.toLocaleString() })}</span>
                  <span className={cx("num", tone)}>
                    {cheaper ? "−" : "+"}{fmtUSD(daily)}{t("provider.perDay")}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-ink-600 text-[11px] text-smoke leading-relaxed">
            {(cheaper
              ? t("provider.annualizedSaved", { amt: "__AMT__" })
              : t("provider.annualizedExtra", { amt: "__AMT__" })
            ).split("__AMT__").map((part, i, arr) => (
              <Fragment key={i}>
                {part}
                {i < arr.length - 1 && (
                  <span className={cx("num", tone)}>
                    {cheaper ? "−" : "+"}{fmtUSD(Math.abs(perCallDelta) * 10000 * 365)}
                  </span>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CostSection({ p, selectedModelId }: { p: Provider; selectedModelId: string }) {
  const { t } = useLang();
  const entries = useCostEntries(p);

  if (entries.length === 0) {
    return (
      <section>
        <div className="micro text-smoke mb-3">{t("provider.tagCost")}</div>
        <h3 className="serif text-3xl tracking-editorial">{t("provider.headObservedVsOfficial")}</h3>
        <p className="mt-3 text-ash text-[13px]">{t("provider.noModelPricing")}</p>
      </section>
    );
  }

  const avgMarkup = entries.reduce((s, e) => s + e.markupVsOfficial, 0) / entries.length;
  const avgDrift  = entries.reduce((s, e) => s + e.driftVsListed,    0) / entries.length;
  const billingStatus: "clean" | "minor" | "concern" =
    Math.abs(avgDrift) < 1 ? "clean" : Math.abs(avgDrift) < 3 ? "minor" : "concern";

  return (
    <section>
      <div className="micro text-smoke mb-3">{t("provider.tagCost")}</div>
      <h3 className="serif text-3xl tracking-editorial">{t("provider.headObservedVsOfficial")}</h3>
      <p className="mt-2 text-[13px] text-ash leading-relaxed flex items-center gap-2 flex-wrap">
        <span>
          {t("provider.costSummaryPre", { name: p.name, n: entries.length })}{" "}
          <span className="num text-bone">
            {avgMarkup >= 0 ? "+" : "−"}{Math.abs(avgMarkup).toFixed(1)}%
          </span>
          {t("provider.costSummaryMid")}{" "}
          <span className={cx("num", billingStatus === "concern" ? "text-coral" : billingStatus === "minor" ? "text-amber" : "text-bone")}>
            {avgDrift >= 0 ? "+" : "−"}{Math.abs(avgDrift).toFixed(1)}%
          </span>
          {t("provider.costSummaryPost")}
        </span>
        <BillingTrustChip status={billingStatus} />
      </p>

      {/* Per-model pricing table */}
      <div className="mt-6 card overflow-hidden">
        {/* Desktop */}
        <div className="hidden md:grid grid-cols-[1.4fr_1fr_1fr_1.3fr] gap-px bg-ink-600 micro text-smoke">
          <div className="bg-ink-800/40 px-4 py-3">{t("provider.colModel")}</div>
          <div className="bg-ink-800/40 px-4 py-3">{t("provider.colOfficial")}</div>
          <div className="bg-ink-800/40 px-4 py-3">{t("provider.colListed")}</div>
          <div
            className="px-4 py-3 border-l-2 border-amber/50 flex items-start justify-between gap-2"
            style={{ background: "rgb(var(--amber) / 0.10)" }}
          >
            <div>
              <div className="text-bone normal-case tracking-normal text-[12px] font-medium flex items-center gap-1.5">
                {t("provider.colObserved")} <PreviewChip />
              </div>
              <div className="micro text-amber mt-0.5 normal-case tracking-wider">
                {t("provider.colObservedNote")}
              </div>
            </div>
          </div>
        </div>
        <div className="hidden md:grid grid-cols-[1.4fr_1fr_1fr_1.3fr] gap-px bg-ink-600 text-[12.5px]">
          {entries.map(({ m, mp, refIn, refOut }) => {
            const isSelected = m.id === selectedModelId;
            return (
              <Fragment key={m.id}>
                <div
                  className={cx("bg-ink px-4 py-3", isSelected && "border-l-2 border-brand/60")}
                  style={isSelected ? { background: "rgb(var(--brand) / 0.04)" } : undefined}
                >
                  <div className="text-bone">{m.display}</div>
                  <div className="micro text-smoke mt-0.5">{m.owner}</div>
                </div>
                <div className="bg-ink px-4 py-3 num text-smoke">
                  {fmtUSD(refIn)} / {fmtUSD(refOut)}
                </div>
                <div className="bg-ink px-4 py-3 num text-bone/70">
                  {fmtUSD(mp.listedIn)} / {fmtUSD(mp.listedOut)}
                </div>
                <div
                  className="px-4 py-3 num text-bone text-[15px] font-medium tracking-tight border-l-2 border-amber/50"
                  style={{ background: "rgb(var(--amber) / 0.06)" }}
                >
                  {fmtUSD(mp.observedIn)} / {fmtUSD(mp.observedOut)}
                </div>
              </Fragment>
            );
          })}
        </div>

        {/* Mobile stacked cards */}
        <div className="md:hidden divide-y divide-ink-600">
          {entries.map(({ m, mp, refIn, refOut }) => {
            const isSelected = m.id === selectedModelId;
            return (
              <div
                key={m.id}
                className={cx("p-4", isSelected && "border-l-2 border-brand/60")}
                style={isSelected ? { background: "rgb(var(--brand) / 0.04)" } : undefined}
              >
                <div className="mb-3">
                  <div className="text-bone text-[14px]">{m.display}</div>
                  <div className="micro text-smoke">{m.owner}</div>
                </div>
                <div
                  className="px-3 py-2.5 border-l-2 border-amber/50 mb-2"
                  style={{ background: "rgb(var(--amber) / 0.08)" }}
                >
                  <div className="micro text-amber mb-1 flex items-center gap-1.5">
                    <span>{t("provider.colObservedShort")}</span>
                    <PreviewChip />
                  </div>
                  <div className="num text-bone text-[15px] font-medium tracking-tight">
                    {fmtUSD(mp.observedIn)} / {fmtUSD(mp.observedOut)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="micro text-smoke">{t("provider.colOfficialShort")}</div>
                    <div className="num text-smoke">{fmtUSD(refIn)} / {fmtUSD(refOut)}</div>
                  </div>
                  <div>
                    <div className="micro text-smoke">{t("provider.colListedShort")}</div>
                    <div className="num text-bone/70">{fmtUSD(mp.listedIn)} / {fmtUSD(mp.listedOut)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 micro text-smoke flex items-center gap-2 border-t border-ink-600 flex-wrap">
          <PreviewChip />
          <span>{t("provider.observedFootnote", { samples: 210, window: "7d" })}</span>
        </div>
      </div>

      <div className="mt-8">
        <PerCallEstimator entries={entries} initialModelId={selectedModelId} />
      </div>
    </section>
  );
}

/* ─── Performance section ─── */

function TtftTrendChart({ data, color = "rgb(var(--sky))" }: { data: number[]; color?: string }) {
  const { t } = useLang();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!data?.length) return null;

  const valuesMs = data.map((s) => Math.round(s * 1000));
  const min = Math.min(...valuesMs);
  const max = Math.max(...valuesMs);

  const w = 540, h = 96;
  const padL = 4, padR = 4, padT = 8, padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const range = max - min;
  const yPad = range === 0 ? 1 : range * 0.3;
  const yMin = min - yPad;
  const yMax = max + yPad;
  const yRange = yMax - yMin || 1;

  const x = (i: number) => padL + (i / (data.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - ((v - yMin) / yRange) * innerH;

  const linePath = (() => {
    const pts = valuesMs.map((v, i) => [x(i), y(v)]);
    let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1];
      const [cx_, cy_] = pts[i];
      const midX = (px + cx_) / 2;
      d += ` C ${midX.toFixed(2)},${py.toFixed(2)} ${midX.toFixed(2)},${cy_.toFixed(2)} ${cx_.toFixed(2)},${cy_.toFixed(2)}`;
    }
    return d;
  })();
  const areaPath = `${linePath} L ${x(data.length - 1).toFixed(2)},${(padT + innerH).toFixed(2)} L ${padL.toFixed(2)},${(padT + innerH).toFixed(2)} Z`;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPos = ((e.clientX - rect.left) / rect.width) * w;
    const relX = xPos - padL;
    if (relX < -8 || relX > innerW + 8) { setHoverIdx(null); return; }
    const step = innerW / (data.length - 1);
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(relX / step)));
    setHoverIdx(idx);
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "11px",
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
    fontWeight: 400,
  };

  const daysAgo = (i: number) => data.length - 1 - i;
  const hoverLabel =
    hoverIdx === null ? null
    : daysAgo(hoverIdx) === 0 ? t("provider.trendToday")
    : t("provider.trendDaysAgo", { n: daysAgo(hoverIdx) });

  const gradId = "ttft-area-fill";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
        <span className="text-[11px] text-smoke num">
          {t("provider.trendRange")}{" "}
          <span className="text-bone">{min}{min === max ? "" : `–${max}`}</span>{" "}
          <span className="text-smoke">ms</span>
        </span>
        {hoverIdx !== null && (
          <span className="text-[11px] num">
            <span className="text-smoke">{hoverLabel}</span>
            <span className="text-smoke px-1.5">·</span>
            <span className="text-bone">{valuesMs[hoverIdx]} ms</span>
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="block w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={padL} x2={w - padR}
          y1={padT + innerH - 0.5} y2={padT + innerH - 0.5}
          stroke="rgb(var(--ink-700))" strokeWidth="0.5"
        />
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <text x={padL + 2} y={h - 6} fill="rgb(var(--smoke))" style={labelStyle}>
          {t("provider.trendDaysAgo", { n: data.length - 1 })}
        </text>
        <text x={w - padR - 2} y={h - 6} fill="rgb(var(--smoke))" textAnchor="end" style={labelStyle}>
          {t("provider.trendToday")}
        </text>
        {hoverIdx !== null && (() => {
          const hx = x(hoverIdx);
          const hy = y(valuesMs[hoverIdx]);
          return (
            <g>
              <line x1={hx} x2={hx} y1={padT} y2={padT + innerH} stroke={color} strokeDasharray="2,3" opacity="0.4" />
              <circle cx={hx} cy={hy} r="3.5" fill="rgb(var(--ink))" stroke={color} strokeWidth="1.5" />
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

function PerformanceSection({ p }: { p: Provider }) {
  const { t } = useLang();

  const ttftP50 = p.ttft;
  const ttftP95 = p.ttftP95;
  const ttftP99 = +(ttftP50 * (2.55 + (strHash(p.slug + "p99ttft") % 30) / 100)).toFixed(3);
  const fmtMs = (s: number) => `${(s * 1000) | 0}ms`;

  const regions = useMemo(() => {
    const base = ttftP50;
    const seed = (k: string) => strHash(p.slug + k) % 100;
    const reg = (p.region || "").toLowerCase();
    const homeBase = (homeKey: string) => reg.includes(homeKey) ? 1 : 1.4 + seed(homeKey) / 250;
    const globalish = reg.includes("global") || reg.includes("self") || reg.includes("asia");
    return [
      { name: "US",   ttft: +(base * homeBase("us")).toFixed(3) },
      { name: "EU",   ttft: +(base * homeBase("eu")).toFixed(3) },
      { name: "Asia", ttft: +(base * (globalish ? 1.1 : 1.7 + seed("asia") / 250)).toFixed(3) },
    ];
  }, [p.slug, ttftP50, p.region]);
  const maxRegional = Math.max(...regions.map((r) => r.ttft));

  const ttftSpark = useMemo(() => {
    if (!p.spark || !p.spark.length) return [];
    const recent = p.spark.slice(-7);
    return recent.map((v) => +(ttftP50 * (0.88 + (v / 10) * 0.20)).toFixed(3));
  }, [p.slug, p.spark, ttftP50]);

  const tone = (val: number, ok: number, warn: number) =>
    val <= ok ? "text-brand" : val <= warn ? "text-amber" : "text-coral";
  const successTone =
    p.success >= 0.99 ? "text-brand" : p.success >= 0.97 ? "text-bone" : "text-amber";

  return (
    <section>
      <div className="micro text-smoke mb-3">{t("provider.tagPerformance")}</div>
      <h3 className="serif text-3xl tracking-editorial">{t("provider.headPerformance")}</h3>
      <p className="mt-2 text-[13px] text-ash leading-relaxed">
        {t("provider.perfSummary", { samples: p.samples.toLocaleString() })}
      </p>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-px bg-ink-600 border border-ink-600">
        <PerfMetric label={t("provider.perfP50")}     hint={t("provider.perfP50Hint")}     value={fmtMs(ttftP50)} tone={tone(ttftP50, 0.30, 0.50)} />
        <PerfMetric label={t("provider.perfP95")}     hint={t("provider.perfP95Hint")}     value={fmtMs(ttftP95)} tone={tone(ttftP95, 0.60, 1.00)} />
        <PerfMetric label={t("provider.perfP99")}     hint={t("provider.perfP99Hint")}     value={fmtMs(ttftP99)} tone={tone(ttftP99, 0.80, 1.40)} />
        <PerfMetric label={t("provider.perfSuccess")} hint={t("provider.perfSuccessHint")} value={fmtPct(p.success, 1)} tone={successTone} />
      </div>

      {ttftSpark.length > 0 && (
        <div className="mt-6 card p-5">
          <div className="micro text-smoke mb-4">{t("provider.perfTrend7d")}</div>
          <TtftTrendChart data={ttftSpark} color="rgb(var(--sky))" />
        </div>
      )}

      <div className="mt-6 card p-5">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <div className="micro text-smoke">{t("provider.perfRegional")}</div>
          <PreviewChip />
        </div>
        <div className="space-y-3">
          {regions.map((r) => (
            <div key={r.name}>
              <div className="flex items-baseline justify-between mb-1.5 text-[12px]">
                <span className="text-ash">{r.name}</span>
                <span className="num text-bone">{(r.ttft * 1000) | 0}ms</span>
              </div>
              <div className="h-1.5 bg-ink-700 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-sky transition-all"
                  style={{ width: `${(r.ttft / maxRegional) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid sm:grid-cols-2 gap-4">
        <PlaceholderCard title={t("provider.perfThroughput")}  note={t("provider.perfThroughputNote")} />
        <PlaceholderCard title={t("provider.perfLongContext")} note={t("provider.perfLongContextNote")} />
      </div>
    </section>
  );
}

function PlaceholderCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="card p-5 relative">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[13px] text-bone">{title}</div>
        <PreviewChip />
      </div>
      <div className="micro text-smoke leading-relaxed">{note}</div>
      <div className="mt-4 h-1 bg-ink-700 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-ink-500 to-transparent opacity-50" />
      </div>
    </div>
  );
}

function PerfMetric({ label, value, tone, hint }: { label: string; value: string; tone: string; hint?: string }) {
  return (
    <div className="bg-ink p-4">
      <div className="micro text-smoke mb-2 flex items-center gap-1.5">
        <span>{label}</span>
        {hint && (
          <Tooltip content={hint}><I.info className="w-3 h-3" /></Tooltip>
        )}
      </div>
      <div className={cx("num text-[20px] tracking-tight", tone)}>{value}</div>
    </div>
  );
}

/* ─── Score sidebar ─── */

function ScoreSidebar({ p, modelId, model }: { p: Provider; modelId: string; model: ModelDef | null }) {
  const { t } = useLang();

  const ev = p.modelEvals?.[modelId];
  const score = ev?.totalScore ?? p.overall;
  const modelTier = (ev?.rating ?? p.tier) as Tier;

  const groups = [
    {
      key: "L1" as const,
      label: t("provider.l1Label"),
      score: p.L1,
      w: 40,
      defaultOpen: true,
      subs: [
        { id: "1.1", name: t("provider.sub11"), value: p.scores.L1.modelAuth,    w: 50 },
        { id: "1.2", name: t("provider.sub12"), value: p.scores.L1.billingTrans, w: 30 },
        { id: "1.3", name: t("provider.sub13"), value: p.scores.L1.cacheFraud,   w: 20 },
      ],
    },
    {
      key: "L3" as const,
      label: t("provider.l3Label"),
      score: p.L3,
      w: 40,
      defaultOpen: false,
      subs: [
        { id: "3.1", name: t("provider.sub31"), value: p.scores.L3.listPricing,          w: 35 },
        { id: "3.2", name: t("provider.sub32"), value: p.scores.L3.relativeToOfficial,   w: 40 },
        { id: "3.3", name: t("provider.sub33"), value: p.scores.L3.hiddenCost,           w: 25 },
      ],
    },
    {
      key: "L2" as const,
      label: t("provider.l2Label"),
      score: p.L2,
      w: 20,
      defaultOpen: false,
      subs: [
        { id: "2.1", name: t("provider.sub21"), value: p.scores.L2.latency,     w: 50 },
        { id: "2.2", name: t("provider.sub22"), value: p.scores.L2.throughput,  w: 30 },
        { id: "2.3", name: t("provider.sub23"), value: p.scores.L2.longContext, w: 20 },
      ],
    },
  ];

  const dimCounts = (p.incidents || []).reduce<Record<string, number>>((acc, inc) => {
    const fam = (inc.dim || "").slice(0, 2);
    if (fam) acc[fam] = (acc[fam] || 0) + 1;
    return acc;
  }, {});
  const totalEvents = Object.values(dimCounts).reduce((s, n) => s + n, 0);

  return (
    <aside className="lg:sticky lg:top-20 self-start">
      <div className="card-2 ring-1 ring-brand/25 relative overflow-hidden">
        {/* Top brand gradient line — absolute inside relative overflow-hidden */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />
        <div className="p-6">
          <div className="micro text-smoke mb-1">{t("provider.sidebarScoreLabel")}</div>
          {model && (
            <div className="text-[11px] text-ash mb-3">
              {p.name} <span className="text-smoke">×</span> {model.display}
            </div>
          )}
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="serif text-[52px] leading-none tracking-editorial text-bone num">{score}</span>
            <span className="micro text-smoke num">/ 100</span>
            <TierChip tier={modelTier} size="lg" />
          </div>
          <div className="mt-4 h-1.5 bg-ink-700 overflow-hidden relative">
            <div
              className="absolute inset-y-0 left-0 bg-brand transition-all"
              style={{ width: `${score}%` }}
              title={`${score} / 100`}
            />
          </div>

          {/* Tier rows — collapsible, all closed by default */}
          <div className="mt-6 pt-5 border-t border-ink-600 space-y-px bg-ink-600">
            {groups.map((g) => (
              <details key={g.key} className="bg-ink group">
                <summary className="py-2.5 px-3 flex items-center gap-2 cursor-pointer hover:bg-ink-700 transition-colors">
                  <span className="text-smoke text-[9px] num group-open:rotate-90 transition-transform inline-block w-2 shrink-0">▶</span>
                  <span className="text-[12px] text-bone truncate flex-1 min-w-0">
                    <span className={g.key === "L1" ? "text-brand" : g.key === "L3" ? "text-amber" : "text-sky"}>{g.key}</span>
                    {" · "}{g.label}
                  </span>
                  <span className={cx("num text-[13px] w-8 text-right shrink-0", g.key === "L1" ? "text-brand" : g.key === "L3" ? "text-amber" : "text-sky")}>{g.score}</span>
                  <span className="micro text-smoke w-8 text-right shrink-0">{g.w}%</span>
                </summary>
                <div className="border-t border-ink-600 divide-y divide-ink-600">
                  {g.subs.map((s) => (
                    <div key={s.id} className="px-3 py-2 flex items-center gap-2 text-[11px]">
                      <span className="num text-[9px] text-smoke shrink-0 w-5">{s.id}</span>
                      <span className="text-ash truncate flex-1 min-w-0">{s.name}</span>
                      <span className="num text-bone w-7 text-right">{s.value}</span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>

          {/* Event count */}
          <div className="mt-5 pt-4 border-t border-ink-600">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="micro text-smoke">{t("provider.sidebarRecent7d")}</span>
              {totalEvents === 0 ? (
                <span className="text-smoke">{t("provider.sidebarNoEvents")}</span>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="num text-bone">{t("provider.sidebarEventsCount", { n: totalEvents })}</span>
                  <span className="flex items-center gap-1.5">
                    {dimCounts["L1"] > 0 && <DimChipMini label="L1" count={dimCounts["L1"]} />}
                    {dimCounts["L2"] > 0 && <DimChipMini label="L2" count={dimCounts["L2"]} />}
                    {dimCounts["L3"] > 0 && <DimChipMini label="L3" count={dimCounts["L3"]} />}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Formula */}
          <div className="mt-4 pt-4 border-t border-ink-600">
            <div className="micro text-smoke mb-1.5">{t("provider.sidebarFormula")}</div>
            <div className="num text-[11px] text-bone leading-relaxed">0.4·L1 + 0.4·L3 + 0.2·L2</div>
            <Link href="/docs" className="mt-3 micro text-brand hover:underline inline-flex items-center gap-1">
              {t("provider.methodology")} <I.arrow className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
      <TrustVelocity p={p} />
    </aside>
  );
}

/* ─── Incidents section ─── */

function DimChip({ dim }: { dim?: string }) {
  if (!dim) return null;
  const cls =
    dim.startsWith("L1") ? "border-brand/45 text-brand" :
    dim.startsWith("L2") ? "border-sky/45 text-sky" :
    dim.startsWith("L3") ? "border-amber/45 text-amber" :
    "border-ink-500 text-smoke";
  return (
    <span className={cx("inline-flex items-center px-1.5 py-0.5 text-[9px] tracking-wider uppercase border font-mono", cls)}>
      {dim}
    </span>
  );
}

function DimChipMini({ label, count }: { label: string; count: number }) {
  const digit = label[1];
  const tone = digit === "1" ? "text-brand" : digit === "2" ? "text-sky" : "text-amber";
  return (
    <span className={cx("inline-flex items-center text-[10px] num tracking-wider uppercase", tone)}>
      {label}×{count}
    </span>
  );
}

function IncidentsSection({ p }: { p: Provider }) {
  const { t } = useLang();
  const { models } = useData();
  return (
    <section className="mt-16">
      <div className="micro text-smoke mb-3">{t("provider.tagIncidents")}</div>
      <div className="card divide-y divide-ink-600">
        {p.incidents.length === 0 ? (
          <div className="px-6 py-8 text-ash text-[13px]">{t("provider.noIncidents")}</div>
        ) : (
          p.incidents.map((inc, i) => {
            const affectedNames = (inc.affectedModels || [])
              .map((mid) => models.find((m) => m.id === mid)?.display)
              .filter(Boolean) as string[];
            return (
              <div key={i} className="grid grid-cols-[100px_1fr_auto_64px] px-6 py-4 items-start gap-4">
                <div className="num text-[12px] text-smoke pt-0.5">{inc.time}</div>
                <div className="min-w-0">
                  <div className="text-[13px] text-bone leading-snug">{inc.issue}</div>
                  {(inc.duration || affectedNames.length > 0) && (
                    <div className="micro text-smoke mt-1 flex items-center gap-2 flex-wrap">
                      {inc.duration && <span>{inc.duration}</span>}
                      {inc.duration && affectedNames.length > 0 && (
                        <span className="text-ink-500">·</span>
                      )}
                      {affectedNames.length > 0 && (
                        <span className="normal-case tracking-normal">
                          {affectedNames.join(" · ")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="pt-0.5">
                  <DimChip dim={inc.dim} />
                </div>
                <div className={cx("micro flex items-center gap-1.5 justify-end pt-1", sevColor(inc.sev))}>
                  <I.dot className="w-2 h-2" />
                  {t(
                    "provider.sev" +
                      (inc.sev === "high" ? "High" : inc.sev === "medium" ? "Med" : "Low"),
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/* ─── Fingerprint panel ─── */

function FingerprintPanel({ p, modelId, onModelChange }: { p: Provider; modelId: string; onModelChange: (id: string) => void }) {
  const { t } = useLang();
  const { models } = useData();
  const m = models.find((x) => x.id === modelId);
  if (!m) return null;
  const fp = fingerprint(p.slug, modelId);

  return (
    <div className="mt-16">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="micro text-smoke mb-2">{t("provider.tagFingerprint")}</div>
          <h3 className="serif text-3xl tracking-editorial">
            {t("provider.headDidYouGet")}{" "}
            <span className="serif-it text-brand">{m.display}</span>?
          </h3>
        </div>
        <div className="text-right flex flex-col items-end gap-2">
          <Link href="/validate" className="micro text-brand hover:underline inline-flex items-center gap-1">
            <I.bolt className="w-3 h-3" /> {t("provider.runLiveValidation")}
          </Link>
          <div>
            <div className="micro text-smoke">{t("provider.refreshNightly")}</div>
            <div className="num text-[10px] text-ash mt-0.5">2026-05-15 · 14:04 UTC</div>
          </div>
        </div>
      </div>

      <div className="flex md:flex-wrap gap-0 border-b border-ink-600 mb-6 -mx-1 overflow-x-auto md:overflow-visible no-scroll-x">
        {models.map((model) => {
          const active = model.id === modelId;
          const modelFp = fingerprint(p.slug, model.id);
          const tone =
            !modelFp || modelFp.unsupported
              ? "text-smoke"
              : modelFp.flag
                ? "text-coral"
                : modelFp.score >= 88
                  ? "text-brand"
                  : modelFp.score >= 70
                    ? "text-amber"
                    : "text-coral";
          return (
            <button
              key={model.id}
              onClick={() => onModelChange(model.id)}
              className={cx(
                "px-4 py-2.5 text-[12px] tracking-tight transition-colors border-b-2 -mb-px flex items-center gap-1.5",
                active ? "border-brand text-bone" : cx("border-transparent hover:text-bone", tone),
              )}
            >
              <span>{model.display}</span>
              {modelFp?.flag && <span className="text-coral">⚠</span>}
              {modelFp?.unsupported && <span className="text-smoke text-[10px]">—</span>}
              {!modelFp?.unsupported && !modelFp?.flag && modelFp && (
                <span className={cx("num text-[10px]", tone, active && "text-ash")}>
                  {modelFp.score}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <FingerprintCard p={p} m={m} fp={fp} />
    </div>
  );
}

function FingerprintCard({
  p,
  m,
  fp,
}: {
  p: Provider;
  m: ModelDef;
  fp: FingerprintResult | null;
}) {
  const { t } = useLang();
  if (!fp) return null;

  if (fp.unsupported) {
    const titleStr = t("provider.fpUnsupportedTitle", {
      name: "__NAME__",
      model: "__MODEL__",
    });
    return (
      <div className="card p-8">
        <div className="flex items-start gap-5">
          <span className="serif-it text-6xl text-smoke leading-none">∅</span>
          <div className="flex-1 pt-1">
            <div className="micro text-smoke mb-2">{t("provider.fpUnsupportedTag")}</div>
            <h4 className="serif text-2xl tracking-editorial">
              {titleStr.split(/(__NAME__|__MODEL__)/).map((part, i) => {
                if (part === "__NAME__") return <Fragment key={i}>{p.name}</Fragment>;
                if (part === "__MODEL__")
                  return <span key={i} className="text-bone">{m.display}</span>;
                return <Fragment key={i}>{part}</Fragment>;
              })}
            </h4>
            <p className="mt-3 text-ash text-[13px] leading-relaxed max-w-2xl">{fp.reason}</p>
            <p className="mt-2 text-[11px] text-smoke leading-relaxed">
              {t("provider.fpUnsupportedNote")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-5">
      {fp.flag && (
        <div className="border border-coral/40 bg-coral/[0.04] px-4 py-3">
          <div className="flex items-start gap-3">
            <I.alert className="w-4 h-4 text-coral mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-coral text-[13px] tracking-tight">{fp.flag.headline}</div>
              <p className="mt-1 text-[12px] text-ash leading-relaxed">{fp.flag.detail}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-baseline justify-between">
        <div>
          <div className="micro text-smoke">{t("provider.matchScore")}</div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={cx(
              "serif text-3xl sm:text-4xl lg:text-5xl tracking-editorial",
              fp.score >= 88 ? "text-brand" : fp.score >= 70 ? "text-amber" : "text-coral",
            )}>
              {fp.score}
            </span>
            <span className="text-[12px] text-smoke num">/ 100</span>
            {!fp.flag && fp.score >= 88 && (
              <span className="micro text-brand ml-2">{t("provider.verified")}</span>
            )}
            {!fp.flag && fp.score >= 70 && fp.score < 88 && (
              <span className="micro text-amber ml-2">{t("provider.caution")}</span>
            )}
            {fp.score < 70 && (
              <span className="micro text-coral ml-2">{t("provider.risky")}</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-[13px] text-bone">{fp.samples}</div>
          <div className="micro text-smoke">{t("provider.samples24h")}</div>
        </div>
      </div>

      <div className="pt-4 border-t border-ink-600 space-y-4">
        <FpBar
          label={t("provider.fpEmbedDist")}
          value={fp.embedDist.toFixed(2)}
          pct={fp.embedDist * 100}
          ok={fp.embedDist >= 0.85}
          hint={t("provider.fpEmbedHint")}
        />
        <FpBar
          label={t("provider.fpLengthDist")}
          value={`K-S p=${fp.lengthKsP.toFixed(2)}`}
          pct={Math.min(100, fp.lengthKsP * 200)}
          ok={fp.lengthKsP >= 0.2}
          hint={t("provider.fpLengthHint")}
        />
        <FpRow
          label={t("provider.fpTokenizer")}
          value={fp.tokenizer.observed}
          ok={fp.tokenizer.match}
          expected={fp.tokenizer.expected}
          expectedLabel={t("provider.fpExpected")}
          hint={t("provider.fpTokenizerHint")}
        />
        <FpRow
          label={t("provider.fpPrecision")}
          value={fp.precision}
          ok={fp.precision === "FP16"}
          expectedLabel={t("provider.fpExpected")}
          hint={t("provider.fpPrecisionHint")}
        />
        <FpRow
          label={t("provider.fpRefusal")}
          value={`${fp.refusalDelta > 0 ? "+" : ""}${fp.refusalDelta}pt`}
          ok={Math.abs(fp.refusalDelta) <= 3}
          expectedLabel={t("provider.fpExpected")}
          hint={t("provider.fpRefusalHint")}
        />
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
          <span className={cx("text-[11px]", ok ? "text-brand" : "text-coral")}>
            {ok ? "✓" : "✗"}
          </span>
        </div>
      </div>
      <div className="h-1 bg-ink-500 relative overflow-hidden">
        <div
          className={cx("absolute inset-y-0 left-0 transition-all", ok ? "bg-brand" : "bg-coral")}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
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
  expectedLabel,
  hint,
}: {
  label: string;
  value: string;
  ok: boolean;
  expected?: string;
  expectedLabel?: string;
  hint: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] text-ash">{label}</span>
        <div className="flex items-center gap-2">
          {expected && expected !== value && (
            <span className="text-[10px] text-smoke">
              {expectedLabel || "expected"}{" "}
              <span className="text-ash">{expected}</span>
            </span>
          )}
          <span className="num text-[12px] text-bone">{value}</span>
          <span className={cx("text-[11px]", ok ? "text-brand" : "text-coral")}>
            {ok ? "✓" : "✗"}
          </span>
        </div>
      </div>
      <p className="text-[10px] text-smoke mt-0.5 leading-relaxed">{hint}</p>
    </div>
  );
}

/* ─── Trust history + velocity ─── */

function Metric({
  label,
  value,
  sub,
  tone = "bone",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "brand" | "amber" | "coral" | "sky" | "bone";
}) {
  const colors = {
    brand: "text-brand",
    amber: "text-amber",
    coral: "text-coral",
    sky: "text-sky",
    bone: "text-bone",
  };
  return (
    <div className="bg-ink p-6">
      <div className="micro text-smoke mb-3">{label}</div>
      <div className={cx("serif text-4xl tracking-editorial", colors[tone])}>{value}</div>
      {sub && <div className="text-[11px] text-ash mt-1">{sub}</div>}
    </div>
  );
}

function TrustHistoryCard({ p }: { p: Provider }) {
  const { t } = useLang();
  const h = trustHistory(p);
  const tone = trustTone(p.trust);
  const tColors = { brand: "text-brand", amber: "text-amber", coral: "text-coral" };
  const trendColor =
    h.trend === "up" ? "text-brand" : h.trend === "down" ? "text-coral" : "text-smoke";
  const trendArrow = h.trend === "up" ? "↑" : h.trend === "down" ? "↓" : "→";
  const sparkColor =
    h.trend === "up"
      ? "rgb(var(--brand))"
      : h.trend === "down"
        ? "rgb(var(--coral))"
        : "rgb(var(--ash))";
  return (
    <div className="bg-ink p-6">
      <div className="micro text-smoke mb-3">{t("provider.trustHistoryLabel")}</div>
      <div className="flex items-baseline gap-2">
        <span className={cx("serif text-4xl tracking-editorial", tColors[tone])}>{p.trust}</span>
        <span className={cx("text-[11px] num", trendColor)}>
          {trendArrow} {h.delta30 > 0 ? "+" : ""}
          {h.delta30}
        </span>
      </div>
      <div className="text-[11px] text-ash mt-1">{trustLabel(p.trust)}</div>
      <div className="mt-3 -ml-1">
        <Sparkline data={h.spark} color={sparkColor} w={180} h={26} />
      </div>
    </div>
  );
}

function TrustVelocity({ p }: { p: Provider }) {
  const { t, lang } = useLang();
  const h = trustHistory(p);
  const trendColor =
    h.trend === "up" ? "text-brand" : h.trend === "down" ? "text-coral" : "text-smoke";
  const trendArrow = h.trend === "up" ? "↑" : h.trend === "down" ? "↓" : "→";
  const trendWord =
    h.trend === "up"
      ? t("provider.trendImproving")
      : h.trend === "down"
        ? t("provider.trendDegrading")
        : t("provider.trendStable");
  const note = VELOCITY_NOTES[lang]?.[p.slug] || VELOCITY_NOTES.en[p.slug] || "—";
  return (
    <div className="mt-6 pt-5 border-t border-ink-600">
      <div className="flex items-center justify-between mb-2">
        <span className="micro text-smoke">{t("provider.trustVelocity")}</span>
        <span className={cx("text-[12px]", trendColor)}>
          {trendArrow} {trendWord}{" "}
          {t("provider.trustOver30d", { delta: (h.delta30 >= 0 ? "+" : "") + h.delta30 })}
        </span>
      </div>
      <p className="text-[11px] text-ash leading-relaxed">{note}</p>
    </div>
  );
}
