export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-label="Loading"
    />
  );
}

export function FullPageSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-surface-2 text-muted">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-7 w-7 text-zoom-blue" />
        <p className="text-sm">{label}…</p>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
      <p className="text-sm font-semibold text-body">{title}</p>
      {detail && <p className="mt-1 max-w-sm text-xs text-muted">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
