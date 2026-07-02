import { Link } from "react-router";

export function PublicLayout({ title, width = "card", children }: {
  title?: string;
  width?: "card" | "prose";
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <header className="px-6 py-4">
        <Link to="/" className="font-display text-[17px] font-semibold tracking-tight">
          <span className="text-copper">Nudge</span><span className="text-ink">Pay</span>
        </Link>
      </header>
      <main className={width === "card"
        ? "flex flex-1 items-center justify-center p-6"
        : "flex flex-1 justify-center p-6"}>
        <div className={width === "card"
          ? "w-full max-w-md rounded-lg border border-border bg-panel p-6"
          : "w-full max-w-2xl"}>
          {title && <h1 className="font-display text-lg font-semibold text-text mb-4">{title}</h1>}
          {children}
        </div>
      </main>
    </div>
  );
}
