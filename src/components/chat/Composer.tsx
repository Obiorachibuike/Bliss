"use client";
import { useRef, useEffect, useState, useCallback } from "react";
import { Send, Square, Sparkles, Paperclip, Link2, Info, X, Image as ImageIcon, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModelSelector } from "./ModelSelector";
import type { ModelId } from "@/lib/types";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { isValidUrl } from "@/lib/api/client";
import { toast } from "@/components/ui/Toast";
import { imageFileToDataUri, readTextFile, isImageFile, isTextFile } from "@/lib/utils/fileHandling";
import { isAgnesChatModel } from "@/lib/api/config";

export function Composer({
  onSend,
  onStop,
  isStreaming,
  selectedModel,
  onModelChange,
  disabled,
}: {
  onSend: (text: string, images?: string[]) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  selectedModel: ModelId;
  onModelChange: (m: ModelId) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const enterToSend = useSettingsStore((s) => s.enterToSend);
  const maxLen = 4000;
  const supportsVision = isAgnesChatModel(selectedModel);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 168) + "px";
  }, [text]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    for (const file of arr) {
      if (isImageFile(file)) {
        if (!supportsVision) {
          toast.error("This model doesn't support images. Switch to Agnes 2.0 Flash for vision.");
          continue;
        }
        try {
          const dataUri = await imageFileToDataUri(file, 2048);
          setAttachedImages((prev) => [...prev, dataUri].slice(0, 4));
          toast.success(`Image attached: ${file.name}`);
        } catch {
          toast.error(`Failed to process image: ${file.name}`);
        }
      } else if (isTextFile(file)) {
        try {
          const content = await readTextFile(file);
          const truncated = content.slice(0, 8000);
          setText((t) => `${t ? t + "\n\n" : ""}**${file.name}:**\n\`\`\`\n${truncated}\n\`\`\``);
          toast.success(`Text file inlined: ${file.name}`);
        } catch {
          toast.error(`Failed to read file: ${file.name}`);
        }
      } else {
        toast.error(`Unsupported file type: ${file.name}. Attach images or text files.`);
      }
    }
  }, [supportsVision]);

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.files;
    if (items && items.length > 0) {
      e.preventDefault();
      void handleFiles(items);
    }
  }, [handleFiles]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const send = () => {
    const value = text.trim();
    if ((!value && attachedImages.length === 0) || disabled) return;
    onSend(value || (attachedImages.length ? "Describe this image" : ""), attachedImages.length ? attachedImages : undefined);
    setText("");
    setAttachedImages([]);
    setAttachOpen(false);
  };

  const attachUrl = () => {
    const url = imageUrl.trim();
    if (!isValidUrl(url)) {
      toast.error("Enter a valid http(s) image URL");
      return;
    }
    if (!supportsVision) {
      // Fallback: inline as markdown reference
      setText((t) => `${t ? t.replace(/\s+$/, "") + "\n\n" : ""}![reference image](${url})\n`);
    } else {
      setAttachedImages((prev) => [...prev, url].slice(0, 4));
    }
    setImageUrl("");
    setAttachOpen(false);
    taRef.current?.focus();
    toast.success("Image reference added");
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
    <div
      className="border-t border-[rgba(148,163,184,0.12)] bg-white/80 dark:bg-[#080D18]/80 backdrop-blur-xl"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-white/80 dark:bg-[#080D18]/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-[#2563EB] bg-[#EFF6FF] px-8 py-6 text-center dark:bg-[#2563EB]/10">
            <ImageIcon className="mx-auto h-8 w-8 text-[#2563EB]" />
            <p className="mt-2 text-sm font-semibold">Drop files to attach</p>
            <p className="text-xs text-[#94A3B8]">Images → vision (Agnes), Text files → inlined into prompt</p>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl p-3 sm:p-4">
        {attachedImages.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {attachedImages.map((src, i) => (
              <div key={i} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`attachment ${i + 1}`} className="h-16 w-16 rounded-xl border object-cover" />
                <button
                  onClick={() => setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white hover:bg-black"
                  aria-label="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <span className="self-center text-xs text-[#94A3B8]">{attachedImages.length}/4 images</span>
          </div>
        )}

        {attachOpen && (
          <div className="animate-pop mb-2 rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white p-3 shadow-lg dark:bg-[#101827]">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <Link2 className="h-3.5 w-3.5 text-[#2563EB]" /> Attach reference
              </p>
              <button onClick={() => setAttachOpen(false)} aria-label="Close attachment panel" className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-white/10">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex gap-2">
              <Input
                autoFocus
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && attachUrl()}
                placeholder="https://example.com/photo.jpg"
              />
              <Button size="sm" onClick={attachUrl} className="shrink-0">Add URL</Button>
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" /> Upload image
              </Button>
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Upload text
              </Button>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-[#94A3B8]">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              {supportsVision ? "Images sent as vision input (max 2048px, base64). Text files are inlined into your prompt. Drag & drop or paste works too." : "This model accepts text only. Switch to Agnes 2.0 Flash for image understanding."}
            </p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.txt,.md,.csv,.json,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.css,.html,.xml,.yaml,.yml,.toml,.ini,.sh,.log"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <div
          className={
            "overflow-hidden rounded-2xl border bg-white shadow-[0_8px_30px_rgba(8,13,24,0.06)] transition-all focus-within:ring-2 dark:bg-[#101827] " +
            (focused
              ? "border-[#2563EB]/30 focus-within:ring-[#2563EB]/15"
              : "border-[rgba(148,163,184,0.16)] focus-within:ring-[#2563EB]/10")
          }
        >
          <label className="sr-only" htmlFor="bliss-composer">Message Bliss</label>
          <textarea
            id="bliss-composer"
            ref={taRef}
            value={text}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setText(e.target.value.slice(0, maxLen + 200))}
            onKeyDown={onKeyDown}
            onPaste={onPaste as unknown as React.ClipboardEventHandler<HTMLTextAreaElement>}
            placeholder={supportsVision ? "Ask anything — attach images for vision, drag & drop files…" : "Ask anything, plan something, or describe an image…"}
            rows={1}
            className="max-h-[168px] min-h-[54px] w-full resize-none bg-transparent px-4 pt-4 text-sm leading-relaxed text-slate-800 outline-none placeholder:text-[#94A3B8] dark:text-slate-100"
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1.5 sm:px-3 sm:pb-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                onClick={() => setAttachOpen((v) => !v)}
                aria-label="Attach files"
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
              <span className={"hidden text-[11px] tabular-nums sm:inline " + (text.length > maxLen ? "text-[#EF4444]" : "text-[#94A3B8]")}>
                {text.length}/{maxLen}
              </span>
              {isStreaming ? (
                <Button variant="outline" size="sm" onClick={onStop} className="gap-1.5 rounded-xl">
                  <Square className="h-3.5 w-3.5 fill-current" /> Stop
                </Button>
              ) : (
                <Button onClick={send} disabled={(!text.trim() && attachedImages.length === 0) || !!disabled} className="rounded-xl px-4" aria-label="Send message">
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
            <span className="ml-1 hidden sm:inline">• Paste / drag & drop files</span>
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-[#2563EB]" />
            {supportsVision ? "Vision + streaming enabled (Agnes)" : "Requests run through Bliss server routes with retries and rate limits"}
          </span>
        </p>
      </div>
    </div>
  );
}
