export const inputClass =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
}) {
  const base = "rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors";
  const variants = {
    primary: "bg-copper text-ink hover:bg-copper/90",
    secondary: "border border-border font-medium text-text hover:border-copper",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props} />
  );
}
