// Core domain types for GatewayBench / Check4U

export type ProviderType = "router" | "gateway" | "inference" | "self_host";

export type Severity = "low" | "medium" | "high";

export type Tier = "AAA" | "AA" | "A" | "B" | "C";

export type TierTone = "brand" | "amber" | "coral" | "smoke";

export interface SubScores {
  L1: { modelAuth: number; billingTrans: number; cacheFraud: number };
  L2: { latency: number; throughput: number; longContext: number };
  L3: { listPricing: number; relativeToOfficial: number; hiddenCost: number };
}

export interface TrustParts {
  modelConsistency: number;
  providerMatch: number;
  fallbackTransparency: number;
  pricingIntegrity: number;
  safety: number;
}

export interface Incident {
  time: string;
  issue: string;
  sev: Severity;
  dim?: string;
  duration?: string;
  affectedModels?: string[];
}

export interface ModelPricingEntry {
  listedIn: number;
  listedOut: number;
  observedIn: number;
  observedOut: number;
}

export interface ModelEvalSummary {
  totalScore: number;
  rating: Tier;
  successRate: number;
  ttftP50Ms: number;
  ttftP95Ms: number;
  e2eP50Ms: number;
  e2eP95Ms: number;
}

export interface ProviderRaw {
  slug: string;
  name: string;
  type: ProviderType;
  domain: string | null;
  website: string | null;
  region: string;
  latency: number;
  p95: number;
  ttft: number;
  ttftP95: number;
  success: number;
  samples: number;
  overall: number;
  modelPricing: Record<string, ModelPricingEntry>;
  scores: SubScores;
  spark: number[];
  trustParts: TrustParts;
  incidents: Incident[];
  desc: string | { en: string; zh: string };
  // Legacy optional fields (kept for backward compat with sub-components)
  crypto?: boolean;
  walletPay?: boolean;
  ref?: number;
  volume7d?: number;
  costIn?: number;
  costOut?: number;
  costDelta?: number;
}

export interface Provider extends ProviderRaw {
  costIn: number;
  costOut: number;
  cost: number;
  costDelta: number;
  defaultModelId: string;
  trust: number;
  L1: number;
  L2: number;
  L3: number;
  tier: Tier;
  modelEvals: Record<string, ModelEvalSummary>;
}

export interface ModelDef {
  id: string;
  display: string;
  family: string;
  owner: string;
  ctx: number;
  officialIn: number;
  officialOut: number;
  caps: { stream: boolean; tool: boolean; json: boolean; zdr: boolean };
}

export interface BenchmarkTemplate {
  id: string;
  label: string;
  prompt: string;
}

export type BenchmarkKind =
  | "default"
  | "reasoning"
  | "coding"
  | "math"
  | "long"
  | "json"
  | "safety"
  | "multi";

export interface FingerprintFlag {
  kind: string;
  headline: string;
  detail: string;
}

export interface FingerprintResult {
  unsupported?: boolean;
  reason?: string;
  flag?: FingerprintFlag | null;
  score: number;
  samples: number;
  embedDist: number;
  lengthKsP: number;
  tokenizer: { observed: string; expected: string; match: boolean };
  precision: "FP16" | "Q8" | "Q4" | string;
  refusalDelta: number;
  firstSeen?: boolean;
}

export interface RunStatusRow {
  slug: string;
  status: "pending" | "running" | "completed" | "failed";
  startAt?: number;
  completeAt?: number;
  latency?: number;
  ttft?: number;
  cost?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  response?: string | null;
  error?: string | null;
  scores?: { L1: number; L2: number; L3: number; overall: number; tier: Tier };
}

export interface RunState {
  id: string;
  prompt: string;
  promptPreview: string;
  benchmark: BenchmarkKind;
  modelId: string;
  modelDisplay: string;
  mode: "single" | "compare";
  providers: RunStatusRow[];
}

export interface Wallet {
  address: string;
  full: string;
  balance: number;
  chain: string;
}
