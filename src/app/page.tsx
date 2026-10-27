"use client";
import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { ImageStudio } from "@/components/image/ImageStudio";
import { VideoStudio } from "@/components/video/VideoStudio";
import { SavedLibrary } from "@/components/SavedLibrary";
import { HistoryView } from "@/components/HistoryView";
import { SettingsView } from "@/components/SettingsView";
import { ExploreModels } from "@/components/ExploreModels";
import { ApiExplorer } from "@/components/ApiExplorer";
import { useChatStore } from "@/lib/store/chatStore";

export default function Home() {
  const [view, setView] = useState<string>("chat");
  const [mobileNav, setMobileNav] = useState(false);
  const [imageSeed, setImageSeed] = useState<string | undefined>();
  const setActive = useChatStore((s) => s.setActive);

  const common = { onOpenMobileNav: () => setMobileNav(true) };

  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden">
      <div className="bliss-aurora" aria-hidden="true" />
      <Sidebar
        activeView={view}
        onViewChange={setView}
        mobileOpen={mobileNav}
        setMobileOpen={setMobileNav}
      />

      <main className="relative z-10 flex min-w-0 flex-1">
        {view === "chat" && (
          <ChatWorkspace
            {...common}
            onGoToImageStudio={(prompt) => {
              setImageSeed(prompt);
              setView("image");
            }}
          />
        )}
        {view === "explore" && (
          <ExploreModels
            {...common}
            onUseChat={() => setView("chat")}
            onUseImage={() => setView("image")}
          />
        )}
        {view === "image" && (
          <ImageStudio {...common} initialPrompt={imageSeed} />
        )}
        {view === "video" && <VideoStudio {...common} />}
        {view === "saved" && <SavedLibrary {...common} />}
        {view === "history" && (
          <HistoryView
            {...common}
            onOpenConversation={(id) => {
              setActive(id);
              setView("chat");
            }}
          />
        )}
        {view === "settings" && <SettingsView {...common} />}
        {view === "api" && <ApiExplorer {...common} />}
      </main>
    </div>
  );
}
