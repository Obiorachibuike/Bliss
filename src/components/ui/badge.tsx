import { cn } from "@/lib/utils/cn";
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-[rgba(148,163,184,0.12)] bg-slate-50 dark:bg-white/5 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300",
        className
      )}
      {...props}
    />
  );
}
