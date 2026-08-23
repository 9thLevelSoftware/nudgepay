export function TruncationBanner() {
  return (
    <div
      role="status"
      className="rounded-md border border-warm/30 bg-warm/10 px-3 py-2 text-sm font-sans text-warm"
    >
      This list is incomplete (over 5,000 rows). Totals may under-count.
    </div>
  );
}
