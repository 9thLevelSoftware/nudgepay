// Pure US/USD gate for QBO connect. No I/O — parses CompanyInfo (minorversion 65)
// and related currency shapes (HomeCurrency, CurrencyRef, CurrencyPrefs).

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  return null;
}

/** String or QBO RefType `{ value }` / `{ Value }`. */
function refValue(v: unknown): string | null {
  const direct = str(v);
  if (direct) return direct;
  const rec = asRecord(v);
  if (!rec) return null;
  return str(rec.value) ?? str(rec.Value);
}

function unwrapCompany(info: unknown): Record<string, unknown> | null {
  const rec = asRecord(info);
  if (!rec) return null;
  return asRecord(rec.CompanyInfo) ?? rec;
}

function countryOf(info: Record<string, unknown>): string | null {
  return (
    str(info.Country) ??
    str(info.country) ??
    refValue(asRecord(info.CompanyAddr)?.Country) ??
    str(asRecord(info.CompanyAddr)?.Country) ??
    refValue(asRecord(info.LegalAddr)?.Country) ??
    str(asRecord(info.LegalAddr)?.Country)
  );
}

function nameValueCurrency(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  for (const row of v) {
    const rec = asRecord(row);
    if (!rec) continue;
    const name = (str(rec.Name) ?? str(rec.name) ?? "").toLowerCase();
    if (name === "homecurrency" || name === "currency" || name === "homecurrencycode") {
      const val = str(rec.Value) ?? str(rec.value);
      if (val) return val;
    }
  }
  return null;
}

function currencyOf(info: Record<string, unknown>): string | null {
  const prefs = asRecord(info.CurrencyPrefs)
    ?? asRecord(asRecord(info.Preferences)?.CurrencyPrefs);
  return (
    refValue(info.HomeCurrency) ??
    refValue(info.homeCurrency) ??
    refValue(prefs?.HomeCurrency) ??
    refValue(info.CurrencyRef) ??
    refValue(info.Currency) ??
    nameValueCurrency(info.NameValue)
  );
}

function letters(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}

function isUsCountry(raw: string): boolean {
  const n = letters(raw);
  return n === "US" || n === "USA" || n === "UNITEDSTATES" || n === "UNITEDSTATESOFAMERICA";
}

/**
 * True when CompanyInfo is a US company billed in USD.
 * Missing currency is allowed (CompanyInfo often omits HomeCurrency); a
 * present non-USD currency is rejected. Missing/unreadable country is false.
 */
export function isSupportedQboCompany(info: unknown): boolean {
  const company = unwrapCompany(info);
  if (!company) return false;
  const country = countryOf(company);
  if (!country || !isUsCountry(country)) return false;
  const currency = currencyOf(company);
  if (currency && letters(currency) !== "USD") return false;
  return true;
}
