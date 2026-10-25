"use client";
import { useEffect, useState } from "react";
import { Settings as SettingsIcon, Sun, Moon, Monitor, Trash2, Database, Shield, Info, Menu, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useTheme } from "@/components/layout/ThemeProvider";
import { useChatStore } from "@/lib/store/chatStore";
import { useSavedStore } from "@/lib/store/savedStore";
import { MODELS, IMAGE_MODELS, VIDEO_MODELS } from "@/lib/api/config";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import type { Theme } from "@/lib/types";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "brand-gradient" : "bg-slate-200 dark:bg-white/15")}
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[rgba(148,163,184,0.1)] py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[#94A3B8]">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsView({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const s = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const [status, setStatus] = useState<{ status: string; services?: Record<string, { reachable: boolean; latency: number }>; capabilities?: Record<string, boolean> } | null>(null);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  }, []);

  const themes: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
    { id: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
    { id: "system", label: "System", icon: <Monitor className="h-4 w-4" /> },
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[rgba(148,163,184,0.12)] px-3 sm:px-5">
        <button onClick={onOpenMobileNav} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <SettingsIcon className="h-4 w-4 text-[#2563EB]" /> Settings
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">Preferences are stored on this device</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
          {/* Appearance */}
          <Section title="Appearance" desc="Bliss follows your choice and remembers it between sessions.">
            <div className="grid grid-cols-3 gap-2 pb-2">
              {themes.map((t) => (
                <button key={t.id} onClick={() => setTheme(t.id)} className={cn("flex flex-col items-center gap-2 rounded-xl border p-4 text-xs font-medium transition", theme === t.id ? "border-[#2563EB]/40 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]" : "hover:bg-slate-50 dark:hover:bg-white/5")}>
                  <span className={cn("grid h-9 w-9 place-items-center rounded-xl", theme === t.id ? "brand-gradient text-white" : "bg-slate-100 dark:bg-white/10")}>{t.icon}</span>
                  {t.label}
                  {theme === t.id && <Check className="h-3 w-3" />}
                </button>
              ))}
            </div>
            <Row title="Collapse sidebar by default" desc="Start Bliss with the icon-only rail.">
              <Toggle label="Collapse sidebar" checked={s.sidebarCollapsed} onChange={s.setSidebar} />
            </Row>
            <Row title="Show context panel" desc="Model details and service status on wide screens (≥1280px).">
              <Toggle label="Context panel" checked={s.showContextPanel} onChange={s.setContextPanel} />
            </Row>
          </Section>

          {/* Chat */}
          <Section title="Chat" desc="How Bliss behaves when you write.">
            <div className="pb-2">
              <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Default model</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODELS.map((m) => (
                  <button key={m.id} onClick={() => s.setDefaultModel(m.id)} className={cn("flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs font-medium transition", s.defaultModel === m.id ? "border-[#2563EB]/40 bg-[#EFF6FF] dark:bg-[#2563EB]/15" : "hover:bg-slate-50 dark:hover:bg-white/5")}>
                    <span className="text-base">{m.icon}</span>
                    <span className="flex-1 truncate">{m.name}</span>
                    {s.defaultModel === m.id && <Check className="h-3.5 w-3.5 text-[#2563EB]" />}
                  </button>
                ))}
              </div>
            </div>
            <Row title="Enter sends the message" desc="When off, use Ctrl/Cmd + Enter to send. Shift + Enter always adds a newline.">
              <Toggle label="Enter to send" checked={s.enterToSend} onChange={s.setEnterToSend} />
            </Row>
            <Row title="Render Markdown" desc="Format replies with headings, tables and highlighted code. Turn off to see raw text.">
              <Toggle label="Markdown" checked={s.markdownRendering} onChange={s.setMarkdown} />
            </Row>
          </Section>

          {/* Generation */}
          <Section title="Generation" desc="Defaults used by the creative studios.">
            <Row title="Default image model" desc="Flux Dev is the only documented text-to-image endpoint.">
              <Badge className="gap-1"><Check className="h-3 w-3 text-[#22C55E]" /> {IMAGE_MODELS[0].name}</Badge>
            </Row>
            <Row title="Default video model" desc="WAN 2.2 accepts an image plus a motion prompt. Text-to-video is not offered.">
              <Badge className="gap-1"><Check className="h-3 w-3 text-[#22C55E]" /> {VIDEO_MODELS[0].name}</Badge>
            </Row>
            <Row title="Default aspect ratio" desc="Applied as a hint in the prompt — the provider always returns its own canvas size.">
              <select value={s.defaultImageAspect} onChange={(e) => useSettingsStore.setState({ defaultImageAspect: e.target.value })} className="h-9 rounded-xl border border-[rgba(148,163,184,0.16)] bg-white px-2 text-xs dark:bg-[#0B1220]">
                {["1:1", "16:9", "9:16", "4:3"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </Row>
          </Section>

          {/* Privacy */}
          <Section title="Privacy & data" desc="What Bliss keeps, and what leaves this device.">
            <div className="space-y-2 pb-3 text-xs leading-relaxed text-[#94A3B8]">
              <p className="flex gap-2"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2563EB]" /> Stored in this browser only: conversations, saved items, generated media references and preferences (localStorage keys beginning with <code className="rounded bg-slate-100 px-1 dark:bg-white/10">bliss-</code>).</p>
              <p className="flex gap-2"><Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2563EB]" /> Sent to the provider: every prompt you submit, plus the last six messages of the active conversation as context. Image URLs you paste are forwarded to the editing and video endpoints.</p>
              <p className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2563EB]" /> No account, no database, no analytics. Requests are proxied through Bliss&rsquo;s server routes so the upstream sees your prompt but never your credentials (there are none).</p>
            </div>
            <Row title="Clear conversation history" desc={`${useChatStore.getState().conversations.length} conversations stored locally`}>
              <Button size="sm" variant="outline" className="gap-1.5 text-[#EF4444]" onClick={() => { useChatStore.getState().clearAll(); toast.info("Conversations deleted"); }}>
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </Button>
            </Row>
            <Row title="Delete saved library" desc="Removes saved responses, images and video references">
              <Button size="sm" variant="outline" className="gap-1.5 text-[#EF4444]" onClick={() => { useSavedStore.getState().clearAll(); toast.info("Saved items deleted"); }}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </Row>
          </Section>

          {/* API info */}
          <Section title="Service status" desc="Live probe of the upstream provider, refreshed when you open Settings.">
            <div className="grid gap-2 sm:grid-cols-2">
              <StatusTile label="Text generation" ok={status?.services?.text?.reachable} latency={status?.services?.text?.latency} />
              <StatusTile label="Image generation" ok={status?.services?.image?.reachable} latency={status?.services?.image?.latency} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(status?.capabilities ?? {}).map(([k, v]) => (
                <Badge key={k} className={cn("capitalize", v ? "border-[#22C55E]/25 bg-[#22C55E]/10 text-[#16A34A]" : "text-[#94A3B8]")}>
                  {v ? "✓ " : "✕ "}
                  {k.replace(/([A-Z])/g, " $1").toLowerCase()}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[#94A3B8]">
              {status?.status === "operational"
                ? "The provider responded to the health probe from the server."
                : "The provider didn't answer the health probe. This is common for free public endpoints — generations are retried automatically and failures are reported honestly instead of faked."}
            </p>
          </Section>

          <p className="pb-4 text-center text-[11px] text-[#94A3B8]">Bliss · Your ideas. Infinite possibilities. · v1.0.0</p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function StatusTile({ label, ok, latency }: { label: string; ok?: boolean; latency?: number }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border p-3">
      <span className={cn("h-2.5 w-2.5 rounded-full", ok ? "bg-[#22C55E]" : "bg-[#EF4444]")} />
      <div className="flex-1">
        <p className="text-xs font-semibold">{label}</p>
        <p className="text-[10px] text-[#94A3B8]">{ok ? `${latency ?? 0}ms response` : "unreachable from server"}</p>
      </div>
    </div>
  );
}
