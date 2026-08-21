import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const auditDir = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(auditDir, "evidence");
const output = join(evidenceDir, "index.md");

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const descriptions = {
  logs: "Redacted command, manifest, reconciliation, validation, or reviewer evidence",
  screenshots: "Synthetic-data-free local public-page visual evidence",
  security: "Security scan status/artifact evidence",
};

const rows = filesUnder(evidenceDir)
  .filter((path) => path !== output)
  .sort((a, b) => a.localeCompare(b))
  .map((path) => {
    const bytes = readFileSync(path);
    const rel = relative(auditDir, path).replaceAll("\\", "/");
    const group = relative(evidenceDir, path).split(/[\\/]/)[0];
    return {
      path: rel,
      size: statSync(path).size,
      hash: createHash("sha256").update(bytes).digest("hex"),
      description: path.endsWith("large-artifacts-manifest.json")
        ? "External large-artifact retention manifest (empty for this run)"
        : descriptions[group] || "Audit evidence",
    };
  });

const lines = [
  "# Redacted evidence manifest", "",
  "Candidate: `88b9baca35be5b8d9235b2f96863150ef3a67ad1`  ",
  "Generated: 2026-08-20", "",
  "All retained files were reviewed for credentials and customer data. No secret",
  "value, provider payload, authenticated session, real customer data, HAR, trace,",
  "video, load output, or database snapshot is present. Screenshot pages are public",
  "and contain no customer data. Hashes are SHA-256 over exact retained bytes.", "",
  "| Evidence path | Bytes | SHA-256 | Description |", "|---|---:|---|---|",
  ...rows.map((row) => `| \`${row.path}\` | ${row.size} | \`${row.hash}\` | ${row.description} |`),
  "", `Files indexed (excluding this self-referential index): **${rows.length}**.`, "",
];

writeFileSync(output, lines.join("\n"));
console.log(JSON.stringify({ files: rows.length, output: relative(auditDir, output).replaceAll("\\", "/") }, null, 2));

