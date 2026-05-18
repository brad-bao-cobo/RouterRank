import type { Tier } from "@/lib/types";
import { cx } from "@/lib/utils";

const CLS: Record<Tier, string> = {
  AAA: "bg-brand text-ink",
  AA:  "border border-brand text-brand",
  A:   "border border-amber text-amber",
  B:   "border border-coral text-coral",
  C:   "bg-coral text-bone",
};

export function TierChip({
  tier,
  size = "sm",
}: {
  tier: Tier;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center num font-semibold tracking-wider",
        CLS[tier],
        size === "lg" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-[10px]",
      )}
    >
      {tier}
    </span>
  );
}
