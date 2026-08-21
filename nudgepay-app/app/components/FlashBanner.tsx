export function FlashBanner({
  tone,
  text,
}: {
  tone: "ok" | "warn" | "err";
  text: string;
}) {
  const cls =
    tone === "ok"
      ? "bg-cool/10 border-cool/30 text-cool"
      : tone === "warn"
        ? "bg-warm/10 border-warm/30 text-warm"
        : "bg-hot/10 border-hot/30 text-hot";
  return (
    <div className={`px-6 py-2 border-b text-sm font-sans font-medium ${cls}`} role={tone === "ok" ? "status" : "alert"}>
      {text}
    </div>
  );
}
