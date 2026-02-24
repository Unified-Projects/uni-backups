/**
 * Checksum Verification Helpers
 *
 * Comprehensive utilities for verifying data integrity using SHA256 and MD5 checksums.
 * Supports file-level, directory-level, and byte-by-byte comparison for thorough testing.
 */

import { createHash, type Hash } from "crypto";
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  createReadStream,
  writeFileSync,
  mkdirSync,
} from "fs";
import { join, relative } from "path";

/**
 * Checksum result for a single file
 */
export interface ChecksumResult {
  sha256: string;
  md5: string;
  size: number;
}

/**
 * File entry with checksums and metadata
 */
export interface FileEntry {
  path: string;
  checksums: ChecksumResult;
  mode: number;
  mtime: number;
  isSymlink: boolean;
  symlinkTarget?: string;
}

/**
 * Directory manifest containing all files and their checksums
 */
export interface DirectoryManifest {
  basePath: string;
  files: Map<string, FileEntry>;
  totalSize: number;
  fileCount: number;
  generatedAt: number;
}

/**
 * Mismatch details for verification failures
 */
export interface Mismatch {
  path: string;
  reason: "missing" | "size" | "sha256" | "md5" | "mode" | "content" | "extra";
  expected?: string | number;
  actual?: string | number;
}

/**
 * Result of directory integrity verification
 */
export interface VerificationResult {
  match: boolean;
  mismatches: Mismatch[];
  verified: number;
  missing: number;
  extra: number;
}

/**
 * Compute checksums for a file (synchronous for small files)
 */
export function computeFileChecksum(filePath: string): ChecksumResult {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = statSync(filePath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory: ${filePath}`);
  }

  const content = readFileSync(filePath);

  return {
    sha256: createHash("sha256").update(content).digest("hex"),
    md5: createHash("md5").update(content).digest("hex"),
    size: content.length,
  };
}

/**
 * Compute checksums for a file asynchronously (for large files)
 */
export async function computeFileChecksumAsync(
  filePath: string
): Promise<ChecksumResult> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = statSync(filePath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory: ${filePath}`);
  }

  return new Promise((resolve, reject) => {
    const sha256Hash = createHash("sha256");
    const md5Hash = createHash("md5");
    let size = 0;

    const stream = createReadStream(filePath);

    stream.on("data", (chunk: Buffer) => {
      sha256Hash.update(chunk);
      md5Hash.update(chunk);
      size += chunk.length;
    });

    stream.on("end", () => {
      resolve({
        sha256: sha256Hash.digest("hex"),
        md5: md5Hash.digest("hex"),
        size,
      });
    });

    stream.on("error", reject);
  });
}

/**
 * Compute checksums for a buffer
 */
export function computeBufferChecksum(buffer: Buffer): ChecksumResult {
  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    md5: createHash("md5").update(buffer).digest("hex"),
    size: buffer.length,
  };
}

/**
 * Compute checksums for a string
 */
export function computeStringChecksum(content: string): ChecksumResult {
  const buffer = Buffer.from(content, "utf-8");
  return computeBufferChecksum(buffer);
}

/**
 * Generate a complete directory manifest with checksums for all files
 */
export function computeDirectoryManifest(dirPath: string): DirectoryManifest {
  if (!existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const stat = statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }

  const files = new Map<string, FileEntry>();
  let totalSize = 0;

  function walkDirectory(currentPath: string): void {
    const entries = readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = relative(dirPath, fullPath);
      const entryStat = statSync(fullPath, { throwIfNoEntry: false });

      if (!entryStat) continue;

      if (entry.isSymbolicLink()) {
        const target = readFileSync(fullPath, "utf-8");
        files.set(relativePath, {
          path: relativePath,
          checksums: { sha256: "", md5: "", size: 0 },
          mode: entryStat.mode,
          mtime: Math.floor(entryStat.mtimeMs),
          isSymlink: true,
          symlinkTarget: target,
        });
      } else if (entry.isFile()) {
        const checksums = computeFileChecksum(fullPath);
        totalSize += checksums.size;
        files.set(relativePath, {
          path: relativePath,
          checksums,
          mode: entryStat.mode,
          mtime: Math.floor(entryStat.mtimeMs),
          isSymlink: false,
        });
      } else if (entry.isDirectory()) {
        walkDirectory(fullPath);
      }
    }
  }

  walkDirectory(dirPath);

  return {
    basePath: dirPath,
    files,
    totalSize,
    fileCount: files.size,
    generatedAt: Date.now(),
  };
}

