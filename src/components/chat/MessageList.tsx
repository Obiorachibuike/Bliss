"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Check, RefreshCw, Pencil, Bookmark, User, Sparkles, AlertTriangle } from "lucide-react";
import { ProviderBadge } from "./ProviderBadge";
import type { ChatMessage } from "@/lib/types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { BlissMark } from "./BlissMark";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/ui/Toast";
import { useSavedStore } from "@/lib/store/savedStore";

function MessageActions({
  msg,
  onRegenerate,
  onEdit,
  isAssistant,
}: {
  msg: ChatMessage;
  onRegenerate?: () => void;
  onEdit?: () => void;
  isAssistant: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const addSaved = useSavedStore((s) => s.addItem);

  const copy = async () => {
    await navigator.clipboard.writeText(msg.content);
    setCopied(true);
    toast.success("Message copied");
    setTimeout(() => setCopied(false), 1400);
  };

  const save = () => {
    addSaved({
      id: crypto.randomUUID?.() ?? String(Date.now()),
      type: "response",
      title: msg.content.slice(0, 48),
      content: msg.content,
      createdAt: Date.now(),
    });
    toast.success("Saved to your library");
  };

  return (
    <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button onClick={copy} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#94A3B8] hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white">
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      {isAssistant && onRegenerate && (
        <button onClick={onRegenerate} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#94A3B8] hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white">
          <RefreshCw className="h-3 w-3" /> Regenerate
        </button>
      )}
      {isAssistant && (
        <button onClick={save} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#94A3B8] hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white">
          <Bookmark className="h-3 w-3" /> Save
        </button>
      )}
      {!isAssistant && onEdit && (
        <button onClick={onEdit} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#94A3B8] hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white">
          <Pencil className="h-3 w-3" /> Edit
        </button>
      )}
    </div>
  );
}

export function MessageList({
  messages,
  streamingId,
  onRegenerate,
  onEditMessage,
}: {
  messages: ChatMessage[];
  streamingId?: string | null;
  onRegenerate?: (msgId: string) => void;
  onEditMessage?: (msgId: string, newContent: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // auto-scroll only when the user is near the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      stickRef.current = nearBottom;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streamingId]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-6">
        <div className="space-y-6">
          {messages.map((m) => {
            const isUser = m.role === "user";
            const isStreamingThis = streamingId === m.id;
            return (
              <div
                key={m.id}
                className={cn(
                  "group animate-fade-up flex gap-3",
                  isUser ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {isUser ? (
                    <div className="grid h-8 w-8 place-items-center rounded-xl bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-200">
                      <User className="h-4 w-4" />
                    </div>
                  ) : (
                    <BlissMark className="grid h-8 w-8 place-items-center rounded-xl brand-gradient text-white shadow-[0_6px_18px_-6px_rgba(37,99,235,0.7)]" />
                  )}
                </div>

                <div className={cn("min-w-0 flex-1", isUser && "flex flex-col items-end")}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {isUser ? "You" : "Bliss"}
                    </span>
                    {!isUser && m.modelId && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/10 dark:text-slate-300">
                        {m.modelId}
                      </span>
                    )}
                    {!isUser && m.via === "agnes" && <ProviderBadge provider="agnes" model={m.modelId} />}
                  </div>

                  {isUser ? (
                    editing === m.id ? (
                      <div className="w-full">
                        <textarea
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              onEditMessage?.(m.id, draft);
                              setEditing(null);
                            }
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="min-h-[80px] w-full rounded-2xl border border-[#2563EB]/30 bg-white p-3 text-sm outline-none dark:bg-[#101827]"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => {
                              onEditMessage?.(m.id, draft);
                              setEditing(null);
                            }}
                            className="rounded-lg brand-gradient px-3 py-1.5 text-xs font-medium text-white"
                          >
                            Save & resend
                          </button>
                          <button onClick={() => setEditing(null)} className="rounded-lg border px-3 py-1.5 text-xs">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="max-w-[88ch] whitespace-pre-wrap rounded-2xl rounded-tr-md border border-[rgba(148,163,184,0.12)] bg-slate-100/80 px-4 py-3 text-sm leading-relaxed text-slate-800 dark:bg-white/[0.07] dark:text-slate-100">
                        {m.content}
                      </div>
                    )
                  ) : (
                    <div className="bliss-md max-w-[92ch] text-sm">
                      {m.error ? (
                        <div className="flex items-start gap-2 rounded-2xl border border-[#EF4444]/25 bg-[#EF4444]/5 px-4 py-3 text-sm text-[#EF4444]">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{m.error}</span>
                        </div>
                      ) : isStreamingThis ? (
                        <div className="flex items-center gap-2 rounded-2xl border border-[rgba(148,163,184,0.12)] bg-white px-4 py-3 dark:bg-[#101827]">
                          <Sparkles className="h-4 w-4 animate-pulse text-[#2563EB]" />
                          <span className="text-sm text-[#94A3B8]">Thinking…</span>
                          <span className="ml-1 flex gap-1">
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                          </span>
                        </div>
                      ) : (
                        <MarkdownRenderer content={m.content} />
                      )}
                    </div>
                  )}

                  {!isStreamingThis && !m.error && (
                    <MessageActions
                      msg={m}
                      isAssistant={!isUser}
                      onRegenerate={!isUser ? () => onRegenerate?.(m.id) : undefined}
                      onEdit={isUser ? () => { setEditing(m.id); setDraft(m.content); } : undefined}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div ref={bottomRef} className="h-4" />
      </div>
    </div>
  );
}
