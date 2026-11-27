import { useEffect, useState } from "react";
import { Button, Callout } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import AdminPageTitle from "@/components/admin/AdminPageTitle";
import SensitiveActionDialog, { type SensitiveAction } from "@/components/SensitiveActionDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes } from "@/utils/unitHelper";

type Archive = { name: string; size: number; stored_at: string };
type ArchiveStatus = { rows?: Archive[]; error?: boolean };

const normalName = /^[0-9a-f]{32}-[0-9a-f]{32}-[0-9]{20}\.tar\.gz$/;

async function archiveRPC(method: "List" | "Download", data: string, signal: AbortSignal, proof?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Connect-Protocol-Version": "1" };
  if (proof) headers["X-Komari-Credential-Authorization"] = proof;
  // The protobuf JSON encoding of BytesValue is a single base64 string.
  const response = await fetch(`/komari.diag.v1.SealedRecordService/${method}`, {
    method: "POST", credentials: "same-origin", cache: "no-store", headers, body: JSON.stringify(btoa(data)), signal,
  });
  if (!response.ok) throw new Error("forensic archive request failed");
  const value: unknown = await response.json();
  if (typeof value !== "string") throw new Error("invalid forensic archive response");
  return Uint8Array.from(atob(value), (byte) => byte.charCodeAt(0));
}

function parseArchiveList(bytes: Uint8Array): Archive[] {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(parsed)) throw new Error("invalid archive list");
  return parsed.filter((value): value is Archive => !!value && typeof value.name === "string" && normalName.test(value.name) &&
    typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size > 0 && typeof value.stored_at === "string");
}

export default function ForensicArchives() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<ArchiveStatus>({});
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<SensitiveAction | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void archiveRPC("List", "", abort.signal).then(parseArchiveList).then(
      (rows) => { if (!abort.signal.aborted) setStatus({ rows }); },
      () => { if (!abort.signal.aborted) setStatus({ error: true }); },
    );
    return () => abort.abort();
  }, [revision]);

  function download(row: Archive) {
    setAction({
      action: "forensics:export", targets: [row.name], title: t("forensicArchives.download"),
      execute: async (token, signal) => {
        try {
          const bytes = await archiveRPC("Download", row.name, signal, token);
          if (signal.aborted) return;
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/gzip" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = row.name;
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
          if (!signal.aborted) throw new Error(t("forensicArchives.downloadError"));
        }
      },
    });
  }

  return (
    <main className="space-y-4">
      <AdminPageTitle description={t("forensicArchives.description")}>{t("forensicArchives.title")}</AdminPageTitle>
      <Button variant="soft" onClick={() => { setStatus({}); setRevision((value) => value + 1); }}>{t("forensicArchives.refresh")}</Button>
      {status.error && <Callout.Root color="red" role="alert"><Callout.Text>{t("forensicArchives.loadError")}</Callout.Text></Callout.Root>}
      {!status.rows && !status.error && <p role="status">{t("forensicArchives.loading")}</p>}
      {status.rows?.length === 0 && <p>{t("forensicArchives.empty")}</p>}
      {!!status.rows?.length && (
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("forensicArchives.file")}</TableHead><TableHead>{t("forensicArchives.saved")}</TableHead>
            <TableHead>{t("forensicArchives.size")}</TableHead><TableHead>{t("forensicArchives.download")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{status.rows.map((row) => <TableRow key={row.name}>
            <TableCell className="break-all font-mono">{row.name}</TableCell>
            <TableCell>{new Date(row.stored_at).toLocaleString(i18n.resolvedLanguage)}</TableCell>
            <TableCell>{formatBytes(row.size)}</TableCell>
            <TableCell><Button variant="soft" onClick={() => download(row)}>{t("forensicArchives.download")}</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      )}
      <SensitiveActionDialog request={action} onClose={() => setAction(null)} />
    </main>
  );
}
