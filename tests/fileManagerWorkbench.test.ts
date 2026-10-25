import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_EDITABLE_FILE_SIZE,
  TRANSFER_CHUNK_SIZE,
  MIN_TRANSFER_CHUNK_SIZE,
  MAX_TRANSFER_CHUNK_SIZE,
  cacheTransferChunkSize,
  getCachedTransferChunkSize,
  decodeRemoteTextBytes,
  detectRemoteTextEncoding,
  encodeRemoteTextBytes,
  fileDownloadUrl,
  formatClipboardPath,
  formatFileSize,
  languageFromPath,
  maxPreviewSizeForFile,
  normalizeRemotePath,
  previewKindForFile,
  remoteAncestors,
  remoteBasename,
  remoteDirname,
  resolveSymlinkTargetPath,
  sortRemoteFiles,
  type RemoteFileInfo,
} from "../src/pages/terminal/fileManagerApi.ts";

test("Remote File Manager: Text encoding detection and round-trip (UTF-8, UTF-8 BOM, GB18030, Big5)", async () => {
  // 1. UTF-8 standard text
  const utf8Text = "Hello, Komari 终端工作台与文件编辑器！";
  const utf8Bytes = await encodeRemoteTextBytes(utf8Text, "utf-8");
  assert.equal(detectRemoteTextEncoding(utf8Bytes), "utf-8");
  assert.equal(decodeRemoteTextBytes(utf8Bytes, "utf-8"), utf8Text);

  // 2. UTF-8 with BOM
  const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes]);
  assert.equal(detectRemoteTextEncoding(bomBytes), "utf-8");

  // 3. GB18030 / GBK encoding & decoding
  const gbkSampleText = "北京海淀区上地十街服务器配置清单";
  const gbkBytes = await encodeRemoteTextBytes(gbkSampleText, "gb18030");
  const detectedGbk = detectRemoteTextEncoding(gbkBytes);
  assert.equal(detectedGbk, "gb18030");
  const decodedGbk = decodeRemoteTextBytes(gbkBytes, "gb18030");
  assert.equal(decodedGbk, gbkSampleText);

  // 4. Big5 traditional Chinese encoding & decoding
  const big5SampleText = "臺灣繁體中文伺服器監控與終端機";
  const big5Bytes = await encodeRemoteTextBytes(big5SampleText, "big5");
  const detectedBig5 = detectRemoteTextEncoding(big5Bytes);
  assert.equal(detectedBig5, "big5");
  const decodedBig5 = decodeRemoteTextBytes(big5Bytes, "big5");
  assert.equal(decodedBig5, big5SampleText);
});

test("Remote File Manager: Monaco editor 2MB boundary & size guard", () => {
  assert.equal(MAX_EDITABLE_FILE_SIZE, 2 * 1024 * 1024);

  // 1. Plain text preview size is capped at 2MB
  assert.equal(maxPreviewSizeForFile("/var/log/syslog.log"), 2 * 1024 * 1024);
  assert.equal(maxPreviewSizeForFile("src/main.rs"), 2 * 1024 * 1024);

  // 2. Non-text preview types (images, pdf, video, office) have no editor limit
  assert.equal(maxPreviewSizeForFile("screenshot.png"), Number.POSITIVE_INFINITY);
  assert.equal(maxPreviewSizeForFile("manual.pdf"), Number.POSITIVE_INFINITY);
  assert.equal(maxPreviewSizeForFile("demo.mp4"), Number.POSITIVE_INFINITY);

  // 3. Simulated stream chunk reader enforcing MAX_EDITABLE_FILE_SIZE
  const simulateChunkRead = (totalBytes: number, limit: number) => {
    let bytesRead = 0;
    const chunkSize = 64 * 1024;
    while (bytesRead < totalBytes) {
      bytesRead += chunkSize;
      if (bytesRead > limit) {
        throw new Error(`file exceeds the ${limit} byte edit limit`);
      }
    }
    return bytesRead;
  };

  // Under limit: succeeds
  assert.equal(simulateChunkRead(1024 * 1024, MAX_EDITABLE_FILE_SIZE), 1024 * 1024);

  // Exceeds limit: immediately intercepted
  assert.throws(
    () => simulateChunkRead(2 * 1024 * 1024 + 65536, MAX_EDITABLE_FILE_SIZE),
    /file exceeds the 2097152 byte edit limit/,
  );
});

test("Remote File Manager: Language identification for Monaco editor", () => {
  assert.equal(languageFromPath("server.go"), "go");
  assert.equal(languageFromPath("index.ts"), "typescript");
  assert.equal(languageFromPath("App.tsx"), "typescript");
  assert.equal(languageFromPath("script.py"), "python");
  assert.equal(languageFromPath("main.rs"), "rust");
  assert.equal(languageFromPath("deploy.sh"), "shell");
  assert.equal(languageFromPath("Dockerfile"), "dockerfile");
  assert.equal(languageFromPath("Makefile"), "shell");
  assert.equal(languageFromPath("config.json"), "json");
  assert.equal(languageFromPath("config.yaml"), "yaml");
  assert.equal(languageFromPath("config.yml"), "yaml");
  assert.equal(languageFromPath("styles.css"), "css");
  assert.equal(languageFromPath("index.html"), "html");
  assert.equal(languageFromPath("query.sql"), "sql");
  assert.equal(languageFromPath("README.md"), "markdown");
  assert.equal(languageFromPath("unknown_file"), "plaintext");
});

