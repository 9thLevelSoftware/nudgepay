import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const readJson = (path) => JSON.parse(readFileSync(join(repo, path), "utf8"));
const fail = (message) => { throw new Error(message); };
const requiredStrings = (object, keys, label) => {
  for (const key of keys) if (typeof object[key] !== "string" || !object[key].trim()) fail(`${label}.${key} must be a non-empty string`);
};

const findingsPath = "docs/audits/2026-08-20-production-readiness/findings.json";
const registryPath = "docs/audits/2026-08-20-production-readiness/evidence/logs/prior-corpus-registry.json";
const manifestPath = "docs/audits/2026-08-20-production-readiness/evidence/logs/release-candidate-manifest.json";
const findings = readJson(findingsPath);
const registry = readJson(registryPath);
const manifest = readJson(manifestPath);

if (!Array.isArray(findings) || findings.length === 0) fail("findings.json must be a non-empty array");
if (!Array.isArray(registry.entries) || registry.entries.length !== 398) fail(`Expected 398 prior entries, got ${registry.entries?.length}`);
if (manifest.baseline?.commit !== "820fb1ba035f96d1470ca3b8a2bf4a73b62245bc" || manifest.head?.commit !== "88b9baca35be5b8d9235b2f96863150ef3a67ad1") fail("Release manifest baseline or candidate SHA drifted");
const corpusHashMismatches = manifest.prior_audit_corpus.filter((entry) => createHash("sha256").update(readFileSync(join(repo, entry.path))).digest("hex").toUpperCase() !== entry.sha256);
if (corpusHashMismatches.length) fail(`Prior corpus changed after freeze: ${corpusHashMismatches.map((entry) => entry.path).join(", ")}`);

const allowed = {
  domain: new Set(["functionality", "workflow", "security", "privacy", "data-integrity", "accessibility", "ux-ui", "performance", "integration", "operations", "compliance", "maintainability"]),
  severity: new Set(["critical", "high", "medium", "low", "informational"]),
  releaseGate: new Set(["blocker", "conditional", "non-blocking"]),
  confidence: new Set(["high", "medium", "low"]),
  verificationState: new Set(["static-only", "automated-tested", "browser-verified", "provider-verified", "environment-blocked"]),
  environment: new Set(["static", "local", "cloudflare-staging", "render-staging"]),
  role: new Set(["anonymous", "invitee", "member", "owner", "operator", "provider"]),
  disposition: new Set(["fixed", "partially-fixed", "still-open", "superseded", "duplicate-merged", "not-a-defect", "unverified", "regressed"]),
  owner: new Set(["frontend", "backend", "database", "security", "devops", "product", "legal"]),
  size: new Set(["XS", "S", "M", "L", "XL"]),
};

const ids = new Set();
const aliasKeys = new Set();
for (const finding of findings) {
  requiredStrings(finding, ["id", "title", "domain", "severity", "releaseGate", "confidence", "verificationState", "expectedBehavior", "actualBehavior", "rootCause", "impact", "suggestedOwner", "estimatedSize"], finding.id || "finding");
  if (!/^NP-AUD-2026-[A-Z0-9-]+$/.test(finding.id)) fail(`Invalid finding ID ${finding.id}`);
  if (ids.has(finding.id)) fail(`Duplicate finding ID ${finding.id}`);
  ids.add(finding.id);
  for (const key of ["domain", "severity", "releaseGate", "confidence", "verificationState"]) if (!allowed[key].has(finding[key])) fail(`${finding.id} has invalid ${key}`);
  if (!allowed.owner.has(finding.suggestedOwner) || !allowed.size.has(finding.estimatedSize)) fail(`${finding.id} has invalid owner or size`);
  if (!Number.isInteger(finding.fixOrder) || finding.fixOrder < 1) fail(`${finding.id} has invalid fixOrder`);
  for (const [key, values, type, allowEmpty = false] of [
    ["aliases", finding.aliases, "object"], ["environments", finding.environments, "string"],
    ["affectedRoles", finding.affectedRoles, "string"], ["affectedRoutes", finding.affectedRoutes, "string", true],
    ["sourceLocations", finding.sourceLocations, "object"], ["prerequisites", finding.prerequisites, "string"],
    ["reproductionSteps", finding.reproductionSteps, "string"], ["evidence", finding.evidence, "object"],
  ]) {
    if (!Array.isArray(values) || (!allowEmpty && values.length === 0) || values.some((value) => typeof value !== type)) fail(`${finding.id}.${key} must be ${allowEmpty ? "an" : "a non-empty"} ${type} array`);
  }
  if (finding.environments.some((value) => !allowed.environment.has(value))) fail(`${finding.id} has invalid environment`);
  if (finding.affectedRoles.some((value) => !allowed.role.has(value))) fail(`${finding.id} has invalid role`);
  for (const alias of finding.aliases) {
    requiredStrings(alias, ["corpus", "id", "sourcePath", "disposition"], `${finding.id}.alias`);
    if (!allowed.disposition.has(alias.disposition)) fail(`${finding.id} has invalid alias disposition`);
    aliasKeys.add(`${alias.corpus}|${alias.id}|${alias.sourcePath}`);
  }
  for (const location of finding.sourceLocations) requiredStrings(location, ["path"], `${finding.id}.sourceLocation`);
  for (const evidence of finding.evidence) {
    requiredStrings(evidence, ["kind", "path", "description"], `${finding.id}.evidence`);
    if (!/^https?:/.test(evidence.path) && !existsSync(join(repo, evidence.path))) fail(`${finding.id} evidence path does not exist: ${evidence.path}`);
  }
  const remediation = finding.remediation;
  if (!remediation || typeof remediation !== "object") fail(`${finding.id}.remediation missing`);
  requiredStrings(remediation, ["approach"], `${finding.id}.remediation`);
  for (const key of ["filesLikelyAffected", "migrationOrCompatibilityNotes", "testsToAdd", "acceptanceCriteria", "dependencies"]) if (!Array.isArray(remediation[key])) fail(`${finding.id}.remediation.${key} must be an array`);
  if (finding.domain === "security") {
    if (!finding.security) fail(`${finding.id}.security missing`);
    requiredStrings(finding.security, ["attacker", "trustBoundary", "attackPath", "counterevidence"], `${finding.id}.security`);
  }
}

