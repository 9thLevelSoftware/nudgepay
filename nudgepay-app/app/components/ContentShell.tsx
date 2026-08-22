// ContentShell — the one layout policy for authenticated content areas.
//
// Three page archetypes control width + padding:
//   "workspace" — full-bleed app surfaces (dashboard, reports); no max-width,
//                 horizontal gutter only.
//   "split"     — list + side-panel surfaces (accounts, promises, messages);
//                 padded, no max-width (the grid rail provides structure).
//   "detail"    — reading-centered pages (account profile, settings);
//                 padded and centered at a max-width.
//
// Adopt this instead of hand-writing p-4 sm:p-6 / px-6 / max-w-* per route.

import { cx } from "./ui";

export function ContentShell({
  type = "workspace",
  className = "",
  children,
}: {
  type?: "workspace" | "split" | "detail";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        type === "workspace" && "px-6 py-5",
        type === "split" && "p-4 sm:p-6",
        type === "detail" && "mx-auto w-full max-w-5xl p-4 sm:p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