/**
 * Compute directory manifest asynchronously (for large directories)
 */
export async function computeDirectoryManifestAsync(
  dirPath: string
): Promise<DirectoryManifest> {
  if (!existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const stat = statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }

  const files = new Map<string, FileEntry>();
  let totalSize = 0;

  async function walkDirectory(currentPath: string): Promise<void> {
    const entries = readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = relative(dirPath, fullPath);
      const entryStat = statSync(fullPath, { throwIfNoEntry: false });

      if (!entryStat) continue;

      if (entry.isSymbolicLink()) {
        const target = readFileSync(fullPath, "utf-8");
        files.set(relativePath, {
          path: relativePath,
          checksums: { sha256: "", md5: "", size: 0 },
          mode: entryStat.mode,
          mtime: Math.floor(entryStat.mtimeMs),
          isSymlink: true,
          symlinkTarget: target,
        });
      } else if (entry.isFile()) {
        // Use async for large files
        const checksums = entryStat.size > 10 * 1024 * 1024
          ? await computeFileChecksumAsync(fullPath)
          : computeFileChecksum(fullPath);
        totalSize += checksums.size;
        files.set(relativePath, {
          path: relativePath,
          checksums,
          mode: entryStat.mode,
          mtime: Math.floor(entryStat.mtimeMs),
          isSymlink: false,
        });
      } else if (entry.isDirectory()) {
        await walkDirectory(fullPath);
      }
    }
  }

  await walkDirectory(dirPath);

  return {
    basePath: dirPath,
    files,
    totalSize,
    fileCount: files.size,
    generatedAt: Date.now(),
  };
}

/**
 * Verify directory integrity against a manifest
 */
export function verifyDirectoryIntegrity(
  dirPath: string,
  manifest: DirectoryManifest,
  options: {
    checkMode?: boolean;
    checkMtime?: boolean;
    allowExtra?: boolean;
  } = {}
): VerificationResult {
  const { checkMode = false, checkMtime = false, allowExtra = false } = options;
  const mismatches: Mismatch[] = [];
  let verified = 0;
  let missing = 0;
  let extra = 0;

  // Check all files in manifest exist and match
  for (const [relativePath, expectedEntry] of manifest.files) {
    const fullPath = join(dirPath, relativePath);

    if (!existsSync(fullPath)) {
      mismatches.push({ path: relativePath, reason: "missing" });
      missing++;
      continue;
    }

    const stat = statSync(fullPath);

    if (expectedEntry.isSymlink) {
      // Symlink verification
      const target = readFileSync(fullPath, "utf-8");
      if (target !== expectedEntry.symlinkTarget) {
        mismatches.push({
          path: relativePath,
          reason: "content",
          expected: expectedEntry.symlinkTarget,
          actual: target,
        });
      } else {
        verified++;
      }
      continue;
    }

    // Size check
    if (stat.size !== expectedEntry.checksums.size) {
      mismatches.push({
        path: relativePath,
        reason: "size",
        expected: expectedEntry.checksums.size,
        actual: stat.size,
      });
      continue;
    }

    // Checksum verification
    const actualChecksums = computeFileChecksum(fullPath);

    if (actualChecksums.sha256 !== expectedEntry.checksums.sha256) {
      mismatches.push({
        path: relativePath,
        reason: "sha256",
        expected: expectedEntry.checksums.sha256,
        actual: actualChecksums.sha256,
      });
      continue;
    }

    if (actualChecksums.md5 !== expectedEntry.checksums.md5) {
      mismatches.push({
        path: relativePath,
        reason: "md5",
        expected: expectedEntry.checksums.md5,
        actual: actualChecksums.md5,
      });
      continue;
    }

    // Mode check (optional)
    if (checkMode && stat.mode !== expectedEntry.mode) {
      mismatches.push({
        path: relativePath,
        reason: "mode",
        expected: expectedEntry.mode,
        actual: stat.mode,
      });
      continue;
    }

    verified++;
  }

  // Check for extra files not in manifest
  if (!allowExtra) {
    const currentManifest = computeDirectoryManifest(dirPath);
    for (const [relativePath] of currentManifest.files) {
      if (!manifest.files.has(relativePath)) {
        mismatches.push({ path: relativePath, reason: "extra" });
        extra++;
      }
    }
  }

  return {
    match: mismatches.length === 0,
    mismatches,
    verified,
    missing,
    extra,
  };
}

