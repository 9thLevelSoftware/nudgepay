export const PAGE_DESCRIPTION =
  "NudgePay is collections software for trades and small businesses.";

export const SUPPORT_EMAIL = "support@nudgepay-ar.app";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

export function pageTitle(section?: string) {
  return [
    { title: section ? `${section} · NudgePay` : "NudgePay" },
    { name: "description", content: PAGE_DESCRIPTION },
  ];
}
