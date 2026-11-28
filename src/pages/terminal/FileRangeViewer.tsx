import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatFileSize } from "./fileManagerApi";
import { FILE_PAGE_BYTES, FileEditConflict, readFileRange, type FileRangePage } from "./useRemoteFileService";

export default function FileRangeViewer({ uuid, path }: { uuid: string; path: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState<FileRangePage>();
  const [offset, setOffset] = useState(0);
  const [following, setFollowing] = useState(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const version = useRef("");
  const output = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    setLoading(true);
    setError("");
    async function update() {
      try {
        const next = await readFileRange(uuid, path, following ? "tail" : offset, version.current, controller.signal);
        if (controller.signal.aborted) return;
        if (next) {
          version.current = next.etag;
          setPage(next);
        }
        if (following) timer = window.setTimeout(update, 2000);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (following && cause instanceof FileEditConflict) {
          timer = window.setTimeout(update, 500);
          return;
        }
        setError(cause instanceof FileEditConflict
          ? t("file_manager.editor.range_changed")
          : cause instanceof Error ? cause.message : t("file_manager.load_failed"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void update();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [uuid, path, offset, following, reload, t]);

  useEffect(() => {
    if (following && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [following, page]);

  function restart(follow: boolean) {
    version.current = "";
    setPage(undefined);
    setOffset(0);
    setFollowing(follow);
    setReload((value) => value + 1);
  }

  const button = "rounded bg-[#333] px-2 py-1 text-[#ddd] hover:bg-[#444] disabled:opacity-40";
  return (
    <div className="flex h-full min-h-0 flex-col text-xs text-[#ccc]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#333] px-3 py-2">
        <button type="button" className={button} disabled={loading || following || offset === 0 || Boolean(error)}
          onClick={() => setOffset(Math.max(0, offset - FILE_PAGE_BYTES))}>{t("file_manager.editor.range_previous")}</button>
        <button type="button" className={button} disabled={loading || following || !page || offset + FILE_PAGE_BYTES >= page.size || Boolean(error)}
          onClick={() => setOffset(offset + FILE_PAGE_BYTES)}>{t("file_manager.editor.range_next")}</button>
        <button type="button" className={button} aria-pressed={following} onClick={() => restart(!following)}>
          {t(following ? "file_manager.editor.range_stop_tail" : "file_manager.editor.range_tail")}
        </button>
        {error && <button type="button" className={button} onClick={() => restart(following)}>{t("file_manager.editor.range_reload")}</button>}
        {page && (
          <span>{t("file_manager.editor.range_position", {
            start: formatFileSize(page.start), end: formatFileSize(page.start + Math.min(page.bytes.length, FILE_PAGE_BYTES)), total: formatFileSize(page.size),
          })}</span>
        )}
        {loading && <span>{t("file_manager.loading", "Loading...")}</span>}
      </div>
      {error && <p role="alert" className="px-3 py-2 text-red-300">{error}</p>}
      <pre ref={output} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3">
        {page && decodePage(page)}
      </pre>
    </div>
  );
}

function decodePage(page: FileRangePage) {
  let first = 0;
  while (page.start > 0 && first < 3 && (page.bytes[first] & 0xc0) === 0x80) first++;
  let last = Math.min(FILE_PAGE_BYTES, page.bytes.length);
  while (last < page.bytes.length && (page.bytes[last] & 0xc0) === 0x80) last++;
  return new TextDecoder().decode(page.bytes.subarray(first, last));
}
