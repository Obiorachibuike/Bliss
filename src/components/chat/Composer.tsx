"use client";
import { useRef, useEffect, useState } from "react";
import {
  Send,
  Square,
  Sparkles,
  Paperclip,
  Link2,
  Info,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModelSelector } from "./ModelSelector";
import type { ModelId } from "@/lib/types";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useFallbackStatus } from "@/lib/hooks/useModelCatalog";
import { isValidUrl } from "@/lib/api/client";
import { toast } from "@/components/ui/Toast";

export function Composer({
  onSend,
  onStop,
  isStreaming,
  selectedModel,
  onModelChange,
  disabled,
}: {
  onSend: (text: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  selectedModel: ModelId;
  onModelChange: (m: ModelId) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fallback = useFallbackStatus();
  const enterToSend = useSettingsStore((s) => s.enterToSend);
  const maxLen = 4000;

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 168) + "px";
  }, [text]);

  const send = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText("");
    setAttachOpen(false);
  };

  const attach = () => {
    const url = imageUrl.trim();
    if (!isValidUrl(url)) {
      toast.error("Enter a valid http(s) image URL");
      return;
    }
    setText(
      (t) =>
        `${t ? t.replace(/\s+$/, "") + "\n\n" : ""}![reference image](${url})\n`,
    );
    setImageUrl("");
    setAttachOpen(false);
    taRef.current?.focus();
    toast.success("Image reference added to your prompt");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.shiftKey) return; // always newline
    if (enterToSend || mod) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="border-t border-[rgba(148,163,184,0.12)] bg-white/80 dark:bg-[#080D18]/80 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-3xl p-3 sm:p-4">
        {attachOpen && (
          <div className="animate-pop mb-2 rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white p-3 shadow-lg dark:bg-[#101827]">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <Link2 className="h-3.5 w-3.5 text-[#2563EB]" />
                {fallback.vision
                  ? "Attach an image for analysis"
                  : "Reference a hosted image"}
              </p>
              <button
                onClick={() => setAttachOpen(false)}
                aria-label="Close attachment panel"
                className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex gap-2">
              <Input
                autoFocus
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && attach()}
                placeholder="https://example.com/photo.jpg"
              />
              <Button size="sm" onClick={attach} className="shrink-0">
                Add
              </Button>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-[#94A3B8]">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              {fallback.vision
                ? "With the Agnes fallback enabled, Bliss also sends the image as a real image_url part so the model can see it. The key-less upstreams still get it as text only."
                : "The upstream models accept text only — there is no vision endpoint, so an image URL is included as text for the model to reference, not analysed. Set AGNES_API_KEY to enable image analysis."}
            </p>
          </div>
        )}

        <div
          className={
            "overflow-hidden rounded-2xl border bg-white shadow-[0_8px_30px_rgba(8,13,24,0.06)] transition-all focus-within:ring-2 dark:bg-[#101827] " +
            (focused
              ? "border-[#2563EB]/30 focus-within:ring-[#2563EB]/15"
              : "border-[rgba(148,163,184,0.16)] focus-within:ring-[#2563EB]/10")
          }
        >
          <label className="sr-only" htmlFor="bliss-composer">
            Message Bliss
          </label>
          <textarea
            id="bliss-composer"
            ref={taRef}
            value={text}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setText(e.target.value.slice(0, maxLen + 200))}
            onKeyDown={onKeyDown}
            placeholder="Ask anything, plan something, or describe an image…"
            rows={1}
            className="max-h-[168px] min-h-[54px] w-full resize-none bg-transparent px-4 pt-4 text-sm leading-relaxed text-slate-800 outline-none placeholder:text-[#94A3B8] dark:text-slate-100"
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1.5 sm:px-3 sm:pb-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                onClick={() => setAttachOpen((v) => !v)}
                aria-label="Attach an image reference"
                aria-expanded={attachOpen}
                className={
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition " +
                  (attachOpen
                    ? "border-[#2563EB]/40 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]"
                    : "border-[rgba(148,163,184,0.16)] text-[#94A3B8] hover:bg-slate-50 dark:hover:bg-white/5")
                }
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <ModelSelector value={selectedModel} onChange={onModelChange} />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span
                className={
                  "hidden text-[11px] tabular-nums sm:inline " +
                  (text.length > maxLen ? "text-[#EF4444]" : "text-[#94A3B8]")
                }
              >
                {text.length}/{maxLen}
              </span>
              {isStreaming ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onStop}
                  className="gap-1.5 rounded-xl"
                >
                  <Square className="h-3.5 w-3.5 fill-current" /> Stop
                </Button>
              ) : (
                <Button
                  onClick={send}
                  disabled={!text.trim() || disabled}
                  className="rounded-xl px-4"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                  <span className="hidden sm:inline">Send</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] text-[#94A3B8]">
          <span className="hidden items-center gap-1 sm:flex">
            <kbd className="rounded border border-[rgba(148,163,184,0.2)] bg-slate-50 px-1.5 py-0.5 font-sans text-[10px] font-medium dark:bg-white/5">
              {enterToSend ? "Enter" : "⌘/Ctrl + Enter"}
            </kbd>
            send
            <kbd className="ml-1 rounded border border-[rgba(148,163,184,0.2)] bg-slate-50 px-1.5 py-0.5 font-sans text-[10px] font-medium dark:bg-white/5">
              Shift + Enter
            </kbd>
            new line
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-[#2563EB]" />
            Requests run through Bliss server routes with retries and rate
            limits
          </span>
        </p>
      </div>
    </div>
  );
}
