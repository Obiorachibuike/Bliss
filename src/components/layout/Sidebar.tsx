"use client";
import { useEffect, useState } from "react";
import {
  MessageSquare,
  Compass,
  Image as ImageIcon,
  Video,
  Bookmark,
  History,
  Settings,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Pin,
  Trash2,
  Pencil,
  Moon,
  Sun,
  X,
  Code2,
  Sparkles,
} from "lucide-react";
import { BlissLogo } from "./Logo";
import { useChatStore } from "@/lib/store/chatStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useTheme } from "./ThemeProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/utils/title";
import { cn } from "@/lib/utils/cn";

type NavItem = { id: string; label: string; icon: React.ReactNode; badge?: string };

const navItems: NavItem[] = [
  { id: "chat", label: "Chat", icon: <MessageSquare className="w-4 h-4" /> },
  { id: "explore", label: "Explore Models", icon: <Compass className="w-4 h-4" /> },
  { id: "image", label: "Image Studio", icon: <ImageIcon className="w-4 h-4" /> },
  { id: "video", label: "Video Studio", icon: <Video className="w-4 h-4" /> },
  { id: "saved", label: "Saved", icon: <Bookmark className="w-4 h-4" /> },
  { id: "history", label: "History", icon: <History className="w-4 h-4" /> },
  { id: "api", label: "API Explorer", icon: <Code2 className="w-4 h-4" /> },
];

