"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SavedItem, GeneratedImage, GeneratedVideo } from "@/lib/types";

interface SavedState {
  items: SavedItem[];
  images: GeneratedImage[];
  videos: GeneratedVideo[];
  addItem: (i: SavedItem) => void;
  removeItem: (id: string) => void;
  addImage: (img: GeneratedImage) => void;
  removeImage: (id: string) => void;
  addVideo: (v: GeneratedVideo) => void;
  removeVideo: (id: string) => void;
  clearAll: () => void;
}

export const useSavedStore = create<SavedState>()(
  persist(
    (set) => ({
      items: [],
      images: [],
      videos: [],
      addItem: (i) => set((s) => ({ items: [i, ...s.items] })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
      addImage: (img) => set((s) => ({ images: [img, ...s.images] })),
      removeImage: (id) => set((s) => ({ images: s.images.filter((x) => x.id !== id) })),
      addVideo: (v) => set((s) => ({ videos: [v, ...s.videos] })),
      removeVideo: (id) => set((s) => ({ videos: s.videos.filter((x) => x.id !== id) })),
      clearAll: () => set({ items: [], images: [], videos: [] }),
    }),
    {
      name: "bliss-saved-storage",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
