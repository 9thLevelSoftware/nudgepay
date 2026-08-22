import { Link } from "react-router";
import type { ArKpis } from "../lib/ar-kpis";
import { formatUSD } from "../lib/format";
import { MetricTile } from "./MetricTile";

const PARTIAL_TITLE =
  "Based on the last 5,000 synced invoices. Credit memos change balances but are not collections.";

function formatDays(n: number | null): string {
  if (n == null) return "—";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}d` : `${rounded.toFixed(1)}d`;
}

function formatCei(n: number | null): string {
  if (n == null) return "—";
  return `${Math.round(n)}%`;
}

function formatShare(n: number | null): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

export function ArKpiBand({ kpis, isOwner }: { kpis: ArKpis; isOwner: boolean }) {
  const empty = kpis.coverage === "empty";
  const emptySub = "Connect QuickBooks";
  const heading = `Receivables (${kpis.rangeDays}d)`;

  const dsoValue = empty ? "—" : formatDays(kpis.dso);
  const dsoSub = empty ? emptySub : `Best possible ${formatDays(kpis.bestPossibleDso)}`;
  const ceiValue = empty ? "—" : formatCei(kpis.cei);
  const ceiSub = empty ? emptySub : `${kpis.rangeDays}-day collections effectiveness`;
  const contactValue = empty ? "—" : formatShare(kpis.contactRate);
  const contactSub = empty
    ? emptySub
    : `${kpis.inputs.contactedOpenCases} / ${kpis.inputs.openCases} open cases`;
  const promiseValue = empty ? "—" : formatShare(kpis.promiseRate);
  const promiseSub = empty ? emptySub : "of contacted";
  const collectedValue = empty ? "—" : formatUSD(kpis.collected);
  const collectedSub = empty ? emptySub : `last ${kpis.rangeDays} days`;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xs font-sans font-semibold text-text">
          {isOwner ? (
            <Link
              to="/reports"
              className="text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
            >
              {heading}
            </Link>
          ) : (
            heading
          )}
        </h2>
        {kpis.coverage === "partial" ? (
          <span
            className="inline-flex items-center rounded-md bg-copper/10 border border-copper/20 px-2 py-0.5 text-[10px] font-sans font-medium text-copper"
            title={PARTIAL_TITLE}
          >
            Partial history
          </span>
        ) : null}
      </div>
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        aria-label={`Receivables KPIs, last ${kpis.rangeDays} days`}
      >
        <MetricTile
          label="DSO"
          value={dsoValue}
          sub={dsoSub}
          accent="ink"
          ariaLabel={`DSO: ${dsoValue}. ${dsoSub}`}
        />
        <MetricTile
          label="CEI"
          value={ceiValue}
          sub={ceiSub}
          accent="copper"
          ariaLabel={`CEI: ${ceiValue}. ${ceiSub}`}
        />
        <MetricTile
          label="Contact"
          value={contactValue}
          sub={contactSub}
          accent="cool"
          ariaLabel={`Contact: ${contactValue}. ${contactSub}`}
        />
        <MetricTile
          label="Promise"
          value={promiseValue}
          sub={promiseSub}
          accent="neutral"
          ariaLabel={`Promise: ${promiseValue}. ${promiseSub}`}
        />
        <MetricTile
          label="Collected"
          value={collectedValue}
          sub={collectedSub}
          accent="cool"
          ariaLabel={`Collected: ${collectedValue}. ${collectedSub}`}
        />
      </div>
    </div>
  );
}