const expectedAliasKey = (entry) => {
  if (entry.namespacedId.startsWith("july13::")) return `july-13|${entry.sourceId}|${entry.sourcePath}`;
  if (entry.namespacedId.startsWith("canonical::")) return `august-20-canonical|${entry.sourceId}|${entry.sourcePath}`;
  const relativeWave = entry.sourcePath.replace("docs/production-audit-2026-08-20/", "").replace(/\.md$/, "").replaceAll("/", ":");
  return `august-20-wave|AUG20:${relativeWave}:${entry.sourceId}|${entry.sourcePath}`;
};
const unmapped = registry.entries.filter((entry) => !aliasKeys.has(expectedAliasKey(entry)));
if (unmapped.length) fail(`Unmapped prior entries: ${unmapped.map((entry) => entry.namespacedId).join(", ")}`);

const high = findings.filter((finding) => finding.severity === "high").map((finding) => finding.id).sort();
const reviewRows = [];
for (const name of ["high-finding-review-a.md", "high-finding-review-b.md"]) {
  const text = readFileSync(join(here, "evidence", "logs", name), "utf8");
  for (const match of text.matchAll(/^\|\s*\d+\s*\|\s*`?(NP-AUD-2026-[A-Z0-9-]+)`?\s*\|\s*(PASS|FAIL|BLOCKED)\s*\|/gm)) reviewRows.push({ id: match[1], verdict: match[2], file: name });
}
const highReviewCounts = new Map(high.map((id) => [id, reviewRows.filter((row) => row.id === id).length]));
const missingReview = [...highReviewCounts].filter(([, count]) => count !== 1);
if (missingReview.length) fail(`High review coverage must be exactly one row per finding: ${JSON.stringify(missingReview)}`);
if (reviewRows.some((row) => row.verdict === "FAIL")) fail("An independent high review contradicted a ledger finding");

const auditFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? auditFiles(path) : [path];
});
const credentialAssignment = /(?:SUPABASE_SERVICE_ROLE_KEY|TWILIO_AUTH_TOKEN|QBO_CLIENT_SECRET|RESEND_API_KEY|UNSUBSCRIBE_SECRET|QBO_TOKEN_ENCRYPTION_KEY)"?\s*(?::|=)\s*"?(?!(?:unset|redacted|missing|placeholder|<))[A-Za-z0-9_./+=-]{12,}/i;
const credentialHits = auditFiles(here)
  .filter((path) => !path.endsWith(".png"))
  .filter((path) => credentialAssignment.test(readFileSync(path, "utf8")));
if (credentialHits.length) fail(`Potential credential assignments in audit pack: ${credentialHits.map((path) => relative(repo, path)).join(", ")}`);

const counts = {
  total: findings.length,
  priorEntries: registry.entries.length,
  high: high.length,
  reviewedHigh: reviewRows.length,
  reviewPass: reviewRows.filter((row) => row.verdict === "PASS").length,
  reviewBlocked: reviewRows.filter((row) => row.verdict === "BLOCKED").length,
  sourceAliasesCovered: registry.entries.length - unmapped.length,
  credentialAssignmentHits: credentialHits.length,
  priorCorpusHashesUnchanged: manifest.prior_audit_corpus.length - corpusHashMismatches.length,
};
const hash = createHash("sha256").update(readFileSync(join(repo, findingsPath))).digest("hex");
const report = [
  "# Audit-pack validation", "",
  `Validated candidate ledger on 2026-08-20.`, "",
  "| Check | Result |", "|---|---:|",
  `| JSON findings | ${counts.total} |`,
  `| Unique finding IDs | ${ids.size} |`,
  `| Prior source entries mapped | ${counts.sourceAliasesCovered} / ${counts.priorEntries} |`,
  `| Frozen prior-corpus files unchanged | ${counts.priorCorpusHashesUnchanged} / ${manifest.prior_audit_corpus.length} |`,
  `| High findings independently reviewed exactly once | ${counts.reviewedHigh} / ${counts.high} |`,
  `| High review supported-open | ${counts.reviewPass} |`,
  `| High review environment-blocked | ${counts.reviewBlocked} |`,
  `| High review contradicted | 0 |`,
  `| Credential-like secret assignments | ${counts.credentialAssignmentHits} |`, "",
  `Ledger SHA-256: \`${hash}\``, "",
  "Schema enums, required fields, remediation arrays, evidence paths, unique IDs, prior-corpus alias coverage, and independent high-review coverage passed.", "",
];
writeFileSync(join(here, "evidence", "logs", "audit-pack-validation.md"), report.join("\n"));
console.log(JSON.stringify({ ok: true, counts, ledgerSha256: hash }, null, 2));
