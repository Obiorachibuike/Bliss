import * as React from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "default" | "ghost" | "outline" | "secondary";
type Size = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40 disabled:pointer-events-none disabled:opacity-50";
    const variants: Record<Variant, string> = {
      default:
        "bg-[linear-gradient(135deg,#2563EB_0%,#3B82F6_45%,#60A5FA_100%)] text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.45)] hover:scale-[1.02] active:scale-[0.98]",
      ghost:
        "bg-transparent hover:bg-black/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200",
      outline:
        "border border-[rgba(148,163,184,0.16)] bg-white dark:bg-[#101827] hover:bg-slate-50 dark:hover:bg-[#1a2538] text-slate-700 dark:text-slate-200",
      secondary:
        "bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-white/15",
    };
    const sizes: Record<Size, string> = {
      default: "h-10 px-5 py-2",
      sm: "h-8 rounded-lg px-3 text-xs",
      lg: "h-11 rounded-xl px-8",
      icon: "h-9 w-9",
    };
    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
