/**
 * PROTOTYPE — throwaway. Floating bottom bar that cycles `?variant=` on the
 * current route. Never rendered in production builds.
 */

import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export interface PrototypeVariant {
  key: string;
  name: string;
}

interface PrototypeSwitcherProps {
  variants: PrototypeVariant[];
  current: string;
  /** Search params to drop when switching (e.g. an open-detail param). */
  resetParams?: string[];
}

export function PrototypeSwitcher({ variants, current, resetParams = [] }: PrototypeSwitcherProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const index = Math.max(0, variants.findIndex((v) => v.key === current));

  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams);
    params.set("variant", next.key);
    for (const p of resetParams) params.delete(p);
    setSearchParams(params, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-1 rounded-full bg-gray-900 text-white shadow-2xl border border-white/10 pl-1 pr-1 py-1"
      style={{ fontFamily: "Geist Mono, ui-monospace, monospace" }}
      role="toolbar"
      aria-label="Prototype variant switcher"
    >
      <button onClick={() => go(-1)} className="w-8 h-8 rounded-full hover:bg-white/10 text-base" aria-label="Previous variant">←</button>
      <div className="px-2 text-[12px] whitespace-nowrap">
        <span className="text-amber-300 font-bold mr-2">PROTOTYPE</span>
        <span className="font-bold">{variants[index].key}</span>
        <span className="text-white/60"> — {variants[index].name}</span>
        <span className="text-white/40 ml-2">{index + 1}/{variants.length}</span>
      </div>
      <button onClick={() => go(1)} className="w-8 h-8 rounded-full hover:bg-white/10 text-base" aria-label="Next variant">→</button>
    </div>
  );
}
