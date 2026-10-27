"use client";
import { useState } from "react";
import {
  Bookmark,
  Copy,
  ExternalLink,
  Trash2,
  MessageSquare,
  ImageIcon,
  Film,
  Code2,
  Menu,
  Search,
  FolderOpen,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lightbox } from "@/components/ui/Lightbox";
import { toast } from "@/components/ui/Toast";
import { useSavedStore } from "@/lib/store/savedStore";
import { relativeTime } from "@/lib/utils/title";
import { cn } from "@/lib/utils/cn";

const typeIcon: Record<string, React.ReactNode> = {
  response: <MessageSquare className="h-3.5 w-3.5" />,
  image: <ImageIcon className="h-3.5 w-3.5" />,
  video: <Film className="h-3.5 w-3.5" />,
  code: <Code2 className="h-3.5 w-3.5" />,
};

export function SavedLibrary({
  onOpenMobileNav,
}: {
  onOpenMobileNav: () => void;
}) {
  const { items, images, videos, removeItem, removeImage, clearAll } =
    useSavedStore();
  const [filter, setFilter] = useState<
    "all" | "response" | "image" | "video" | "code"
  >("all");
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<{
    url: string;
    kind: "image" | "video";
    title: string;
  } | null>(null);

  const filtered = items.filter((i) => {
    const okType = filter === "all" || i.type === filter;
    const okQ =
      !q.trim() ||
      i.title.toLowerCase().includes(q.toLowerCase()) ||
      i.content.toLowerCase().includes(q.toLowerCase());
    return okType && okQ;
  });

  const empty =
    items.length === 0 && images.length === 0 && videos.length === 0;

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
            <Bookmark className="h-4 w-4 text-[#2563EB]" /> Saved
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">
            {items.length} items in your library
          </p>
        </div>
        {!empty && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              clearAll();
              toast.info("Library cleared");
            }}
          >
            Clear all
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search saved items…"
                className="h-10 w-full rounded-xl border border-[rgba(148,163,184,0.16)] bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[#2563EB]/20 dark:bg-[#101827]"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["all", "response", "image", "video", "code"] as const).map(
                (f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition",
                      filter === f
                        ? "border-transparent brand-gradient text-white"
                        : "hover:bg-slate-50 dark:hover:bg-white/5",
                    )}
                  >
                    {f}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/5 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
            <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Bliss stores references (URLs and text) in your browser, not media
              files. Generated images and clips are hosted by the provider and
              may expire — download anything you want to keep permanently.
            </span>
          </div>

          {empty ? (
            <Card className="py-14">
              <CardContent className="flex flex-col items-center gap-3 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15">
                  <FolderOpen className="h-6 w-6" />
                </div>
                <p className="text-sm font-medium">Nothing saved yet</p>
                <p className="max-w-sm text-xs leading-relaxed text-[#94A3B8]">
                  Save a chat response with the Save action, or star an image
                  from Image Studio. Your library is stored on this device only.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((item) => (
                <Card
                  key={item.id}
                  className="group animate-fade-up flex h-full flex-col transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-20px_rgba(37,99,235,0.45)]"
                >
                  {(item.type === "image" || item.type === "video") &&
                    item.preview && (
                      <button
                        onClick={() =>
                          setPreview({
                            url: item.preview!,
                            kind: item.type === "video" ? "video" : "image",
                            title: item.title,
                          })
                        }
                        className="block w-full overflow-hidden rounded-t-2xl border-b"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          loading="lazy"
                          src={item.preview}
                          alt={item.title}
                          className="aspect-video w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                        />
                      </button>
                    )}
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="line-clamp-2 text-[13px] leading-snug">
                        {item.title}
                      </CardTitle>
                      <Badge className="flex shrink-0 items-center gap-1 capitalize">
                        {typeIcon[item.type]} {item.type}
                      </Badge>
                    </div>
                    <CardDescription className="text-[11px]">
                      {relativeTime(item.createdAt)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col justify-between gap-3">
                    {item.type === "response" || item.type === "code" ? (
                      <p
                        className={cn(
                          "line-clamp-4 text-xs leading-relaxed text-[#94A3B8]",
                          item.type === "code" && "font-mono",
                        )}
                      >
                        {item.content}
                      </p>
                    ) : (
                      <p className="line-clamp-1 font-mono text-[10px] text-[#94A3B8]">
                        {item.content.replace("https://", "")}
                      </p>
                    )}
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1"
                        onClick={async () => {
                          await navigator.clipboard.writeText(item.content);
                          toast.success("Copied");
                        }}
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </Button>
                      {item.type !== "response" && item.type !== "code" && (
                        <a
                          href={item.content}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-8 flex-1 items-center justify-center gap-1 rounded-xl border border-[rgba(148,163,184,0.16)] text-xs font-medium hover:bg-slate-50 dark:hover:bg-white/5"
                        >
                          <ExternalLink className="h-3 w-3" /> Open
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          removeItem(item.id);
                          toast.info("Removed");
                        }}
                        className="text-[#94A3B8] hover:text-[#EF4444]"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {(images.length > 0 || videos.length > 0) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Generation history</CardTitle>
                <CardDescription>
                  Everything you&rsquo;ve made in the studios on this device
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {images.slice(0, 12).map((im) => (
                  <div
                    key={im.id}
                    className="group relative overflow-hidden rounded-lg border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      loading="lazy"
                      src={im.imageUrl}
                      alt={im.prompt}
                      className="aspect-square w-full cursor-zoom-in object-cover transition group-hover:scale-105"
                      onClick={() =>
                        setPreview({
                          url: im.imageUrl,
                          kind: "image",
                          title: im.prompt,
                        })
                      }
                    />
                    <button
                      onClick={() => removeImage(im.id)}
                      className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-black/55 text-white opacity-0 transition group-hover:opacity-100"
                      aria-label="Delete image"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Lightbox
        open={!!preview}
        onClose={() => setPreview(null)}
        src={preview?.url ?? ""}
        caption={preview?.title}
        kind={preview?.kind}
      />
    </div>
  );
}
