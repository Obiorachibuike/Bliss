"use client";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Which provider actually produced a result. Shown only when it says something a
 *  user could not infer from the model name — i.e. an Agnes-served reply. */
export function ProviderBadge({
  provider,
  model,
  fallbackUsed,
  className,
}: {
  provider?: string | null;
  /** Model that answered, shown in the tooltip for traceability. */
  model?: string | null;
  /** True when the primary provider failed and the fallback took over. */
  fallbackUsed?: boolean;
  className?: string;
}) {
  if (!provider && !fallbackUsed) return null;
  const viaAgnes = provider === "agnes";
  if (!viaAgnes) return null;
  const detail = fallbackUsed
    ? "The key-less provider didn't answer, so the Agnes AI fallback provider completed this request."
    : "Served by the Agnes AI provider you selected.";
  return (
    <span
      title={`${detail}${model ? ` Model: ${model}.` : ""}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[#22C55E]/25 bg-[#22C55E]/10 px-2 py-0.5 text-[10px] font-medium text-[#16A34A] dark:text-[#4ADE80]",
        className
      )}
    >
      <ShieldCheck className="h-2.5 w-2.5" />
      via Agnes AI
    </span>
  );
}
