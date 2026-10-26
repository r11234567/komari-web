// Match the backend's JSON encoding of public target identifiers. Go escapes
// U+2028/U+2029 even with HTML escaping disabled; preserve those bytes here.
export async function credentialActionResource(action: string, targets: readonly string[]): Promise<string> {
  const canonical = JSON.stringify(targets).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return `action:${action}:${hex}`;
}
