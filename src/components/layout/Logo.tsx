export function BlissLogo({ size = 28, showWordmark = true, collapsed = false }: { size?: number; showWordmark?: boolean; collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="relative flex items-center justify-center rounded-xl shadow-[0_4px_12px_rgba(37,99,235,0.3)]"
        style={{
          width: size,
          height: size,
          background: "linear-gradient(135deg, #2563EB 0%, #3B82F6 45%, #60A5FA 100%)",
        }}
      >
        {/* gem / spark icon */}
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L14.8 8.2L22 9L16.5 14.5L18 22L12 18.5L6 22L7.5 14.5L2 9L9.2 8.2L12 2Z"
            fill="white"
            fillOpacity="0.95"
          />
          <circle cx="12" cy="12" r="2.5" fill="white" />
        </svg>
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
      </div>
      {showWordmark && !collapsed && (
        <div className="flex flex-col leading-none">
          <span className="font-bold tracking-tight text-[18px] text-slate-900 dark:text-white">Bliss</span>
          <span className="text-[10px] tracking-[0.18em] uppercase text-[#94A3B8] font-medium">AI Workspace</span>
        </div>
      )}
    </div>
  );
}
