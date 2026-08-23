export type UnmatchedStopRow = {
  id: string;
  fromNumber: string;
};

export function UnmatchedStopList({ stops }: { stops: UnmatchedStopRow[] }) {
  if (stops.length === 0) return null;
  return (
    <section className="rounded-lg border border-warm/30 bg-warm/5 p-4" role="status">
      <h2 className="font-display text-sm font-semibold text-text">Unmatched STOP</h2>
      <p className="mt-1 text-xs text-muted">
        STOP received from an unknown number — not applied to a customer.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {stops.map((s) => (
          <li key={s.id} className="text-xs tabular-nums text-text">{s.fromNumber || "Unknown number"}</li>
        ))}
      </ul>
    </section>
  );
}
