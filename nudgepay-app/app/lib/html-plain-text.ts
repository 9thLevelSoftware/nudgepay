// Convert HTML-only inbound bodies to readable plain text. No I/O.

const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BREAK = /<br\s*\/?>/gi;
const BLOCK_END = /<\/(p|div|h[1-6]|li|tr|blockquote|pre|table|section|article|header|footer)>/gi;
const TAG = /<[^>]+>/g;
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, ent: string) => {
    const key = ent.toLowerCase();
    if (key in NAMED) return NAMED[key];
    if (key.startsWith("#x")) {
      const n = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : full;
    }
    if (key.startsWith("#")) {
      const n = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(n) ? String.fromCharCode(n) : full;
    }
    return full;
  });
}

export function htmlToPlainText(html: string): string {
  let s = html.replace(SCRIPT_OR_STYLE, " ");
  s = s.replace(BREAK, "\n");
  s = s.replace(BLOCK_END, "\n");
  s = s.replace(TAG, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function inboundEmailBody(text: string, html: string): string {
  const plain = text.trim();
  if (plain) return plain;
  const markup = html.trim();
  if (!markup) return "";
  return htmlToPlainText(markup);
}
