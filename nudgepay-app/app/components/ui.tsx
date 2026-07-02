export const inputClass =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";

export const buttonVariants = {
  primary: "bg-copper text-ink hover:bg-copper/90",
  secondary: "border border-border font-medium text-text hover:border-copper",
};
export const buttonBase =
  "rounded-md text-sm font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const sizes = {
    sm: "px-3 h-9 text-xs",
    md: "px-4 py-2 text-sm",
  };
  return (
    <button className={`${buttonBase} ${buttonVariants[variant]} ${sizes[size]} ${className}`} {...props} />
  );
}
