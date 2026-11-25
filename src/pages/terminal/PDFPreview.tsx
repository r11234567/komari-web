import { useEffect, useRef, useState } from "react";
import { Button, Flex } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PDFPreview({ url, name }: { url: string; name: string }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const load = getDocument({ url, enableXfa: false, useSystemFonts: true, maxImageSize: 16_777_216, stopAtErrors: true });
    void load.promise.then((pdf) => { if (active) setDocument(pdf); })
      .catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      void load.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!document) return;
    let active = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    void document.getPage(page).then(async (current) => {
      if (!active || !canvas.current) return;
      const size = current.getViewport({ scale: 1 });
      const viewport = current.getViewport({ scale: Math.min(1.5, 2048 / Math.max(size.width, size.height)) });
      canvas.current.width = Math.ceil(viewport.width);
      canvas.current.height = Math.ceil(viewport.height);
      render = current.render({ canvas: canvas.current, viewport });
      await render.promise;
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [document, page]);

  if (failed) return <div role="alert" className="p-4">{t("file_manager.editor.preview_failed")}</div>;
  if (!document) return <div role="status" className="p-4">{t("loading")}</div>;

  return <Flex direction="column" align="center" gap="2" className="h-full overflow-auto p-3">
    <Flex align="center" gap="2">
      <Button size="1" variant="soft" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("common.previous_page")}</Button>
      <span>{page} / {document.numPages}</span>
      <Button size="1" variant="soft" disabled={page >= document.numPages} onClick={() => setPage(page + 1)}>{t("common.next_page")}</Button>
    </Flex>
    <canvas ref={canvas} aria-label={name} className="h-auto max-w-full bg-white" />
  </Flex>;
}
