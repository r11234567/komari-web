// Billing GB is decimal, matching provider calibration. Explicit GiB remains
// available for providers that really bill in binary units. Other resource
// parsers (RAM, disks, transfer rates) are intentionally independent.
export function parseTrafficQuota(input: string): number | null {
  const match = /^([0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?(?:\s*\*\s*[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?)*)\s*(B|[KMGTPE]i?B|[KMGTPE])?$/i.exec(input.trim());
  if (!match) return null;
  const unit = (match[2] ?? "B").toUpperCase();
  const power = "BKMGTPE".indexOf(unit[0]);
  const multiplier = (unit.includes("I") ? 1024 : 1000) ** power;
  const bytes = Math.round(match[1].split("*").reduce((value, part) => value * Number(part.trim()), 1) * multiplier);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

// Editing and saving an unrelated field must never round an existing quota.
export function trafficQuotaInput(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return "0 GB";
  const value = BigInt(bytes);
  const whole = value / 1_000_000_000n;
  const fraction = String(value % 1_000_000_000n).padStart(9, "0").replace(/0+$/, "");
  return `${whole}${fraction ? "." + fraction : ""} GB`;
}