/**
 * Compare two files byte-by-byte
 */
export function compareByteByByte(file1: string, file2: string): boolean {
  if (!existsSync(file1) || !existsSync(file2)) {
    return false;
  }

  const stat1 = statSync(file1);
  const stat2 = statSync(file2);

  if (stat1.size !== stat2.size) {
    return false;
  }

  const content1 = readFileSync(file1);
  const content2 = readFileSync(file2);

  return content1.equals(content2);
}

/**
 * Compare two files byte-by-byte asynchronously (for large files)
 */
export async function compareByteByByteAsync(
  file1: string,
  file2: string,
  chunkSize: number = 64 * 1024
): Promise<boolean> {
  if (!existsSync(file1) || !existsSync(file2)) {
    return false;
  }

  const stat1 = statSync(file1);
  const stat2 = statSync(file2);

  if (stat1.size !== stat2.size) {
    return false;
  }

  return new Promise((resolve, reject) => {
    const stream1 = createReadStream(file1, { highWaterMark: chunkSize });
    const stream2 = createReadStream(file2, { highWaterMark: chunkSize });

    let buffer1: Buffer = Buffer.alloc(0);
    let buffer2: Buffer = Buffer.alloc(0);
    let equal = true;

    const checkBuffers = (): void => {
      const minLen = Math.min(buffer1.length, buffer2.length);
      if (minLen > 0) {
        const chunk1 = buffer1.subarray(0, minLen);
        const chunk2 = buffer2.subarray(0, minLen);
        if (!chunk1.equals(chunk2)) {
          equal = false;
          stream1.destroy();
          stream2.destroy();
          resolve(false);
        }
        buffer1 = buffer1.subarray(minLen);
        buffer2 = buffer2.subarray(minLen);
      }
    };

    stream1.on("data", (chunk: Buffer) => {
      buffer1 = Buffer.concat([buffer1, chunk]);
      checkBuffers();
    });

    stream2.on("data", (chunk: Buffer) => {
      buffer2 = Buffer.concat([buffer2, chunk]);
      checkBuffers();
    });

    let stream1Ended = false;
    let stream2Ended = false;

    const checkEnd = (): void => {
      if (stream1Ended && stream2Ended) {
        resolve(equal && buffer1.length === 0 && buffer2.length === 0);
      }
    };

    stream1.on("end", () => {
      stream1Ended = true;
      checkEnd();
    });

    stream2.on("end", () => {
      stream2Ended = true;
      checkEnd();
    });

    stream1.on("error", reject);
    stream2.on("error", reject);
  });
}

/**
 * Compare two directories recursively
 */
export function compareDirectories(
  dir1: string,
  dir2: string,
  options: { checkMode?: boolean; checkMtime?: boolean } = {}
): VerificationResult {
  const manifest1 = computeDirectoryManifest(dir1);
  return verifyDirectoryIntegrity(dir2, manifest1, {
    ...options,
    allowExtra: false,
  });
}

/**
 * Verify a single file against expected checksums
 */
export function verifyFileChecksum(
  filePath: string,
  expected: ChecksumResult
): { match: boolean; actual?: ChecksumResult; reason?: string } {
  if (!existsSync(filePath)) {
    return { match: false, reason: "File not found" };
  }

  const actual = computeFileChecksum(filePath);

  if (actual.size !== expected.size) {
    return {
      match: false,
      actual,
      reason: `Size mismatch: expected ${expected.size}, got ${actual.size}`,
    };
  }

  if (actual.sha256 !== expected.sha256) {
    return {
      match: false,
      actual,
      reason: `SHA256 mismatch: expected ${expected.sha256}, got ${actual.sha256}`,
    };
  }

  if (actual.md5 !== expected.md5) {
    return {
      match: false,
      actual,
      reason: `MD5 mismatch: expected ${expected.md5}, got ${actual.md5}`,
    };
  }

  return { match: true, actual };
}

