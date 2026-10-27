"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UserSettings, ModelId, Theme } from "@/lib/types";

interface SettingsState extends UserSettings {
  setTheme: (t: Theme) => void;
  setDefaultModel: (m: ModelId) => void;
  toggleSidebar: () => void;
  setSidebar: (v: boolean) => void;
  setEnterToSend: (v: boolean) => void;
  setMarkdown: (v: boolean) => void;
  setContextPanel: (v: boolean) => void;
  reset: () => void;
}

const defaults: UserSettings = {
  theme: "dark",
  defaultModel: "agnes-2.0-flash",
  enterToSend: true,
  markdownRendering: true,
  defaultImageAspect: "1:1",
  defaultImageModel: "agnes-image-2.1-flash",
  defaultVideoModel: "agnes-video-v2.0",
  sidebarCollapsed: false,
  showContextPanel: true,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      setTheme: (theme) => set({ theme }),
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebar: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setEnterToSend: (enterToSend) => set({ enterToSend }),
      setMarkdown: (markdownRendering) => set({ markdownRendering }),
      setContextPanel: (showContextPanel) => set({ showContextPanel }),
      reset: () => set(defaults),
    }),
    {
      name: "bliss-settings-storage",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
