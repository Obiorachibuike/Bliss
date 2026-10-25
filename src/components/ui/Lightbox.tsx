"use client";
import { useEffect } from "react";
import { X, Download, Link2 } from "lucide-react";
import { Button } from "./button";

export function Lightbox({
  open,
  onClose,
  src,
  caption,
  kind = "image",
}: {
  open: boolean;
  onClose: () => void;
  src: string;
  caption?: string;
  kind?: "image" | "video";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
    >
      <div className="relative max-h-[90vh] w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="line-clamp-1 text-sm text-white/80">{caption}</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(src);
              }}
            >
              <Link2 className="h-3.5 w-3.5" /> Copy URL
            </Button>
            <a href={src} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="outline">
                <Download className="h-3.5 w-3.5" /> Open
              </Button>
            </a>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20"
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
          {kind === "video" ? (
            <video src={src} controls autoPlay className="max-h-[76vh] w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={caption || "Preview"} className="max-h-[76vh] w-full object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}
