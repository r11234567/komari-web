import { useTranslation } from "react-i18next";
import { CredentialPurpose } from "@komari/proto/komari/credential/v1/credential_pb";
import { useTrustedVerification } from "@/hooks/useTrustedVerification";
import { normalizeOTP, validOTP } from "@/utils/otpInput";

export default function TrustedCredentialVerification({ purpose, resource, onAuthorized }: {
  purpose: CredentialPurpose;
  resource: string;
  onAuthorized: (token: string, signal: AbortSignal) => Promise<void>;
}) {
  const { t } = useTranslation();
  const flow = useTrustedVerification(purpose, resource, onAuthorized);
  const button = "rounded border border-neutral-500 px-3 py-2 disabled:opacity-50";
  return <div className="km-trusted-credential-verification grid gap-3">
    {flow.error && <p role="alert" className="text-sm text-red-500">{flow.error}</p>}
    {!flow.challenge ? <>
      <label className="grid gap-1 text-sm">{t("account.native_otp.provider")}
        <select className="rounded border border-neutral-500 bg-transparent p-2" value={flow.provider} disabled={flow.busy} onChange={(event) => flow.setProvider(event.target.value)}>
          {flow.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
        </select>
      </label>
      <button type="button" className={button} disabled={flow.busy || !flow.provider} onClick={() => void flow.begin()}>{t("account.native_otp.begin")}</button>
    </> : <>
      <label className="grid gap-1 text-sm">{t("account.native_otp.enter_code")}
        <input autoFocus className="rounded border border-neutral-500 bg-transparent p-2" type="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} inputMode={flow.format.alphanumeric ? "text" : "numeric"} maxLength={flow.format.length} value={flow.code} disabled={flow.busy} onChange={(event) => flow.setCode(normalizeOTP(event.target.value, flow.format))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void flow.verify(); } }} />
      </label>
      <button type="button" className={button} disabled={flow.busy || !validOTP(flow.code, flow.format)} onClick={() => void flow.verify()}>{t("account.native_otp.verify")}</button>
      <button type="button" className={button} disabled={flow.busy} onClick={flow.reset}>{t("account.native_otp.cancel")}</button>
    </>}
  </div>;
}
