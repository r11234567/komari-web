import { useEffect, useState, type CSSProperties } from "react";
import {
  isAllowedInlineSvgUrl,
  isSafeIconImageUrl,
  sanitizeSvg,
} from "@/utils/inlineSvgSanitizer";

const MAX_INLINE_SVG_BYTES = 64 * 1024;

interface InlineSvgIconProps {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  loading?: "eager" | "lazy";
}

const readResponseText = async (response: Response) => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_INLINE_SVG_BYTES) {
    throw new Error("SVG icon is too large to inline");
  }
  if (!response.body) throw new Error("SVG icon response has no body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_INLINE_SVG_BYTES) {
        await reader.cancel();
        throw new Error("SVG icon is too large to inline");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

export default function InlineSvgIcon({
  src,
  alt,
  className,
  style,
  loading,
}: InlineSvgIconProps) {
  const [inlineSvg, setInlineSvg] = useState<{
    src: string;
    markup: string;
  } | null>(null);

  useEffect(() => {
    if (!isAllowedInlineSvgUrl(src)) {
      setInlineSvg(null);
      return;
    }

    const controller = new AbortController();
    setInlineSvg(null);
    const loadSvg = async () => {
      try {
        const response = await fetch(src, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Failed to load SVG icon: ${response.status}`);
        const markup = sanitizeSvg(await readResponseText(response));
        if (!markup) throw new Error("Invalid SVG icon");
        if (!controller.signal.aborted) setInlineSvg({ src, markup });
      } catch {
        if (!controller.signal.aborted) setInlineSvg(null);
      }
    };
    void loadSvg();
    return () => controller.abort();
  }, [src]);

  if (inlineSvg?.src === src) {
    return (
      <span
        className={className}
        style={{ display: "inline-flex", ...style }}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
      >
        <span
          className="[&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          style={{ display: "inline-flex", width: "100%", height: "100%" }}
          dangerouslySetInnerHTML={{ __html: inlineSvg.markup }}
        />
      </span>
    );
  }

  if (!isSafeIconImageUrl(src)) {
    return null;
  }

  return <img src={src} alt={alt} className={className} style={style} loading={loading} />;
}
