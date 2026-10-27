export function BlissMark({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path
          d="M12 3L14.5 8.6L21 9.3L16.2 13.9L17.5 21L12 17.6L6.5 21L7.8 13.9L3 9.3L9.5 8.6L12 3Z"
          fill="currentColor"
          fillOpacity="0.95"
        />
      </svg>
    </span>
  );
}
