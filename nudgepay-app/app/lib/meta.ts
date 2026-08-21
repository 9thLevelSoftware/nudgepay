export const PAGE_DESCRIPTION =
  "NudgePay is collections software for trades and small businesses.";

export function pageTitle(section?: string) {
  return [
    { title: section ? `${section} · NudgePay` : "NudgePay" },
    { name: "description", content: PAGE_DESCRIPTION },
  ];
}
