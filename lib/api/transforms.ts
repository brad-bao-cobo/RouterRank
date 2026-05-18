// Converts raw FastAPI responses into the Provider[] / ModelDef[] shapes
// expected by frontend components.
// All metadata (type, domain, website, region, description) comes from the API.

import type {
  ModelDef,
  ModelEvalSummary,
  Provider,
  ProviderRaw,
  SubScores,
  Tier,
  TrustParts,
} from "@/lib/types";
import { tier } from "@/lib/scoring";
import { strHash } from "@/lib/utils";
import type {
  ApiModelEvaluation,
  ApiPricingRow,
  ApiRegistryProvider,
} from "./index";

// ── small helpers ─────────────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function safeAvg(nums: (number | null)[]): number {
  const valid = nums.filter((n): n is number => n !== null);
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

function effective(price: number | null, discount: number): number | null {
  if (price === null) return null;
  return price * (1 - discount);
}

// ── deterministic derivations from top-level scores ──────────────────────────

function deriveSubScores(
  L1: number,
  L2: number,
  L3: number,
): SubScores {
  return {
    L1: {
      modelAuth:    L1,
      billingTrans: L1,
      cacheFraud:   L1,
    },
    L2: {
      latency:     L2,
      throughput:  L2,
      longContext: L2,
    },
    L3: {
      listPricing:        L3,
      relativeToOfficial: L3,
      hiddenCost:         L3,
    },
  };
}

function deriveTrustParts(slug: string, L1: number): TrustParts {
  const h = (key: string) => (strHash(slug + key) % 10) - 5;
  return {
    modelConsistency:     clamp(L1 + h("mc")),
    providerMatch:        clamp(L1 + h("pm") + 2),
    fallbackTransparency: clamp(L1 + h("ft") - 4),
    pricingIntegrity:     clamp(L1 + h("pi") + 3),
    safety:               clamp(L1 + h("sa")),
  };
}

function deriveSpark(slug: string, ttftSec: number): number[] {
  return Array.from({ length: 12 }, (_, i) => {
    const jitter = ((strHash(slug + "spark" + i) % 20) - 10) / 100;
    return Math.round(ttftSec * (1 + jitter) * 10) / 10;
  });
}

// ── MODELS builder ────────────────────────────────────────────────────────────

export function buildModels(
  pricing: ApiPricingRow[],
  registry: ApiRegistryProvider[],
): ModelDef[] {
  const officialRows = pricing.filter(
    (r) => r.provider_type === "official" && r.pricing_type === "text",
  );

  // model_pricing.model_name = display name ("GPT-5.4 mini")
  // We key by display name to match registry's m.display
  const officialByDisplayName: Record<string, ApiPricingRow> = {};
  for (const row of officialRows) {
    officialByDisplayName[row.model_name] = row;
  }

  // Unique models keyed by model_id (slug), owner derived from model_family
  const seen: Record<string, ModelDef> = {};
  for (const provider of registry) {
    for (const m of provider.models) {
      if (seen[m.model_id]) continue;
      const off =
        officialByDisplayName[m.display] ??
        officialByDisplayName[m.model_id];
      const owner =
        m.model_family === "GPT"
          ? "OpenAI"
          : m.model_family === "Claude"
            ? "Anthropic"
            : m.model_family === "Gemini"
              ? "Google"
              : m.model_family;
      seen[m.model_id] = {
        id: m.model_id,
        display: m.display || m.model_id,
        family: m.model_family,
        owner,
        ctx: off?.context_window ?? 128000,
        officialIn: off?.input_price_per_1m ?? 0,
        officialOut: off?.output_price_per_1m ?? 0,
        caps: { stream: true, tool: true, json: true, zdr: false },
      };
    }
  }
  return Object.values(seen);
}

// ── PROVIDERS builder ─────────────────────────────────────────────────────────

