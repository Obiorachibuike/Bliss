"use client";
import { useState } from "react";
import {
  History as HistoryIcon,
  Search,
  Trash2,
  MessageSquare,
  Pin,
  ChevronRight,
  Menu,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/lib/store/chatStore";
import { relativeTime } from "@/lib/utils/title";
import { MODELS_WITH_FALLBACK } from "@/lib/api/config";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";

export function HistoryView({
  onOpenMobileNav,
  onOpenConversation,
}: {
  onOpenMobileNav: () => void;
  onOpenConversation: (id: string) => void;
}) {
  const { conversations, deleteConversation, togglePin, clearAll } =
    useChatStore();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "oldest" | "longest">("recent");

  const list = conversations
    .filter(
      (c) =>
        !q.trim() ||
        c.title.toLowerCase().includes(q.toLowerCase()) ||
        c.messages.some((m) =>
          m.content.toLowerCase().includes(q.toLowerCase()),
        ),
    )
    .sort((a, b) => {
      if (b.pinned !== a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (sort === "oldest") return a.createdAt - b.createdAt;
      if (sort === "longest") return b.messages.length - a.messages.length;
      return b.updatedAt - a.updatedAt;
    });

  const totalMessages = conversations.reduce(
    (n, c) => n + c.messages.length,
    0,
  );
  const chars = conversations.reduce(
    (n, c) => n + c.messages.reduce((x, m) => x + m.content.length, 0),
    0,
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[rgba(148,163,184,0.12)] px-3 sm:px-5">
        <button
          onClick={onOpenMobileNav}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <HistoryIcon className="h-4 w-4 text-[#2563EB]" /> History
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">
            {conversations.length} conversations · stored locally
          </p>
        </div>
        {conversations.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-[#EF4444]"
            onClick={() => {
              clearAll();
              toast.info("History cleared");
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />{" "}
            <span className="hidden sm:inline">Clear history</span>
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Conversations", value: conversations.length },
              { label: "Messages", value: totalMessages },
              { label: "Characters", value: chars.toLocaleString() },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4">
                  <p className="text-xl font-semibold brand-text">{s.value}</p>
                  <p className="text-[11px] uppercase tracking-wider text-[#94A3B8]">
                    {s.label}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search titles and message content…"
                className="h-10 w-full rounded-xl border border-[rgba(148,163,184,0.16)] bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[#2563EB]/20 dark:bg-[#101827]"
              />
            </div>
            <div className="flex gap-1.5">
              {(["recent", "oldest", "longest"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={cn(
                    "rounded-xl border px-3 text-xs font-medium capitalize transition",
                    sort === s
                      ? "border-transparent brand-gradient text-white"
                      : "hover:bg-slate-50 dark:hover:bg-white/5",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {list.length === 0 ? (
            <Card className="py-14">
              <CardContent className="flex flex-col items-center gap-3 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15">
                  <MessageSquare className="h-6 w-6" />
                </div>
                <p className="text-sm font-medium">
                  {q
                    ? "No conversations match your search"
                    : "No conversations yet"}
                </p>
                <p className="max-w-sm text-xs leading-relaxed text-[#94A3B8]">
                  {q
                    ? "Try a different keyword."
                    : "Start chatting and your history will be saved to this browser automatically — nothing is uploaded to a database."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {list.map((c) => {
                const model = MODELS_WITH_FALLBACK.find(
                  (m) => m.id === c.modelId,
                );
                const last = c.messages[c.messages.length - 1];
                return (
                  <Card
                    key={c.id}
                    className="group animate-fade-up cursor-pointer transition-all hover:-translate-y-0.5 hover:border-[#2563EB]/25 hover:shadow-[0_14px_36px_-20px_rgba(37,99,235,0.5)]"
                  >
                    <CardContent
                      className="flex items-center gap-3 p-3.5"
                      onClick={() => onOpenConversation(c.id)}
                    >
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-lg dark:bg-white/5">
                        {model?.icon ?? "💬"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">
                            {c.title}
                          </p>
                          {c.pinned && (
                            <Pin className="h-3 w-3 shrink-0 text-[#2563EB]" />
                          )}
                        </div>
                        <p className="line-clamp-1 text-xs text-[#94A3B8]">
                          {last
                            ? `${last.role === "user" ? "You: " : ""}${last.content || last.error || "…"}`
                            : "No messages"}
                        </p>
                      </div>
                      <div className="hidden shrink-0 text-right sm:block">
                        <p className="text-[11px] font-medium">
                          {relativeTime(c.updatedAt)}
                        </p>
                        <p className="flex items-center justify-end gap-1 text-[10px] text-[#94A3B8]">
                          {c.messages.length} msgs · {model?.name ?? c.modelId}
                          {c.messages.some((m) => m.via === "agnes") && (
                            <span className="inline-flex items-center gap-0.5 rounded-full border border-[#22C55E]/25 bg-[#22C55E]/10 px-1.5 text-[9px] font-medium text-[#16A34A] dark:text-[#4ADE80]">
                              <ShieldCheck className="h-2 w-2" /> Agnes reply
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePin(c.id);
                          }}
                          className="grid h-7 w-7 place-items-center rounded-lg opacity-0 transition hover:bg-slate-100 group-hover:opacity-100 dark:hover:bg-white/10"
                          aria-label="Pin"
                        >
                          <Pin className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteConversation(c.id);
                            toast.info("Conversation deleted");
                          }}
                          className="grid h-7 w-7 place-items-center rounded-lg text-[#94A3B8] opacity-0 transition hover:bg-[#EF4444]/10 hover:text-[#EF4444] group-hover:opacity-100"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <ChevronRight className="h-4 w-4 text-[#94A3B8]" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
