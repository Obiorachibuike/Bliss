"use client";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  Search,
  Check,
  ChevronDown,
  Zap,
  Brain,
  Code2,
  Eye,
  ShieldCheck,
} from "lucide-react";
import type { ModelId } from "@/lib/types";
import { useFallbackStatus, useTextModels } from "@/lib/hooks/useModelCatalog";

export function ModelSelector({
  value,
  onChange,
}: {
  value: ModelId;
  onChange: (m: ModelId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const MODELS = useTextModels();
  const fallback = useFallbackStatus();
  const selected = MODELS.find((m) => m.id === value) || MODELS[0];
  const filtered = MODELS.filter(
    (m) =>
      m.name.toLowerCase().includes(q.toLowerCase()) ||
      m.provider.toLowerCase().includes(q.toLowerCase()),
  );

  const capIcon = (cap: string) => {
    if (cap.toLowerCase().includes("code"))
      return <Code2 className="w-3 h-3" />;
    if (cap.toLowerCase().includes("reason"))
      return <Brain className="w-3 h-3" />;
    if (cap.toLowerCase().includes("vision"))
      return <Eye className="w-3 h-3" />;
    return <Zap className="w-3 h-3" />;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl border border-[rgba(148,163,184,0.16)] bg-white dark:bg-[#101827] px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 dark:hover:bg-white/5 min-w-[200px]"
      >
        <span className="text-base leading-none">{selected.icon}</span>
        <span className="flex-1 text-left truncate">{selected.name}</span>
        <span className="hidden sm:inline text-xs text-[#94A3B8]">
          {selected.provider}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-[#94A3B8] transition",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-2 left-0 w-[360px] max-w-[90vw] rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white dark:bg-[#101827] shadow-xl z-50 overflow-hidden">
            <div className="p-3 border-b border-[rgba(148,163,184,0.12)]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
                <input
                  autoFocus
                  placeholder="Search models..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-[rgba(148,163,184,0.16)] bg-slate-50 dark:bg-[#0B1220] text-sm outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                />
              </div>
              <p className="text-xs text-[#94A3B8] mt-2">
                {MODELS.length} verified models •{" "}
                {fallback.enabled
                  ? "fallback provider active"
                  : "no API key needed"}
              </p>
            </div>

            <div className="p-2 max-h-[360px] overflow-auto space-y-1">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full flex gap-3 p-3 rounded-xl text-left transition border",
                    value === m.id
                      ? "bg-[linear-gradient(135deg,#2563EB_0%,#3B82F6_45%,#60A5FA_100%)] text-white border-transparent shadow-md"
                      : "hover:bg-slate-50 dark:hover:bg-white/5 border-transparent",
                  )}
                >
                  <span className="text-xl">{m.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{m.name}</span>
                      <span
                        className={cn(
                          "text-xs px-1.5 py-0.5 rounded-full font-medium",
                          value === m.id
                            ? "bg-white/20 text-white"
                            : "bg-slate-100 dark:bg-white/10 text-slate-500",
                        )}
                      >
                        {m.provider}
                      </span>
                      {m.fallback && (
                        <span
                          className={cn(
                            "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                            value === m.id
                              ? "bg-white/20 text-white"
                              : "bg-[#22C55E]/10 text-[#16A34A] dark:text-[#4ADE80]",
                          )}
                        >
                          <ShieldCheck className="h-2.5 w-2.5" /> fallback
                        </span>
                      )}
                      {value === m.id && <Check className="w-4 h-4 ml-auto" />}
                    </div>
                    <p
                      className={cn(
                        "text-xs mt-0.5 line-clamp-1",
                        value === m.id ? "text-white/80" : "text-[#94A3B8]",
                      )}
                    >
                      {m.description}
                    </p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {m.capabilities.map((c) => (
                        <span
                          key={c}
                          className={cn(
                            "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium",
                            value === m.id
                              ? "bg-white/20 text-white"
                              : "bg-[#EFF6FF] dark:bg-[#2563EB]/20 text-[#2563EB] dark:text-[#60A5FA]",
                          )}
                        >
                          {capIcon(c)} {c}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-center py-6 text-[#94A3B8]">
                  No models found
                </p>
              )}
            </div>

            <div className="p-3 bg-slate-50 dark:bg-white/5 border-t border-[rgba(148,163,184,0.12)]">
              <p className="text-xs text-[#94A3B8]">
                {fallback.enabled
                  ? "If a key-less model fails after its retries, Bliss automatically falls back to Agnes AI with your real conversation turns. Pick an Agnes model to always use it."
                  : "Bliss adapts your history into a single prompt because the key-less upstreams accept only one prompt. Set AGNES_API_KEY to unlock the Agnes fallback and native multi-turn context."}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