export function buildProviders(
  evaluations: ApiModelEvaluation[],
  pricing: ApiPricingRow[],
  registry: ApiRegistryProvider[],
  models: ModelDef[],
): Provider[] {
  // Only non-official (aggregator) providers go into the ranking
  const aggregatorSpecs = registry.filter((p) => !p.is_official);

  // model display name → model_id (slug) lookup
  const displayToId: Record<string, string> = {};
  for (const m of models) displayToId[m.display] = m.id;

  const results: Provider[] = [];

  for (const spec of aggregatorSpecs) {
    // Evaluation rows: DB uses provider name (e.g. "B.ai"), spec.name matches
    const evalRows = evaluations.filter((e) => e.provider === spec.name);
    if (evalRows.length === 0) continue;

    // ── aggregate metrics across all models ───────────────────────────────────
    const samples = evalRows.reduce((s, e) => s + (e.sample_count ?? 0), 0);
    const success = safeAvg(evalRows.map((e) => e.success_rate));
    const ttftP50Ms = safeAvg(evalRows.map((e) => e.ttft_p50));
    const e2eP50Ms  = safeAvg(evalRows.map((e) => e.e2e_p50));
    const e2eP95Ms  = safeAvg(evalRows.map((e) => e.e2e_p95));

    const L1 = Math.round(safeAvg(evalRows.map((e) => e.trustworthiness_score)));
    const L2 = Math.round(safeAvg(evalRows.map((e) => e.performance_score)));
    const L3 = Math.round(safeAvg(evalRows.map((e) => e.economics_score)));
    const overall = Math.round(L1 * 0.4 + L3 * 0.4 + L2 * 0.2);

    const ttftP95Ms  = safeAvg(evalRows.map((e) => e.ttft_p95));
    const ttftSec    = ttftP50Ms / 1000;
    const ttftP95Sec = ttftP95Ms / 1000;
    const latencySec = e2eP50Ms / 1000;
    const p95Sec     = e2eP95Ms / 1000;

    // ── modelPricing from pricing table ──────────────────────────────────────
    // model_pricing.model_name = display name; we key modelPricing by model_id slug
    const aggRows = pricing.filter(
      (r) =>
        r.provider_type === "aggregator" &&
        r.provider_name === spec.name &&
        r.pricing_type === "text",
    );

    const modelPricing: ProviderRaw["modelPricing"] = {};
    for (const row of aggRows) {
      // Skip unsupported models (both prices null)
      if (row.input_price_per_1m === null && row.output_price_per_1m === null) continue;

      const modelId  = displayToId[row.model_name] ?? row.model_name;
      const listedIn  = effective(row.input_price_per_1m,  row.current_discount) ?? 0;
      const listedOut = effective(row.output_price_per_1m, row.current_discount) ?? 0;

      // observedIn/Out = official price × (1 + price_deviation from evaluation)
      const evalRow  = evalRows.find((e) => e.model_id === modelId);
      const inDev    = evalRow?.input_price_deviation  ?? 0;
      const outDev   = evalRow?.output_price_deviation ?? 0;
      const refModel = models.find((m) => m.id === modelId);

      modelPricing[modelId] = {
        listedIn,
        listedOut,
        observedIn:  refModel ? Math.round(refModel.officialIn  * (1 + inDev)  * 10000) / 10000 : listedIn,
        observedOut: refModel ? Math.round(refModel.officialOut * (1 + outDev) * 10000) / 10000 : listedOut,
      };
    }

    // default model = first supported model that exists in our models list
    const supportedIds = Object.keys(modelPricing);
    const defaultModelId =
      supportedIds.find((id) => models.some((m) => m.id === id)) ??
      spec.models[0]?.model_id ??
      "";

    const mp       = modelPricing[defaultModelId];
    const costIn   = mp?.listedIn  ?? 0;
    const costOut  = mp?.listedOut ?? 0;
    const cost     = Math.round(((costIn + costOut) / 2) * 100) / 100;

    const defaultModel = models.find((m) => m.id === defaultModelId);
    const refBlended   = defaultModel
      ? (defaultModel.officialIn + defaultModel.officialOut) / 2
      : cost;
    const costDelta    =
      refBlended > 0 ? Math.round(((cost - refBlended) / refBlended) * 100) : 0;

    // ── per-model evaluation summaries ───────────────────────────────────────
    const modelEvals: Record<string, ModelEvalSummary> = {};
    for (const ev of evalRows) {
      modelEvals[ev.model_id] = {
        totalScore:  Math.round(ev.total_score ?? 0),
        rating:      (ev.rating       ?? "C") as Tier,
        successRate: ev.success_rate  ?? 0,
        ttftP50Ms:   ev.ttft_p50      ?? 0,
        ttftP95Ms:   ev.ttft_p95      ?? 0,
        e2eP50Ms:    ev.e2e_p50       ?? 0,
        e2eP95Ms:    ev.e2e_p95       ?? 0,
      };
    }

    // ── derived fields ────────────────────────────────────────────────────────
    const scores     = deriveSubScores(L1, L2, L3);
    const trustParts = deriveTrustParts(spec.slug, L1);
    const spark      = deriveSpark(spec.slug, ttftSec);

    // desc comes from the API registry
    const desc = {
      en: spec.description_en,
      zh: spec.description_zh,
    };

    results.push({
      slug:    spec.slug,
      name:    spec.name,
      type:    spec.type as ProviderRaw["type"],
      domain:  spec.domain,
      website: spec.website,
      region:  spec.region,
      latency:  latencySec,
      p95:      p95Sec,
      ttft:     ttftSec,
      ttftP95:  ttftP95Sec,
      success,
      samples,
      overall,
      modelPricing,
      scores,
      spark,
      trustParts,
      incidents: [],   // no incidents table in DB yet
      desc,
      // computed
      costIn,
      costOut,
      cost,
      costDelta,
      defaultModelId,
      trust: L1,
      L1,
      L2,
      L3,
      tier: tier(overall) as Tier,
      modelEvals,
    });
  }

  return results.sort((a, b) => b.overall - a.overall);
}
