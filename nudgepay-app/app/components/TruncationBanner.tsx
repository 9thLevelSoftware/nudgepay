export function TruncationBanner({ message }: { message?: string } = {}) {
  return (
    <div
      role="status"
      className="rounded-md border border-warm/30 bg-warm/10 px-3 py-2 text-sm font-sans text-warm"
    >
      {message ?? "This list is incomplete (over 5,000 rows). Totals may under-count."}
    </div>
  );
}

export function LoadErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-hot/30 bg-hot/10 px-3 py-2 text-sm font-sans text-hot"
    >
      {message}
    </div>
  );
}
