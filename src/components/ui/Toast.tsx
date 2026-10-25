"use client";
import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

let n = 0;
const useToastStore = create<{ toasts: Toast[]; push: (m: string, k: ToastKind) => void; remove: (id: number) => void }>(
  (set) => ({
    toasts: [],
    push: (message, kind) => {
      const id = ++n;
      set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
    },
    remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  })
);

export const toast = {
  success: (m: string) => useToastStore.getState().push(m, "success"),
  error: (m: string) => useToastStore.getState().push(m, "error"),
  info: (m: string) => useToastStore.getState().push(m, "info"),
};

export function Toaster() {
  const { toasts, remove } = useToastStore();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="animate-pop pointer-events-auto flex items-start gap-3 rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white/95 px-4 py-3 text-sm shadow-[0_12px_40px_rgba(8,13,24,0.18)] backdrop-blur-xl dark:bg-[#101827]/95"
        >
          <span
            className={
              "mt-1 h-2 w-2 shrink-0 rounded-full " +
              (t.kind === "success"
                ? "bg-[#22C55E]"
                : t.kind === "error"
                ? "bg-[#EF4444]"
                : "bg-[#3B82F6]")
            }
          />
          <p className="flex-1 text-slate-700 dark:text-slate-200">{t.message}</p>
          <button
            onClick={() => remove(t.id)}
            className="text-xs text-[#94A3B8] hover:text-slate-700 dark:hover:text-white"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