export function Sidebar({
  activeView,
  onViewChange,
  mobileOpen,
  setMobileOpen,
}: {
  activeView: string;
  onViewChange: (v: string) => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}) {
  const { conversations, activeId, createConversation, setActive, deleteConversation, togglePin } =
    useChatStore();
  const railCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  // The mobile drawer is never the collapsed rail — it only has room when open.
  const sidebarCollapsed = railCollapsed && !mobileOpen;
  const setSidebar = useSettingsStore((s) => s.setSidebar);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const { toggle } = useTheme();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  // Mobile drawer: close on Escape and lock background scroll while open.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen, setMobileOpen]);

  const filtered = conversations
    .filter((c) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q));
    })
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Top */}
      <div className="flex items-center justify-between p-4">
        <BlissLogo collapsed={sidebarCollapsed} />
        <button
          onClick={() => setSidebar(!sidebarCollapsed)}
          className="hidden lg:flex h-7 w-7 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[#94A3B8]"
          aria-label="Toggle sidebar"
        >
          {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden h-7 w-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* New Chat */}
      {!sidebarCollapsed && (
        <div className="px-3 pb-3">
          <Button
            onClick={() => {
              createConversation(defaultModel);
              onViewChange("chat");
              setMobileOpen(false);
            }}
            className="w-full justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </Button>
        </div>
      )}
      {sidebarCollapsed && (
        <div className="px-2 pb-3 flex justify-center">
          <Button size="icon" onClick={() => createConversation(defaultModel)}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Nav */}
      <nav className="px-2 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              onViewChange(item.id);
              setMobileOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
              activeView === item.id
                ? "bg-[linear-gradient(135deg,#2563EB_0%,#3B82F6_45%,#60A5FA_100%)] text-white shadow-md"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5",
              sidebarCollapsed && "justify-center px-2"
            )}
            title={sidebarCollapsed ? item.label : undefined}
          >
            {item.icon}
            {!sidebarCollapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* History */}
      {!sidebarCollapsed && (
        <div className="mt-4 flex flex-1 flex-col overflow-hidden border-t border-[rgba(148,163,184,0.12)] pt-4">
          <div className="px-3 pb-2 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-widest uppercase text-[#94A3B8]">Recent</span>
            <span className="text-xs text-[#94A3B8]">{conversations.length}</span>
          </div>

          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#94A3B8]" />
              <Input
                placeholder="Search conversations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-9 text-xs"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-1 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-white/10">
            {filtered.length === 0 && <p className="px-3 py-6 text-xs text-center text-[#94A3B8]">No conversations yet</p>}
            {filtered.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex flex-col gap-1 rounded-xl px-3 py-2.5 cursor-pointer transition-all border",
                  activeId === c.id
                    ? "bg-[#F0F7FF] dark:bg-[#132034] border-[#2563EB]/20"
                    : "border-transparent hover:bg-slate-50 dark:hover:bg-white/5"
                )}
                onClick={() => {
                  setActive(c.id);
                  onViewChange("chat");
                  setMobileOpen(false);
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  {editingId === c.id ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          useChatStore.getState().renameConversation(c.id, editTitle);
                          setEditingId(null);
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => {
                        if (editTitle.trim()) useChatStore.getState().renameConversation(c.id, editTitle);
                        setEditingId(null);
                      }}
                      className="h-6 text-xs"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <p className="text-sm font-medium leading-tight line-clamp-1 text-slate-800 dark:text-slate-100 flex-1">
                      {c.title}
                    </p>
                  )}
                  {c.pinned && <Pin className="w-3 h-3 text-[#2563EB] shrink-0 mt-0.5" />}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#94A3B8]">{relativeTime(c.updatedAt)} • {c.messages.length} msgs</span>
                  <div className="hidden group-hover:flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(c.id);
                        setEditTitle(c.title);
                      }}
                      aria-label="Rename conversation"
                      className="h-6 w-6 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(c.id);
                      }}
                      aria-label="Pin conversation"
                      className="h-6 w-6 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <Pin className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(c.id);
                      }}
                      aria-label="Delete conversation"
                      className="h-6 w-6 grid place-items-center rounded-md hover:bg-red-50 dark:hover:bg-red-500/20 text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom */}
      <div className="border-t border-[rgba(148,163,184,0.12)] p-3 space-y-2">
        {!sidebarCollapsed ? (
          <>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-white/5 p-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-[#2563EB]" />
                Theme
              </span>
              <button
                onClick={toggle}
                aria-label="Toggle color theme"
                className="flex items-center gap-1 rounded-full bg-white dark:bg-[#0B1220] border border-[rgba(148,163,184,0.16)] px-2.5 py-1 text-xs font-medium"
              >
                <Sun className="w-3.5 h-3.5 dark:hidden" />
                <Moon className="hidden w-3.5 h-3.5 dark:block" />
                <span className="dark:hidden">Light</span>
                <span className="hidden dark:inline">Dark</span>
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onViewChange("settings")}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-[rgba(148,163,184,0.16)] py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-white/5 text-slate-600 dark:text-slate-300"
              >
                <Settings className="w-3.5 h-3.5" /> Settings
              </button>
              <button
                onClick={() => onViewChange("api")}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-[rgba(148,163,184,0.16)] py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-white/5 text-slate-600 dark:text-slate-300"
              >
                <HelpCircle className="w-3.5 h-3.5" /> Help
              </button>
            </div>
            <p className="text-[10px] text-center text-[#94A3B8]">Bliss v1.0 • Free AI APIs</p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button onClick={toggle} aria-label="Toggle color theme" className="h-8 w-8 grid place-items-center rounded-xl border border-[rgba(148,163,184,0.16)]">
              <Sun className="w-4 h-4 dark:hidden" />
              <Moon className="hidden w-4 h-4 dark:block" />
            </button>
            <button onClick={() => onViewChange("settings")} className="h-8 w-8 grid place-items-center rounded-xl border border-[rgba(148,163,184,0.16)]">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside
        aria-label="Primary"
        className={cn(
          "hidden lg:flex flex-col shrink-0 border-r border-[rgba(148,163,184,0.12)] bg-[#F7FAFF]/80 dark:bg-[#080D18]/80 backdrop-blur-xl transition-all duration-300",
          sidebarCollapsed ? "w-[72px]" : "w-[300px]"
        )}
      >
        {sidebarContent}
      </aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Bliss navigation">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative w-[300px] bg-[#F7FAFF] dark:bg-[#080D18] h-full overflow-hidden shadow-2xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
