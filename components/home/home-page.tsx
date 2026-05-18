"use client";

import { useLang } from "@/lib/contexts/lang";
import { Hero } from "./hero";
import { RankingSection } from "./ranking-section";

export function HomePage() {
  const { t } = useLang();

  return (
    <>
      <Hero />
      <RankingSection />

      {/* Insights rail */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 mt-32">
        <div className="grid md:grid-cols-3 gap-px bg-ink-600">
          <Insight
            tag={t("insights.costTag")}
            title={t("insights.costTitle")}
            body={t("insights.costBody")}
            stat={{ label: t("insights.costStat"), value: "14", tone: "amber" }}
          />
          <Insight
            tag={t("insights.trustTag")}
            title={t("insights.trustTitle")}
            body={t("insights.trustBody")}
            stat={{ label: t("insights.trustStat"), value: "6.2%", tone: "coral" }}
          />
          <Insight
            tag={t("insights.payTag")}
            title={t("insights.payTitle")}
            body={t("insights.payBody")}
            stat={{ label: t("insights.payStat"), value: "38%", tone: "brand" }}
          />
        </div>
      </section>
    </>
  );
}

function Insight({
  tag,
  title,
  body,
  stat,
}: {
  tag: string;
  title: string;
  body: string;
  stat: { label: string; value: string; tone: "brand" | "amber" | "coral" };
}) {
  const toneColor = {
    brand: "text-brand",
    amber: "text-amber",
    coral: "text-coral",
  }[stat.tone];
  return (
    <div className="bg-ink p-5 sm:p-6 lg:p-8 group hover:bg-ink-800 transition-colors">
      <div className="micro text-smoke">{tag}</div>
      <h3 className="serif text-3xl tracking-editorial mt-3 leading-tight">{title}</h3>
      <p className="mt-4 text-[14px] text-ash leading-relaxed">{body}</p>
      <div className="mt-8 pt-5 border-t border-ink-600 flex items-baseline justify-between">
        <span className="micro text-smoke">{stat.label}</span>
        <span className={`serif text-4xl tracking-editorial ${toneColor}`}>
          {stat.value}
        </span>
      </div>
    </div>
  );
}