test("Remote File Manager: Remote path ancestors, basename, dirname and symlinks", () => {
  // 1. Unix paths
  assert.deepEqual(remoteAncestors("/var/log/nginx/access.log"), [
    "/",
    "/var",
    "/var/log",
    "/var/log/nginx",
    "/var/log/nginx/access.log",
  ]);

  // 2. Windows paths
  assert.deepEqual(remoteAncestors("C:/Users/Administrator/Desktop/app.exe"), [
    "C:/",
    "C:/Users",
    "C:/Users/Administrator",
    "C:/Users/Administrator/Desktop",
    "C:/Users/Administrator/Desktop/app.exe",
  ]);

  // 3. Normalization
  assert.equal(normalizeRemotePath("C:\\Windows\\System32\\\\drivers"), "C:/Windows/System32/drivers");
  assert.equal(remoteBasename("/etc/nginx/nginx.conf"), "nginx.conf");
  assert.equal(remoteDirname("/etc/nginx/nginx.conf"), "/etc/nginx");

  // 4. Symlink resolution
  const relativeSymlink: RemoteFileInfo = {
    name: "current",
    path: "/var/www/current",
    is_dir: false,
    is_symlink: true,
    size: 0,
    mode: "lrwxrwxrwx",
    mode_octal: "0777",
    uid: 1000,
    gid: 1000,
    owner: "root",
    group: "root",
    modified_at: "2026-10-25T00:00:00Z",
    target: "releases/v2.1.0",
  };
  assert.equal(resolveSymlinkTargetPath(relativeSymlink), "/var/www/releases/v2.1.0");

  const absoluteSymlink: RemoteFileInfo = {
    ...relativeSymlink,
    target: "/opt/shared/data",
  };
  assert.equal(resolveSymlinkTargetPath(absoluteSymlink), "/opt/shared/data");
});

test("Remote File Manager: File sort order (directories first, then alphabetically)", () => {
  const files: RemoteFileInfo[] = [
    { name: "zebra.txt", path: "/a/zebra.txt", is_dir: false, is_symlink: false, size: 100, mode: "", mode_octal: "0644", uid: 0, gid: 0, owner: "", group: "", modified_at: "" },
    { name: "beta-dir", path: "/a/beta-dir", is_dir: true, is_symlink: false, size: 0, mode: "", mode_octal: "0755", uid: 0, gid: 0, owner: "", group: "", modified_at: "" },
    { name: "alpha.txt", path: "/a/alpha.txt", is_dir: false, is_symlink: false, size: 200, mode: "", mode_octal: "0644", uid: 0, gid: 0, owner: "", group: "", modified_at: "" },
    { name: "alpha-dir", path: "/a/alpha-dir", is_dir: true, is_symlink: false, size: 0, mode: "", mode_octal: "0755", uid: 0, gid: 0, owner: "", group: "", modified_at: "" },
  ];

  const sorted = sortRemoteFiles(files);
  assert.equal(sorted[0].name, "alpha-dir");
  assert.equal(sorted[1].name, "beta-dir");
  assert.equal(sorted[2].name, "alpha.txt");
  assert.equal(sorted[3].name, "zebra.txt");
});

test("Remote File Manager: Preview kinds and download URLs", () => {
  // Preview classification
  assert.equal(previewKindForFile("pic.png", "image/png"), "image");
  assert.equal(previewKindForFile("sound.mp3", "audio/mpeg"), "audio");
  assert.equal(previewKindForFile("movie.mp4", "video/mp4"), "video");
  assert.equal(previewKindForFile("doc.pdf", "application/pdf"), "pdf");
  assert.equal(previewKindForFile("sheet.xlsx", ""), "office");
  assert.equal(previewKindForFile("code.go", "text/plain"), "text");

  // Download URL creation
  const urlDirect = fileDownloadUrl("test-uuid-123", "/var/log/test.log", false);
  assert.ok(urlDirect.includes("/api/admin/client/test-uuid-123/file/download"));
  assert.ok(urlDirect.includes("path=%2Fvar%2Flog%2Ftest.log"));
  assert.ok(!urlDirect.includes("inline=1"));

  const urlInline = fileDownloadUrl("test-uuid-123", "/var/log/test.log", true);
  assert.ok(urlInline.includes("inline=1"));

  // Clipboard path and size formatting helpers
  assert.equal(formatClipboardPath("/etc/hosts"), "/etc/hosts");
  assert.equal(formatClipboardPath("/tmp/my dir/data.csv"), '"/tmp/my dir/data.csv"');
  assert.equal(formatFileSize(1048576), "1.00 MB");
});

test("Remote File Manager: Adaptive transfer chunk sizing boundaries", () => {
  assert.equal(TRANSFER_CHUNK_SIZE, 25 * 1024 * 1024);
  assert.equal(MIN_TRANSFER_CHUNK_SIZE, 1 * 1024 * 1024);
  assert.equal(MAX_TRANSFER_CHUNK_SIZE, 128 * 1024 * 1024);

  const uuid = "agent-test-chunk-size";
  // Valid chunk size cache
  cacheTransferChunkSize(uuid, "upload", 16 * 1024 * 1024);
  assert.equal(getCachedTransferChunkSize(uuid, "upload"), 16 * 1024 * 1024);

  // Value below min is rejected
  cacheTransferChunkSize(uuid, "upload", 512);
  assert.equal(getCachedTransferChunkSize(uuid, "upload"), 16 * 1024 * 1024);

  // Value above max is rejected
  cacheTransferChunkSize(uuid, "upload", 500 * 1024 * 1024);
  assert.equal(getCachedTransferChunkSize(uuid, "upload"), 16 * 1024 * 1024);

  // Progressive backoff (e.g. 413 Payload Too Large) keeps smallest successful size
  cacheTransferChunkSize(uuid, "upload", 8 * 1024 * 1024);
  assert.equal(getCachedTransferChunkSize(uuid, "upload"), 8 * 1024 * 1024);
});
