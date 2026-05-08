/** Abbreviated unit label: "Lakhs" → "L", "Crores" → "Cr", etc. */
export function unitAbbr(unit: string | null | undefined): string {
  if (!unit) return "";
  const u = unit.toLowerCase();
  if (u.includes("crore")) return "Cr";
  if (u.includes("lakh"))  return "L";
  if (u.includes("million")) return "M";
  if (u.includes("thousand")) return "K";
  return "";
}

/** Full normalised unit label for panel tickers: "Lakhs" → "₹ Lakhs", "USD Millions" → "USD Millions" */
export function fmtUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  const u = unit.trim();
  if (/^inr/i.test(u)) return "₹ " + u.replace(/^inr\s*/i, "").trim();
  if (/lakh|crore|thousand/i.test(u)) return "₹ " + u;
  return u;
}
