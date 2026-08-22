// ui.tsx — shared primitive library.
//
// One source of truth for controls and surfaces. Compose with `cx`/`className`
// overrides (later classes win for non-conflicting utilities). All primitives
// read from the semantic tokens in app.css.

/** Join class strings, dropping falsy values. Later classes override via cascade. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── Form controls ──────────────────────────────────────────────────────────

export const inputClass =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";

/** One label recipe for all forms/drawers (replaces the 3 competing styles). */
export const labelClass = "grid gap-1 text-sm font-medium text-text";

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputClass, className)} {...props} />;
}

export function Textarea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputClass, className)} {...props} />;
}

export function Select({
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputClass, className)} {...props} />;
}

// ── Buttons ────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-copper text-ink hover:bg-copper/90",
  secondary: "border border-border font-medium text-text hover:border-copper",
  destructive: "bg-hot text-surface hover:bg-hot/90",
  ghost: "text-text hover:bg-ink/5",
};

export const buttonBase =
  "rounded-md text-sm font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors";

const buttonSizes: Record<ButtonSize, string> = {
  sm: "px-3 h-9 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 h-11 text-sm",
  icon: "w-9 h-9 inline-flex items-center justify-center",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cx(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
}

// ── Surfaces ───────────────────────────────────────────────────────────────

export function Card({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("rounded-lg border border-border bg-surface p-5 shadow-tile", className)}
      {...props}
    />
  );
}

type BadgeTone = "neutral" | "copper" | "cool" | "warm" | "hot";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-ink/5 text-muted border-border",
  copper: "bg-copper/10 text-copper border-copper/20",
  cool: "bg-cool/10 text-cool border-cool/20",
  warm: "bg-warm/10 text-warm border-warm/20",
  hot: "bg-hot/10 text-hot border-hot/20",
};

export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-sans font-medium leading-none",
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-paper px-1 font-mono text-[11px] text-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Pulse-loading placeholder. Use width/height via className. */
export function Skeleton({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cx("animate-pulse rounded-md bg-ink/10", className)}
      {...props}
    />
  );
}

/** Centered empty-state block with optional leading icon node. */
export function EmptyState({
  icon,
  title,
  body,
  children,
  className = "",
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-3 py-16 px-6 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-paper">
          {icon}
        </div>
      ) : null}
      <p className="font-sans font-medium text-text">{title}</p>
      {body ? <p className="max-w-xs font-sans text-sm text-muted">{body}</p> : null}
      {children}
    </div>
  );
}
