"use client";

import Link from "next/link";
import { useLang } from "@/lib/contexts/lang";
import { cx } from "@/lib/utils";

function Logo({ className = "" }: { className?: string }) {
  const { t } = useLang();
  return (
    <Link href="/" className={cx("flex items-center gap-2 group", className)}>
      <div className="relative">
        <svg viewBox="0 0 32 32" className="w-7 h-7">
          <rect x="2" y="2" width="28" height="28" stroke="currentColor" strokeWidth="1" fill="none" />
          <path
            d="M8 22 L8 10 L20 10 M20 10 L26 16 L20 22 M14 16 L24 16"
            stroke="currentColor"
            strokeWidth="1.25"
            fill="none"
            strokeLinecap="square"
          />
        </svg>
        <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-brand rounded-full pulse-dot" />
      </div>
      <div className="leading-none">
        <div className="serif text-[22px] tracking-editorial">RouterRank</div>
        <div className="micro text-smoke mt-0.5">{t("header.tagline")}</div>
      </div>
    </Link>
  );
}

export function Footer() {
  const { t } = useLang();

  return (
    <footer className="mt-32 border-t border-ink-600">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-12 grid md:grid-cols-4 gap-8">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-6 text-ash text-sm max-w-md leading-relaxed">
            {t("footer.tagline")}
          </p>
          <div className="mt-6 flex items-center gap-3 micro text-smoke">
            <span>{t("footer.lastRefresh")}</span>
            <span className="num text-ash text-[11px]">2026-05-05 · 14:04 UTC</span>
            <span className="w-1 h-1 bg-brand rounded-full pulse-dot" />
          </div>
        </div>
        <div>
          <div className="micro text-smoke mb-4">{t("footer.productHeading")}</div>
          <ul className="space-y-2 text-sm text-ash">
            <li><Link href="/" className="ulink">{t("footer.linkRanking")}</Link></li>
            <li><Link href="/run" className="ulink">{t("footer.linkRun")}</Link></li>
            <li><Link href="/validate" className="ulink">{t("footer.linkValidate")}</Link></li>
            <li><Link href="/docs" className="ulink">{t("footer.linkApiSdk")}</Link></li>
          </ul>
        </div>
        <div>
          <div className="micro text-smoke mb-4">{t("footer.methodologyHeading")}</div>
          <ul className="space-y-2 text-sm text-ash">
            <li><Link href="/docs" className="ulink">{t("footer.mTrust")}</Link></li>
            <li><Link href="/docs" className="ulink">{t("footer.mCost")}</Link></li>
            <li><Link href="/docs" className="ulink">{t("footer.mSampling")}</Link></li>
            <li><Link href="/docs" className="ulink">{t("footer.mIntegrity")}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink-600">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-3">
          <p className="text-[11px] text-smoke leading-relaxed max-w-3xl">
            {t("footer.disclaimer")}
          </p>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <span className="micro text-smoke">{t("footer.copyright")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
