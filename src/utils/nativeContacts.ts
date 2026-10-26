export type ContactKind = "email" | "telegram";
export interface NativeContactDraft { kind: ContactKind; address: string; transport: string }

export function normalizeNativeContact(kind: ContactKind, input: string, transport: string): NativeContactDraft {
  let address = input.trim();
  if (!/^[a-z][a-z0-9:._-]{1,95}$/.test(transport)) throw new Error("Choose a private delivery channel");
  if (kind === "email") {
    const at = address.lastIndexOf("@");
    if (address.length > 320 || !/^[!-~]+$/.test(address) || /[<>]/.test(address) || at <= 0 || at === address.length - 1 || address.indexOf("@") !== at) throw new Error("Enter one email address");
    address = address.slice(0, at + 1) + address.slice(at + 1).toLowerCase();
  } else if (kind === "telegram") {
    if (!/^[1-9][0-9]{0,18}$/.test(address) || BigInt(address) > 9223372036854775807n) throw new Error("Enter a positive private Telegram user ID");
  } else throw new Error("Unsupported contact kind");
  return { kind, address, transport };
}

export const nativeContactResource = (draft: NativeContactDraft) => `contact:bind:${draft.kind}:${draft.transport}:${draft.address}`;
export const deleteContactResource = (kind: ContactKind) => `contact:delete:${kind}`;
