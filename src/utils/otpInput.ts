// Native notification OTPs and legacy TOTP advertise their own input format.
// Missing metadata retains compatibility with the previous six-digit server.
export type OTPFormat = { length: number; alphanumeric: boolean };
export function otpFormat(prompt: unknown): OTPFormat {
  const data = prompt as { length?: number; digits?: number; charset?: string } | undefined;
  if (data?.length === 8 && data.charset === "alphanumeric") return { length: 8, alphanumeric: true };
  return { length: 6, alphanumeric: false };
}
export function normalizeOTP(value: string, format: OTPFormat): string {
  return (format.alphanumeric ? value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() : value.replace(/[^0-9]/g, "")).slice(0, format.length);
}
export function validOTP(value: string, format: OTPFormat): boolean {
  return format.alphanumeric ? /^[A-Za-z0-9]{8}$/.test(value) : /^[0-9]{6}$/.test(value);
}
