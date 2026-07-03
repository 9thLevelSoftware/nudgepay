// Curated IANA timezone list for the org timezone picker.
// ~35 common zones grouped by region — full Intl.supportedValuesOf("timeZone")
// lists 400+ entries and makes the UX worse, not better.

export type TimezoneOption = { value: string; label: string };
export type TimezoneGroup = { region: string; zones: TimezoneOption[] };

export const TIMEZONE_GROUPS: TimezoneGroup[] = [
  {
    region: "United States",
    zones: [
      { value: "America/New_York",    label: "Eastern (ET)" },
      { value: "America/Chicago",     label: "Central (CT)" },
      { value: "America/Denver",      label: "Mountain (MT)" },
      { value: "America/Los_Angeles", label: "Pacific (PT)" },
      { value: "America/Anchorage",   label: "Alaska (AKT)" },
      { value: "Pacific/Honolulu",    label: "Hawaii (HT)" },
    ],
  },
  {
    region: "Canada",
    zones: [
      { value: "America/Toronto",   label: "Eastern (ET)" },
      { value: "America/Winnipeg",  label: "Central (CT)" },
      { value: "America/Edmonton",  label: "Mountain (MT)" },
      { value: "America/Vancouver", label: "Pacific (PT)" },
      { value: "America/Halifax",   label: "Atlantic (AT)" },
      { value: "America/St_Johns",  label: "Newfoundland (NT)" },
    ],
  },
  {
    region: "Europe",
    zones: [
      { value: "Europe/London",    label: "London (GMT/BST)" },
      { value: "Europe/Paris",     label: "Paris (CET/CEST)" },
      { value: "Europe/Berlin",    label: "Berlin (CET/CEST)" },
      { value: "Europe/Madrid",    label: "Madrid (CET/CEST)" },
      { value: "Europe/Rome",      label: "Rome (CET/CEST)" },
      { value: "Europe/Amsterdam", label: "Amsterdam (CET/CEST)" },
    ],
  },
  {
    region: "Australia & Pacific",
    zones: [
      { value: "Australia/Sydney",    label: "Sydney (AEST/AEDT)" },
      { value: "Australia/Melbourne", label: "Melbourne (AEST/AEDT)" },
      { value: "Australia/Brisbane",  label: "Brisbane (AEST)" },
      { value: "Australia/Perth",     label: "Perth (AWST)" },
      { value: "Pacific/Auckland",    label: "Auckland (NZST/NZDT)" },
    ],
  },
  {
    region: "Asia",
    zones: [
      { value: "Asia/Tokyo",     label: "Tokyo (JST)" },
      { value: "Asia/Shanghai",  label: "Shanghai (CST)" },
      { value: "Asia/Kolkata",   label: "Kolkata (IST)" },
      { value: "Asia/Dubai",     label: "Dubai (GST)" },
      { value: "Asia/Singapore", label: "Singapore (SGT)" },
    ],
  },
  {
    region: "Other",
    zones: [
      { value: "America/Mexico_City",  label: "Mexico City (CST/CDT)" },
      { value: "America/Sao_Paulo",    label: "São Paulo (BRT)" },
      { value: "America/Buenos_Aires", label: "Buenos Aires (ART)" },
      { value: "Africa/Johannesburg",  label: "Johannesburg (SAST)" },
      { value: "Africa/Lagos",         label: "Lagos (WAT)" },
    ],
  },
];

/** Flat list of all timezone values for validation. */
export const ALL_TIMEZONE_VALUES: ReadonlySet<string> = new Set(
  TIMEZONE_GROUPS.flatMap((g) => g.zones.map((z) => z.value)),
);