/**
 * Generate a test file with known content and return its checksums
 */
export function generateTestFileWithChecksum(
  outputPath: string,
  sizeBytes: number,
  options: {
    type?: "random" | "zeros" | "pattern" | "text";
    pattern?: number[];
    seed?: number;
  } = {}
): ChecksumResult {
  const { type = "random", pattern = [0xde, 0xad, 0xbe, 0xef], seed } = options;

  // Ensure directory exists
  const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let buffer: Buffer;

  switch (type) {
    case "zeros":
      buffer = Buffer.alloc(sizeBytes, 0);
      break;

    case "pattern":
      buffer = Buffer.alloc(sizeBytes);
      for (let i = 0; i < sizeBytes; i++) {
        buffer[i] = pattern[i % pattern.length];
      }
      break;

    case "text":
      const textPattern = "The quick brown fox jumps over the lazy dog. ";
      const repeated = textPattern.repeat(Math.ceil(sizeBytes / textPattern.length));
      buffer = Buffer.from(repeated.substring(0, sizeBytes), "utf-8");
      break;

    case "random":
    default:
      buffer = Buffer.alloc(sizeBytes);
      // Simple PRNG for reproducible "random" data when seed is provided
      let state = seed ?? Date.now();
      for (let i = 0; i < sizeBytes; i++) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        buffer[i] = state & 0xff;
      }
      break;
  }

  writeFileSync(outputPath, buffer);

  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    md5: createHash("md5").update(buffer).digest("hex"),
    size: sizeBytes,
  };
}

/**
 * Serialize a directory manifest to JSON
 */
export function serializeManifest(manifest: DirectoryManifest): string {
  return JSON.stringify(
    {
      basePath: manifest.basePath,
      files: Array.from(manifest.files.entries()),
      totalSize: manifest.totalSize,
      fileCount: manifest.fileCount,
      generatedAt: manifest.generatedAt,
    },
    null,
    2
  );
}

/**
 * Deserialize a directory manifest from JSON
 */
export function deserializeManifest(json: string): DirectoryManifest {
  const parsed = JSON.parse(json);
  return {
    basePath: parsed.basePath,
    files: new Map(parsed.files),
    totalSize: parsed.totalSize,
    fileCount: parsed.fileCount,
    generatedAt: parsed.generatedAt,
  };
}

/**
 * Save manifest to a file
 */
export function saveManifest(manifest: DirectoryManifest, filePath: string): void {
  writeFileSync(filePath, serializeManifest(manifest));
}

/**
 * Load manifest from a file
 */
export function loadManifest(filePath: string): DirectoryManifest {
  const content = readFileSync(filePath, "utf-8");
  return deserializeManifest(content);
}

/**
 * Assert that two directories are identical (throws on mismatch)
 */
export function assertDirectoriesEqual(
  dir1: string,
  dir2: string,
  options: { checkMode?: boolean } = {}
): void {
  const result = compareDirectories(dir1, dir2, options);
  if (!result.match) {
    const details = result.mismatches
      .slice(0, 10)
      .map((m) => `  - ${m.path}: ${m.reason}`)
      .join("\n");
    const more = result.mismatches.length > 10
      ? `\n  ... and ${result.mismatches.length - 10} more`
      : "";
    throw new Error(
      `Directories do not match:\n${details}${more}\n` +
        `Verified: ${result.verified}, Missing: ${result.missing}, Extra: ${result.extra}`
    );
  }
}

/**
 * Assert that a file matches expected checksums (throws on mismatch)
 */
export function assertFileChecksum(
  filePath: string,
  expected: ChecksumResult
): void {
  const result = verifyFileChecksum(filePath, expected);
  if (!result.match) {
    throw new Error(`File checksum mismatch for ${filePath}: ${result.reason}`);
  }
}
