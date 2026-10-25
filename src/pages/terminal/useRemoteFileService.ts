import { useCallback, useMemo } from "react";
import { requestFileTwoFactor } from "./fileTwoFactor";
import { connectClients } from "@/api/connect/client";
import { EntryKind, type FileEntry } from "@komari/proto/komari/file/v1/file_pb";
import {
  cacheTransferChunkSize,
  fileDownloadUrl,
  getCachedTransferChunkSize,
  MAX_EDITABLE_FILE_SIZE,
  type RemoteFileReadResult,
  type RemoteFileInfo,
  type RemoteSearchResult,
} from "./fileManagerApi";

export interface RemoteFileService {
  list: (path: string) => Promise<RemoteFileInfo[]>;
  roots: () => Promise<RemoteFileInfo[]>;
  stat: (path: string) => Promise<RemoteFileInfo>;
  read: (path: string) => Promise<RemoteFileReadResult>;
  mkdir: (path: string, mode?: string) => Promise<void>;
  search: (path: string, query: string, content: boolean) => Promise<RemoteSearchResult>;
  remove: (path: string) => Promise<void>;
  move: (source: string, destination: string) => Promise<void>;
  copy: (source: string, destination: string) => Promise<void>;
  chmod: (path: string, mode: string) => Promise<void>;
  chown: (path: string, owner: string, group: string) => Promise<void>;
}

const mapFileEntryToInfo = (entry: FileEntry): RemoteFileInfo => ({
  name: entry.name,
  path: entry.path,
  is_dir: entry.directory,
  is_symlink: entry.symlink,
  size: Number(entry.size),
  mode: entry.mode,
  mode_octal: entry.modeOctal,
  uid: entry.uid,
  gid: entry.gid,
  owner: entry.owner,
  group: entry.group,
  modified_at: entry.modifiedAt
    ? new Date(Number(entry.modifiedAt.seconds) * 1000).toISOString()
    : "",
  target: entry.target || undefined,
});

const readHTTPError = async (response: Response) => {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message || `Failed to read file (${response.status})`;
};

const editableFileLimitError = () =>
  new Error(`file exceeds the ${MAX_EDITABLE_FILE_SIZE} byte edit limit`);

const readResponseBytes = async (response: Response, limit: number) => {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > limit) throw editableFileLimitError();
    return new Uint8Array(buffer);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          // preserve size error
        }
        throw editableFileLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const useRemoteFileService = (uuid: string): RemoteFileService => {
  const list = useCallback(
    async (path: string) => {
      const response = await connectClients.file.listDirectory({
        agentId: uuid,
        path,
      });
      return (response.listing?.entries ?? []).map(mapFileEntryToInfo);
    },
    [uuid],
  );

  const roots = useCallback(async () => {
    const response = await connectClients.file.listRoots({
      agentId: uuid,
    });
    return response.roots.map(mapFileEntryToInfo);
  }, [uuid]);

  const stat = useCallback(
    async (path: string) => {
      const response = await connectClients.file.statFile({
        agentId: uuid,
        path,
      });
      if (!response.entry) {
        throw new Error("File not found");
      }
      return mapFileEntryToInfo(response.entry);
    },
    [uuid],
  );

  const read = useCallback(
    async (path: string) => {
      const response = await fetch(fileDownloadUrl(uuid, path, true), {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/octet-stream" },
      });
      if (!response.ok) {
        throw new Error(await readHTTPError(response));
      }
      const advertisedChunkSize = Number(response.headers.get("X-Komari-Transfer-Chunk-Size"));
      const cachedChunkSize = getCachedTransferChunkSize(uuid, "download");
      if (
        Number.isFinite(advertisedChunkSize) &&
        (!cachedChunkSize || advertisedChunkSize <= cachedChunkSize)
      ) {
        cacheTransferChunkSize(uuid, "download", advertisedChunkSize);
      }
      const advertisedSize = Number(response.headers.get("Content-Length"));
      if (Number.isFinite(advertisedSize) && advertisedSize > MAX_EDITABLE_FILE_SIZE) {
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        throw editableFileLimitError();
      }
      const bytes = await readResponseBytes(response, MAX_EDITABLE_FILE_SIZE);
      const lastModified = response.headers.get("Last-Modified");
      const modifiedTimestamp = lastModified ? Date.parse(lastModified) : Number.NaN;
      const modifiedAt = Number.isFinite(modifiedTimestamp)
        ? new Date(modifiedTimestamp).toISOString()
        : "";
      return {
        bytes,
        size: bytes.byteLength,
        modified_at: modifiedAt,
        content_type: response.headers.get("Content-Type") || "",
      } satisfies RemoteFileReadResult;
    },
    [uuid],
  );

  const mkdir = useCallback(
    async (path: string, mode = "0755") => {
      await connectClients.file.createEntry({
        twoFactor: requestFileTwoFactor(),
        agentId: uuid,
        path,
        kind: EntryKind.DIRECTORY,
        mode,
      });
    },
    [uuid],
  );

  const search = useCallback(
    async (path: string, query: string, content: boolean) => {
      const response = await connectClients.file.searchFiles({
        agentId: uuid,
        path,
        query,
        content,
        maxResults: 200,
      });
      return {
        matches: response.matches.map((m) => ({
          path: m.path,
          line: m.line,
          text: m.text,
          is_dir: m.directory,
        })),
        limited: response.limited,
      };
    },
    [uuid],
  );

  const remove = useCallback(
    async (path: string) => {
      await connectClients.file.deleteEntry({
        twoFactor: requestFileTwoFactor(),
        agentId: uuid,
        path,
        recursive: true,
      });
    },
    [uuid],
  );

  const move = useCallback(
    async (source: string, destination: string) => {
      await connectClients.file.moveEntry({
        twoFactor: requestFileTwoFactor(),
        agentId: uuid,
        source,
        destination,
        overwrite: true,
      });
    },
    [uuid],
  );

  const copy = useCallback(
    async (source: string, destination: string) => {
      await connectClients.file.copyEntry({
        twoFactor: requestFileTwoFactor(),
        agentId: uuid,
        source,
        destination,
        recursive: true,
        overwrite: true,
      });
    },
    [uuid],
  );

  const chmod = useCallback(
    async (path: string, mode: string) => {
      await connectClients.file.chmodEntry({
        twoFactor: requestFileTwoFactor(),
        agentId: uuid,
        path,
        mode,
      });
    },
    [uuid],
  );

  const chown = useCallback(
    async (path: string, owner: string, group: string) => {
      await connectClients.file.chownEntry({
        twoFactor: requestFileTwoFactor(),
        agentId: uuid,
        path,
        owner,
        group,
      });
    },
    [uuid],
  );

  return useMemo(
    () => ({
      search,
      list,
      roots,
      stat,
      read,
      mkdir,
      remove,
      move,
      copy,
      chmod,
      chown,
    }),
    [search, list, roots, stat, read, mkdir, remove, move, copy, chmod, chown],
  );
};

export default useRemoteFileService;
