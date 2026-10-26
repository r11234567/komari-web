export const CHUNK_SIZE = 5 * 1024 * 1024;
const WORKER_COUNT = 2;
const MAX_ATTEMPTS = 4;

export type UploadPurpose = "backup" | "plugin" | "theme";

type InitResponse = {
  status?: string;
  message?: string;
  data?: {
    upload_id?: unknown;
    chunk_size?: unknown;
  };
};

type MergeResponse<T> = {
  status?: string;
  message?: string;
  data?: T;
};

export type ChunkUploadTask = {
  upload<T>(
    purpose: UploadPurpose,
    file: File,
    onProgress: (progress: number) => void,
  ): Promise<T | undefined>;
  cancel(): void;
};

export function createChunkUploadTask(basePath: string): ChunkUploadTask {
  const controller = new AbortController();
  const activeXhrs = new Set<XMLHttpRequest>();
  let uploadID = "";
  let cancelled = false;
  let started = false;

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    controller.abort();
    for (const xhr of activeXhrs) xhr.abort();
    if (uploadID) {
      void fetch(`${basePath}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: uploadID }),
      }).catch(() => undefined);
    }
  };

  const uploadChunk = (
    id: string,
    index: number,
    chunk: Blob,
    onProgress: (loaded: number) => void,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeXhrs.add(xhr);
      const finish = (callback: () => void) => {
        activeXhrs.delete(xhr);
        callback();
      };

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(event.loaded);
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const payload = JSON.parse(xhr.responseText) as { status?: string };
            if (payload.status !== "success") throw responseError(xhr.responseText, xhr.status);
          } catch (error) { finish(() => reject(error)); return; }
          finish(resolve);
          return;
        }
        finish(() => reject(responseError(xhr.responseText, xhr.status)));
      });
      xhr.addEventListener("error", () =>
        finish(() => reject(new Error(`chunk ${index} upload failed`))),
      );
      xhr.addEventListener("timeout", () => finish(() => reject(new Error(`chunk ${index} upload timed out`))));
      xhr.addEventListener("abort", () =>
        finish(() => reject(new DOMException("Upload cancelled", "AbortError"))),
      );

      const form = new FormData();
      form.append("upload_id", id);
      form.append("chunk_index", String(index));
      form.append("chunk_data", chunk, `chunk-${index}`);
      xhr.open("POST", `${basePath}/chunk`);
      xhr.timeout = 120_000;
      xhr.send(form);
    });

  return {
    cancel,
    async upload<T>(
      purpose: UploadPurpose,
      file: File,
      onProgress: (progress: number) => void,
    ): Promise<T | undefined> {
      try {
        if (started) throw new Error("Upload task already used");
        started = true;
        if (cancelled) throw new DOMException("Upload cancelled", "AbortError");
        const maxSize = { plugin: 100, theme: 128, backup: 256 }[purpose] * 1024 * 1024;
        if (file.size <= 0 || file.size > maxSize) throw new Error(`Archive size must be between 1 byte and ${maxSize / 1024 / 1024} MiB`);
        const initResponse = await fetch(`${basePath}/init`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose, size: file.size, filename: file.name }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
        });
        const initPayload = (await initResponse.json()) as InitResponse;
        if (!initResponse.ok || initPayload.status !== "success") {
          throw new Error(initPayload.message || `HTTP ${initResponse.status}`);
        }
        const id = initPayload.data?.upload_id;
        const chunkSize = initPayload.data?.chunk_size;
        if (typeof id === "string") uploadID = id;
        if (typeof id !== "string" || !id || chunkSize !== CHUNK_SIZE) {
          throw new Error("Invalid chunk upload configuration");
        }
        uploadID = id;

        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const progress = new Map<number, number>();
        let nextChunk = 0;
        const updateProgress = () => {
          let uploaded = 0;
          for (const value of progress.values()) uploaded += value;
          onProgress(Math.min(99, Math.round((uploaded / file.size) * 100)));
        };

        const uploadWithRetry = async (index: number) => {
          const start = index * CHUNK_SIZE;
          const chunk = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
          for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
            if (cancelled) throw new DOMException("Upload cancelled", "AbortError");
            progress.set(index, 0);
            updateProgress();
            try {
              await uploadChunk(uploadID, index, chunk, (loaded) => {
                progress.set(index, Math.min(chunk.size, loaded));
                updateProgress();
              });
              progress.set(index, chunk.size);
              updateProgress();
              return;
            } catch (error) {
              if (cancelled || attempt === MAX_ATTEMPTS - 1) throw error;
            }
          }
        };

        const worker = async () => {
          while (!cancelled) {
            const index = nextChunk;
            nextChunk += 1;
            if (index >= totalChunks) return;
            await uploadWithRetry(index);
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(WORKER_COUNT, totalChunks) }, () => worker()),
        );
        if (cancelled) throw new DOMException("Upload cancelled", "AbortError");

        const mergeResponse = await fetch(`${basePath}/merge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ upload_id: uploadID }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
        });
        const mergePayload = (await mergeResponse.json()) as MergeResponse<T>;
        if (!mergeResponse.ok || mergePayload.status !== "success") {
          throw new Error(mergePayload.message || `HTTP ${mergeResponse.status}`);
        }
        uploadID = "";
        onProgress(100);
        return mergePayload.data;
      } catch (error) {
        cancel();
        throw error;
      }
    },
  };
}

function responseError(body: string, status: number) {
  try {
    const payload = JSON.parse(body) as { message?: unknown };
    if (typeof payload.message === "string") return new Error(payload.message);
  } catch {
    // Keep the HTTP status message when the response is not JSON.
  }
  return new Error(`chunk upload failed: ${status}`);
}
