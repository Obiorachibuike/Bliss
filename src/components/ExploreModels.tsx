"use client";
import { useMemo, useState } from "react";
import { Search, Check, Sparkles, Image as ImageIcon, Film, Menu, EyeOff, ArrowRight } from "lucide-react";
import { MODELS, IMAGE_MODELS, VIDEO_MODELS, ENDPOINTS, API_LIMITATIONS } from "@/lib/api/config";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/ui/Toast";

const GROUPS = [
  { id: "general", label: "General chat" },
  { id: "reasoning", label: "Reasoning" },
  { id: "coding", label: "Coding" },
  { id: "image", label: "Image generation" },
  { id: "vision", label: "Vision" },
];

export function ExploreModels({
  onOpenMobileNav,
  onUseChat,
  onUseImage,
}: {
  onOpenMobileNav: () => void;
  onUseChat: () => void;
  onUseImage: () => void;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("all");
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const defaultModel = useSettingsStore((s) => s.defaultModel);

  const cards = useMemo(() => {
    const all = [
      ...MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        description: m.description,
        capabilities: m.capabilities,
        endpoint: m.endpoint,
        kind: "text" as const,
        icon: m.icon,
        available: true,
        groups: m.capabilities.map((c: string) =>
          c.toLowerCase().includes("code") ? "coding" : c.toLowerCase().includes("reason") ? "reasoning" : "general"
        ) as string[],
      })),
      ...IMAGE_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        description: m.description,
        capabilities: m.capabilities,
        endpoint: m.endpoint,
        kind: "image" as const,
        icon: "🎨",
        available: m.available,
        groups: ["image"],
      })),
      ...VIDEO_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        description: m.description,
        capabilities: m.capabilities,
        endpoint: m.endpoint,
        kind: "video" as const,
        icon: "🎬",
        available: m.available,
        groups: ["image"],
      })),
    ];
    return all.filter((m) => {
      const matchQ =
        !q.trim() ||
        m.name.toLowerCase().includes(q.toLowerCase()) ||
        m.provider.toLowerCase().includes(q.toLowerCase()) ||
        m.capabilities.join(" ").toLowerCase().includes(q.toLowerCase());
      const matchG = group === "all" || m.groups.includes(group);
      return matchQ && matchG;
    });
  }, [q, group]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[rgba(148,163,184,0.12)] px-3 sm:px-5">
        <button onClick={onOpenMobileNav} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-[#2563EB]" /> Explore Models
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">Verified against the FreeAiAPIs repository</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search models, providers or capabilities…"
              className="h-11 w-full rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white pl-10 pr-4 text-sm outline-none transition focus:ring-2 focus:ring-[#2563EB]/20 dark:bg-[#101827]"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Chip active={group === "all"} onClick={() => setGroup("all")}>All</Chip>
            {GROUPS.map((g) => (
              <Chip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)} disabled={g.id === "vision"}>
                {g.label}
              </Chip>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {cards.map((m, i) => (
              <Card key={`${m.kind}-${m.id}`} className="animate-fade-up group relative overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-20px_rgba(37,99,235,0.5)]" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.14),transparent_70%)]" />
                <CardContent className="relative space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#EFF6FF] text-lg dark:bg-[#2563EB]/15">{m.icon}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{m.name}</p>
                        {m.kind === "text" && defaultModel === m.id && (
                          <span className="flex items-center gap-1 rounded-full bg-[#22C55E]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#16A34A]">
                            <Check className="h-2.5 w-2.5" /> Default
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#94A3B8]">{m.provider}</p>
                    </div>
                    <Badge className="shrink-0">{m.kind}</Badge>
                  </div>

                  <p className="line-clamp-2 text-xs leading-relaxed text-[#94A3B8]">{m.description}</p>

                  <div className="flex flex-wrap gap-1.5">
                    {m.capabilities.map((c) => (
                      <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-white/10 dark:text-slate-300">{c}</span>
                    ))}
                  </div>

                  <code className="block truncate rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[10px] text-[#94A3B8] dark:bg-white/5">{m.endpoint.replace("https://", "")}</code>

                  <div className="flex items-center gap-2 pt-1">
                    {m.kind === "text" && (
                      <>
                        <Button size="sm" onClick={() => { setDefaultModel(m.id as never); onUseChat(); toast.success(`${m.name} is now your default model`); }}>
                          Use in chat
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onUseChat()}>
                          Try <ArrowRight className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                    {m.kind === "image" && (
                      <Button size="sm" onClick={onUseImage}>
                        <ImageIcon className="h-3.5 w-3.5" /> Open Image Studio
                      </Button>
                    )}
                    {m.kind === "video" && (
                      <Button size="sm" onClick={onUseImage}>
                        <Film className="h-3.5 w-3.5" /> Open Video Studio
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Unsupported */}
          <Card className="border-dashed bg-slate-50/60 dark:bg-white/[0.02]">
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-200/70 text-slate-500 dark:bg-white/10">
                <EyeOff className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Not supported by this provider</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#94A3B8]">
                  Vision / image analysis, text-to-video, function calling and streaming are not documented at
                  the CVRON free API, so Bliss doesn&rsquo;t fake them. Native conversation context is also unavailable —
                  Bliss builds a compact prompt digest from your last {6} messages instead.
                </p>
              </div>
              <code className="rounded-lg bg-white px-2 py-1 font-mono text-[10px] text-[#94A3B8] dark:bg-[#101827]">
                max {API_LIMITATIONS.maxPromptLength} chars
              </code>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Chip({ children, active, onClick, disabled }: { children: React.ReactNode; active?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        disabled && "cursor-not-allowed opacity-40",
        active ? "border-transparent brand-gradient text-white shadow-sm" : "hover:bg-slate-50 dark:hover:bg-white/5"
      )}
      title={disabled ? "No verified vision endpoint exists" : undefined}
    >
      {children}
    </button>
  );
}

export const EXPLORER_ENDPOINTS = ENDPOINTS;
