import { CSP_REPORT_PATH } from "./security-headers";

export const APP_BODY_LIMIT_BYTES = 256 * 1024;
export const CSP_REPORT_BODY_LIMIT_BYTES = 64 * 1024;
export const PROVIDER_WEBHOOK_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

type RequestBoundaryResult =
  | { ok: true; request: Request }
  | { ok: false; response: Response };

type RequestPolicy = {
  limitBytes: number;
  mediaTypes: readonly string[];
};

const FORM_MEDIA_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "application/json",
] as const;

const WEBHOOK_POLICIES: Record<string, RequestPolicy> = {
  "/webhooks/qbo": { limitBytes: PROVIDER_WEBHOOK_BODY_LIMIT_BYTES, mediaTypes: ["application/json"] },
  "/webhooks/resend": { limitBytes: PROVIDER_WEBHOOK_BODY_LIMIT_BYTES, mediaTypes: ["application/json"] },
  "/webhooks/stripe": { limitBytes: PROVIDER_WEBHOOK_BODY_LIMIT_BYTES, mediaTypes: ["application/json"] },
  "/webhooks/twilio/inbound": {
    limitBytes: PROVIDER_WEBHOOK_BODY_LIMIT_BYTES,
    mediaTypes: ["application/x-www-form-urlencoded"],
  },
  "/webhooks/twilio/status": {
    limitBytes: PROVIDER_WEBHOOK_BODY_LIMIT_BYTES,
    mediaTypes: ["application/x-www-form-urlencoded"],
  },
};

const CSP_REPORT_POLICY: RequestPolicy = {
  limitBytes: CSP_REPORT_BODY_LIMIT_BYTES,
  mediaTypes: ["application/csp-report", "application/reports+json", "application/json"],
};

const APP_POLICY: RequestPolicy = {
  limitBytes: APP_BODY_LIMIT_BYTES,
  mediaTypes: FORM_MEDIA_TYPES,
};

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function policyFor(pathname: string): RequestPolicy {
  if (pathname === CSP_REPORT_PATH) return CSP_REPORT_POLICY;
  return WEBHOOK_POLICIES[pathname] ?? APP_POLICY;
}

function parseContentLength(value: string | null): number | null | "invalid" {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return "invalid";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : "invalid";
}

function mediaType(value: string | null): string | null {
  if (!value) return null;
  const type = value.split(";", 1)[0]?.trim().toLowerCase();
  return type || null;
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  limitBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        try {
          await reader.cancel("request body too large");
        } catch {
          // The request is already rejected; a source cancellation error does
          // not turn a deterministic 413 into an application 500.
        }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Validates and bounds mutating request bodies before React Router parsers run.
 * The reconstructed Request contains the exact bytes read from the original,
 * which keeps provider signature verification stable.
 */
export async function applyRequestBoundary(request: Request): Promise<RequestBoundaryResult> {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return { ok: true, request };

  const policy = policyFor(new URL(request.url).pathname);
  const declaredLength = parseContentLength(request.headers.get("content-length"));
  if (declaredLength === "invalid") {
    return { ok: false, response: errorResponse(400, "invalid content-length") };
  }
  if (declaredLength !== null && declaredLength > policy.limitBytes) {
    return { ok: false, response: errorResponse(413, "payload too large") };
  }

  if (request.body === null) return { ok: true, request };

  const type = mediaType(request.headers.get("content-type"));
  if (!type || !policy.mediaTypes.includes(type)) {
    return { ok: false, response: errorResponse(415, "unsupported media type") };
  }

  const bytes = await readBoundedBody(request.body, policy.limitBytes);
  if (bytes === null) return { ok: false, response: errorResponse(413, "payload too large") };

  return { ok: true, request: new Request(request, { body: bytes }) };
}
