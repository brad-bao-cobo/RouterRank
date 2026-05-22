"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/contexts/lang";
import { useTheme } from "@/lib/contexts/theme";
import { useData } from "@/lib/contexts/data";
import { cx } from "@/lib/utils";

export function Header() {
  const pathname = usePathname() || "/";
  const { theme, toggle: toggleTheme } = useTheme();
  const { lang, toggle: toggleLang, t } = useLang();
  const { totalSamples } = useData();
  const [menuOpen, setMenuOpen] = useState(false);

  const navs = [
    { key: "ranking",  path: "/",        label: t("nav.ranking") },
    { key: "run",      path: "/run",      label: t("nav.run") },
    { key: "validate", path: "/validate", label: t("nav.validate") },
    { key: "docs",     path: "/docs",     label: t("nav.docs") },
  ];

  // Close drawer on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const themeTarget = theme === "dark" ? t("header.lightWord") : t("header.darkWord");

  return (
    <header className="sticky top-0 z-40 border-b border-ink-600 bg-ink/85 backdrop-blur-md">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
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
            <div className="serif text-[22px] tracking-editorial">Check4U</div>
            <div className="micro text-smoke mt-0.5">{t("header.tagline")}</div>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navs.map((n) => {
            const active =
              (n.path === "/" && pathname === "/") ||
              (n.path !== "/" && pathname.startsWith(n.path));
            return (
              <Link
                key={n.key}
                href={n.path}
                className={cx(
                  "relative px-4 py-1.5 text-[13px] tracking-tight transition-colors",
                  active ? "text-bone" : "text-ash hover:text-bone",
                )}
              >
                {n.label}
                {active && (
                  <span className="absolute left-4 right-4 bottom-0 h-px bg-brand" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden lg:inline-flex items-center gap-1.5 text-[11px] text-smoke">
            <span className="w-1.5 h-1.5 bg-brand rounded-full pulse-dot" />
            <span className="micro text-ash">
              {t("header.ticker", { n: totalSamples.toLocaleString() })}
            </span>
          </span>
          <button
            onClick={toggleLang}
            aria-label={t("header.switchLang")}
            title={t("header.switchLang")}
            className="h-8 px-2 shrink-0 inline-flex items-center justify-center border border-ink-500 hover:border-bone text-ash hover:text-bone transition-colors text-[11px] tracking-wider num"
          >
            {lang === "zh" ? "EN" : "中"}
          </button>
          <button
            onClick={toggleTheme}
            aria-label={t("header.switchThemeTo", { target: themeTarget })}
            title={t("header.switchThemeTo", { target: themeTarget })}
            className="w-8 h-8 shrink-0 inline-flex items-center justify-center border border-ink-500 hover:border-bone text-ash hover:text-bone transition-colors"
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="menu"
            aria-expanded={menuOpen}
            className="md:hidden w-8 h-8 shrink-0 inline-flex items-center justify-center border border-ink-500 hover:border-bone text-ash hover:text-bone transition-colors"
          >
            {menuOpen ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="md:hidden border-t border-ink-600 bg-ink">
          <nav className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 flex flex-col">
            {navs.map((n) => {
              const active =
                (n.path === "/" && pathname === "/") ||
                (n.path !== "/" && pathname.startsWith(n.path));
              return (
                <Link
                  key={n.key}
                  href={n.path}
                  onClick={() => setMenuOpen(false)}
                  className={cx(
                    "py-3 border-b border-ink-600 last:border-0 text-[15px] tracking-tight flex items-center justify-between",
                    active ? "text-brand" : "text-bone",
                  )}
                >
                  <span>{n.label}</span>
                  {active && (
                    <span className="micro text-brand">
                      {lang === "zh" ? "当前" : "current"}
                    </span>
                  )}
                </Link>
              );
            })}
            <div className="mt-4 pt-4 border-t border-ink-600 flex items-center justify-between micro text-smoke">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-brand rounded-full pulse-dot" />
                {t("header.ticker", { n: totalSamples.toLocaleString() }).replace(/ · 24h$/, "")}
              </span>
              <span className="text-ash">
                {t("header.currentMode", {
                  lang: theme === "dark" ? t("header.darkWord") : t("header.lightWord"),
                })}
              </span>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
