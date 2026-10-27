"use client";
import { useEffect, useState } from "react";
import { X, Gauge, Info, Check, Loader2, XCircle } from "lucide-react";
import {
  MODELS_WITH_FALLBACK,
  API_LIMITATIONS,
  ENDPOINTS,
} from "@/lib/api/config";
import { useFallbackStatus } from "@/lib/hooks/useModelCatalog";
import type { ModelId } from "@/lib/types";
import { cn } from "@/lib/utils/cn";

type Health = {
  status: "loading" | "operational" | "degraded" | "degraded-with-fallback";
  checkedAt?: string;
  text?: { reachable: boolean; latency: number };
  image?: { reachable: boolean; latency: number };
  fallbackEnabled?: boolean;
};

export function ContextPanel({
  modelId,
  onClose,
  conversationTitle,
  messageCount,
}: {
  modelId: ModelId;
  onClose: () => void;
  conversationTitle?: string;
  messageCount: number;
}) {
  const model =
    MODELS_WITH_FALLBACK.find((m) => m.id === modelId) ??
    MODELS_WITH_FALLBACK[0];
  const fallback = useFallbackStatus();
  const [health, setHealth] = useState<Health>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setHealth({
          status: d.status,
          checkedAt: d.checkedAt,
          text: d.services?.text,
          image: d.services?.image,
          fallbackEnabled: !!d.fallback?.enabled,
        });
      })
      .catch(() => !cancelled && setHealth({ status: "degraded" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = [
    { label: "Text models", ok: true },
    { label: "Image generation", ok: true },
    { label: "Image editing", ok: true },
    { label: "Image → video", ok: true },
    { label: "Auto fallback", ok: fallback.enabled },
    { label: "Vision analysis", ok: fallback.vision },
    { label: "Streaming", ok: false },
  ];

  return (
    <aside
      aria-label="Workspace"
      className="hidden w-[300px] shrink-0 flex-col border-l border-[rgba(148,163,184,0.12)] bg-[#F7FAFF]/60 dark:bg-[#0B1220]/50 backdrop-blur-xl xl:flex"
    >
      <div className="flex items-center justify-between border-b border-[rgba(148,163,184,0.12)] px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#94A3B8]">
          Workspace
        </h3>
        <button
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[#94A3B8]"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {/* Model */}
        <div className="rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white p-4 dark:bg-[#101827]">
          <div className="flex items-center gap-2">
            <span className="text-xl">{model.icon}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{model.name}</p>
              <p className="text-xs text-[#94A3B8]">{model.provider}</p>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[#94A3B8]">
            {model.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {model.capabilities.map((c) => (
              <span
                key={c}
                className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-medium text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]"
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Conversation info */}
        {conversationTitle && (
          <div className="rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white p-4 dark:bg-[#101827]">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
              Conversation
            </p>
            <p className="mt-1.5 line-clamp-2 text-sm font-medium">
              {conversationTitle}
            </p>
            <p className="mt-1 text-xs text-[#94A3B8]">
              {messageCount} messages
            </p>
          </div>
        )}

        {/* Generation params */}
        <div className="rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white p-4 dark:bg-[#101827]">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
            <Gauge className="h-3.5 w-3.5" /> Runtime limits
          </p>
          <dl className="space-y-2 text-xs">
            {[
              [
                "Max prompt",
                `${API_LIMITATIONS.maxPromptLength.toLocaleString()} chars`,
              ],
              ["Timeout", `${API_LIMITATIONS.timeout / 1000}s`],
              ["Retries", `${API_LIMITATIONS.retries}`],
              ["Context window", "Last 6 messages"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-[#94A3B8]">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Capabilities */}
        <div className="rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white p-4 dark:bg-[#101827]">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
            Capabilities
          </p>
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li
                key={r.label}
                className="flex items-center justify-between text-xs"
              >
                <span className={r.ok ? "" : "text-[#94A3B8]"}>{r.label}</span>
                {r.ok ? (
                  <Check className="h-3.5 w-3.5 text-[#22C55E]" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-[#94A3B8]/60" />
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Health */}
        <div className="rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white p-4 dark:bg-[#101827]">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
            <Info className="h-3.5 w-3.5" /> Service status
          </p>
          {health.status === "loading" ? (
            <p className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking
              upstream…
            </p>
          ) : (
            <div className="space-y-2">
              <StatusLine
                label="Text API"
                reachable={!!health.text?.reachable}
                latency={health.text?.latency}
              />
              <StatusLine
                label="Image API"
                reachable={!!health.image?.reachable}
                latency={health.image?.latency}
              />
              <p className="pt-1 text-[11px] leading-relaxed text-[#94A3B8]">
                Server-side probe of{" "}
                <span className="font-mono">
                  {new URL(ENDPOINTS.chat.llama).host}
                </span>
                , cached for 60s.
                {health.checkedAt
                  ? ` Last checked ${new Date(health.checkedAt).toLocaleTimeString()}.`
                  : ""}
              </p>
              <div className="mt-1 flex items-center justify-between rounded-xl border border-[rgba(148,163,184,0.16)] px-2.5 py-2">
                <span className="flex items-center gap-2 text-[11px]">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      fallback.enabled ? "bg-[#22C55E]" : "bg-[#94A3B8]/50",
                    )}
                  />
                  Agnes AI fallback
                </span>
                <span className="text-[11px] text-[#94A3B8]">
                  {fallback.enabled ? "configured" : "needs AGNES_API_KEY"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function StatusLine({
  label,
  reachable,
  latency,
}: {
  label: string;
  reachable: boolean;
  latency?: number;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            reachable ? "bg-[#22C55E]" : "bg-[#EF4444]",
          )}
        />
        {label}
      </span>
      <span className="text-[#94A3B8]">
        {reachable ? `${latency ?? 0}ms` : "unreachable"}
      </span>
    </div>
  );
}
