import { Link } from "react-router";
import { MAIN_CONTENT_ID, SkipLink } from "./ui";

export function PublicLayout({ title, width = "card", children }: {
  title?: string;
  width?: "card" | "prose";
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen flex flex-col bg-surface">
      <SkipLink />
      {/* Brand header with a subtle copper accent rule */}
      <header className="border-b border-border px-6 py-4">
        <Link to="/" className="font-display text-[17px] font-semibold tracking-tight">
          <span className="text-copper">Nudge</span><span className="text-text">Pay</span>
        </Link>
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className={width === "card"
          ? "flex flex-1 items-center justify-center p-6"
          : "flex flex-1 justify-center p-6"}
      >
        <div className={width === "card"
          ? "w-full max-w-md rounded-lg border border-border bg-panel p-6 shadow-tile"
          : "w-full max-w-2xl"}>
          {title && <h1 className="mb-4 font-display text-lg font-semibold text-text">{title}</h1>}
          {children}
        </div>
      </main>
      <footer className="border-t border-border px-6 py-4">
        <nav className="flex items-center justify-center gap-4 text-xs text-muted" aria-label="Legal">
          <Link to="/privacy" className="hover:text-text">Privacy</Link>
          <span aria-hidden="true" className="text-border">·</span>
          <Link to="/eula" className="hover:text-text">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
