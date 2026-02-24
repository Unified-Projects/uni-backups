/**
 * Test Data Generator
 *
 * Utilities for generating test files of various types and sizes
 * with pre-computed checksums for verification.
 */

import { createHash } from "crypto";
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  symlinkSync,
  rmSync,
  readFileSync,
} from "fs";
import { join, dirname } from "path";
import type { ChecksumResult, DirectoryManifest, FileEntry } from "./checksum-helpers";

/**
 * Specification for generating a test file
 */
export interface TestFileSpec {
  name: string;
  size: number;
  type: "text" | "binary" | "json" | "symlink" | "empty" | "pattern" | "random";
  content?: string | Buffer;
  pattern?: number[];
  seed?: number;
  target?: string; // For symlinks
}

/**
 * Generated test file with path and checksums
 */
export interface GeneratedFile {
  path: string;
  relativePath: string;
  checksums: ChecksumResult;
  spec: TestFileSpec;
}

/**
 * Test data set containing multiple generated files
 */
export interface TestDataSet {
  basePath: string;
  files: GeneratedFile[];
  manifest: DirectoryManifest;
  totalSize: number;
}

/**
 * Standard set of test files for common testing scenarios
 */
export const STANDARD_TEST_FILES: TestFileSpec[] = [
  { name: "text.txt", size: 0, type: "text", content: "Hello World!\nThis is a test file." },
  { name: "empty.txt", size: 0, type: "empty" },
  { name: "binary.bin", size: 6, type: "binary", content: Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]) },
  { name: "json/config.json", size: 0, type: "json", content: JSON.stringify({ test: true, version: 1 }, null, 2) },
  { name: "nested/deep/file.txt", size: 0, type: "text", content: "Deeply nested content" },
  { name: "unicode/special.txt", size: 0, type: "text", content: "Hello World! Bonjour! Hola! Привет! 你好!" },
  { name: "spaces in name.txt", size: 0, type: "text", content: "File with spaces in name" },
  { name: "special-chars_2024.log", size: 0, type: "text", content: "Log file with special characters" },
];

/**
 * Comprehensive test files with various edge cases
 */
export const COMPREHENSIVE_TEST_FILES: TestFileSpec[] = [
  // Basic types
  { name: "text/simple.txt", size: 0, type: "text", content: "Simple text content" },
  { name: "text/multiline.txt", size: 0, type: "text", content: "Line 1\nLine 2\nLine 3\n" },
  { name: "text/empty.txt", size: 0, type: "empty" },

  // Binary files
  { name: "binary/zeros.bin", size: 1024, type: "pattern", pattern: [0x00] },
  { name: "binary/ones.bin", size: 1024, type: "pattern", pattern: [0xff] },
  { name: "binary/mixed.bin", size: 1024, type: "pattern", pattern: [0xde, 0xad, 0xbe, 0xef] },
  { name: "binary/random.bin", size: 4096, type: "random", seed: 12345 },

  // JSON files
  { name: "json/config.json", size: 0, type: "json", content: JSON.stringify({
    name: "test",
    version: "1.0.0",
    settings: { debug: true, timeout: 5000 }
  }, null, 2) },
  { name: "json/array.json", size: 0, type: "json", content: JSON.stringify([1, 2, 3, 4, 5]) },
  { name: "json/nested.json", size: 0, type: "json", content: JSON.stringify({
    level1: { level2: { level3: { value: "deep" } } }
  }, null, 2) },

  // Unicode and special characters
  { name: "unicode/chinese.txt", size: 0, type: "text", content: "中文测试内容" },
  { name: "unicode/russian.txt", size: 0, type: "text", content: "Русский текст" },
  { name: "unicode/arabic.txt", size: 0, type: "text", content: "النص العربي" },
  { name: "unicode/emoji.txt", size: 0, type: "text", content: "Test with emoji characters" },
  { name: "unicode/mixed.txt", size: 0, type: "text", content: "English 中文 Русский العربية" },

  // Special filenames
  { name: "spaces/file with spaces.txt", size: 0, type: "text", content: "Spaces in filename" },
  { name: "dashes/file-with-dashes.txt", size: 0, type: "text", content: "Dashes in filename" },
  { name: "dots/file.multiple.dots.txt", size: 0, type: "text", content: "Multiple dots" },
  { name: "underscores/file_with_underscores.txt", size: 0, type: "text", content: "Underscores in filename" },

  // Deeply nested
  { name: "deep/level1/level2/level3/level4/level5/file.txt", size: 0, type: "text", content: "Deep file" },

  // Various sizes
  { name: "sizes/1byte.bin", size: 1, type: "random", seed: 1 },
  { name: "sizes/100bytes.bin", size: 100, type: "random", seed: 2 },
  { name: "sizes/1kb.bin", size: 1024, type: "random", seed: 3 },
  { name: "sizes/10kb.bin", size: 10240, type: "random", seed: 4 },
  { name: "sizes/100kb.bin", size: 102400, type: "random", seed: 5 },
];

/**
 * Generate content based on specification
 */
function generateContent(spec: TestFileSpec): Buffer {
  if (spec.content) {
    return typeof spec.content === "string"
      ? Buffer.from(spec.content, "utf-8")
      : spec.content;
  }

  switch (spec.type) {
    case "empty":
      return Buffer.alloc(0);

    case "text":
      return Buffer.from(`Generated text file: ${spec.name}\n`, "utf-8");

    case "json":
      return Buffer.from(JSON.stringify({ generated: true, name: spec.name }, null, 2), "utf-8");

    case "binary":
      return generateRandomBuffer(spec.size, spec.seed);

    case "random":
      return generateRandomBuffer(spec.size, spec.seed);

    case "pattern":
      return generatePatternBuffer(spec.size, spec.pattern || [0x00]);

    case "symlink":
      // Symlinks don't have content
      return Buffer.alloc(0);

    default:
      return Buffer.alloc(0);
  }
}

/**
 * Generate a buffer with random data
 */
function generateRandomBuffer(size: number, seed?: number): Buffer {
  const buffer = Buffer.alloc(size);
  let state = seed ?? Date.now();

  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    buffer[i] = state & 0xff;
  }

  return buffer;
}

/**
 * Generate a buffer with repeating pattern
 */
function generatePatternBuffer(size: number, pattern: number[]): Buffer {
  const buffer = Buffer.alloc(size);

  for (let i = 0; i < size; i++) {
    buffer[i] = pattern[i % pattern.length];
  }

  return buffer;
}

/**
 * Compute checksums for a buffer
 */
function computeChecksums(buffer: Buffer): ChecksumResult {
  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    md5: createHash("md5").update(buffer).digest("hex"),
    size: buffer.length,
  };
}

/**
 * Generate a single test file
 */
export function generateTestFile(
  basePath: string,
  spec: TestFileSpec
): GeneratedFile {
  const fullPath = join(basePath, spec.name);
  const dir = dirname(fullPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (spec.type === "symlink") {
    if (existsSync(fullPath)) {
      rmSync(fullPath);
    }
    symlinkSync(spec.target || ".", fullPath);
    return {
      path: fullPath,
      relativePath: spec.name,
      checksums: { sha256: "", md5: "", size: 0 },
      spec,
    };
  }

  const content = generateContent(spec);
  writeFileSync(fullPath, content);

  return {
    path: fullPath,
    relativePath: spec.name,
    checksums: computeChecksums(content),
    spec,
  };
}

/**
 * Generate a set of test files
 */
export function generateTestDataSet(
  basePath: string,
  specs: TestFileSpec[]
): TestDataSet {
  if (!existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true });
  }

  const files: GeneratedFile[] = [];
  let totalSize = 0;

  for (const spec of specs) {
    const file = generateTestFile(basePath, spec);
    files.push(file);
    totalSize += file.checksums.size;
  }

  // Build manifest
  const manifestFiles = new Map<string, FileEntry>();
  for (const file of files) {
    manifestFiles.set(file.relativePath, {
      path: file.relativePath,
      checksums: file.checksums,
      mode: 0o644,
      mtime: Date.now(),
      isSymlink: file.spec.type === "symlink",
      symlinkTarget: file.spec.target,
    });
  }

  const manifest: DirectoryManifest = {
    basePath,
    files: manifestFiles,
    totalSize,
    fileCount: files.length,
    generatedAt: Date.now(),
  };

  return {
    basePath,
    files,
    manifest,
    totalSize,
  };
}

/**
 * Generate standard test data set
 */
export function generateStandardTestData(basePath: string): TestDataSet {
  return generateTestDataSet(basePath, STANDARD_TEST_FILES);
}

/**
 * Generate comprehensive test data set
 */
export function generateComprehensiveTestData(basePath: string): TestDataSet {
  return generateTestDataSet(basePath, COMPREHENSIVE_TEST_FILES);
}

/**
 * Generate a large file with known content
 */
export function generateLargeFile(
  outputPath: string,
  sizeBytes: number,
  options: {
    seed?: number;
    chunkSize?: number;
    type?: "random" | "pattern" | "text";
    pattern?: number[];
  } = {}
): { path: string; checksums: ChecksumResult } {
  const { seed = Date.now(), chunkSize = 1024 * 1024, type = "random", pattern = [0xde, 0xad, 0xbe, 0xef] } = options;

  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sha256Hash = createHash("sha256");
  const md5Hash = createHash("md5");

  // For very large files, write in chunks to avoid memory issues
  const fd = require("fs").openSync(outputPath, "w");
  let written = 0;
  let state = seed;

  const textPattern = "The quick brown fox jumps over the lazy dog. ";

  while (written < sizeBytes) {
    const remaining = sizeBytes - written;
    const thisChunkSize = Math.min(chunkSize, remaining);
    let chunk: Buffer;

    switch (type) {
      case "pattern":
        chunk = generatePatternBuffer(thisChunkSize, pattern);
        break;
      case "text":
        const repeated = textPattern.repeat(Math.ceil(thisChunkSize / textPattern.length));
        chunk = Buffer.from(repeated.substring(0, thisChunkSize), "utf-8");
        break;
      case "random":
      default:
        chunk = Buffer.alloc(thisChunkSize);
        for (let i = 0; i < thisChunkSize; i++) {
          state = (state * 1103515245 + 12345) & 0x7fffffff;
          chunk[i] = state & 0xff;
        }
        break;
    }

    sha256Hash.update(chunk);
    md5Hash.update(chunk);
    require("fs").writeSync(fd, chunk);
    written += thisChunkSize;
  }

  require("fs").closeSync(fd);

  return {
    path: outputPath,
    checksums: {
      sha256: sha256Hash.digest("hex"),
      md5: md5Hash.digest("hex"),
      size: sizeBytes,
    },
  };
}

/**
 * Generate a binary file with specific pattern
 */
export function generateBinaryWithPattern(
  outputPath: string,
  pattern: number[],
  size: number
): { path: string; checksums: ChecksumResult } {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const buffer = generatePatternBuffer(size, pattern);
  writeFileSync(outputPath, buffer);

  return {
    path: outputPath,
    checksums: computeChecksums(buffer),
  };
}

/**
 * Generate symbolic links
 */
export function generateSymlinks(
  basePath: string,
  links: Array<{ name: string; target: string }>
): void {
  if (!existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true });
  }

  for (const link of links) {
    const linkPath = join(basePath, link.name);
    const dir = dirname(linkPath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(linkPath)) {
      rmSync(linkPath);
    }

    symlinkSync(link.target, linkPath);
  }
}

/**
 * Generate a deeply nested directory structure
 */
export function generateDeepNestedStructure(
  basePath: string,
  depth: number,
  filesPerLevel: number,
  options: {
    fileSizeRange?: [number, number];
    seed?: number;
  } = {}
): TestDataSet {
  const { fileSizeRange = [100, 1000], seed = Date.now() } = options;

  const specs: TestFileSpec[] = [];
  let state = seed;

  function nextRandom(): number {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  }

  function generateLevel(prefix: string, currentDepth: number): void {
    if (currentDepth > depth) return;

    for (let i = 0; i < filesPerLevel; i++) {
      const size = fileSizeRange[0] + (nextRandom() % (fileSizeRange[1] - fileSizeRange[0]));
      specs.push({
        name: `${prefix}/file_${i}.bin`,
        size,
        type: "random",
        seed: nextRandom(),
      });
    }

    // Create subdirectories
    if (currentDepth < depth) {
      for (let i = 0; i < Math.min(3, filesPerLevel); i++) {
        generateLevel(`${prefix}/level_${currentDepth + 1}_dir_${i}`, currentDepth + 1);
      }
    }
  }

  generateLevel("root", 1);

  return generateTestDataSet(basePath, specs);
}

/**
 * Clean up a test data set
 */
export function cleanupTestData(dataSet: TestDataSet): void {
  if (existsSync(dataSet.basePath)) {
    rmSync(dataSet.basePath, { recursive: true, force: true });
  }
}

/**
 * Generate a file with specific byte at specific offsets (for corruption testing)
 */
export function generateCorruptibleFile(
  outputPath: string,
  size: number,
  knownOffsets: Array<{ offset: number; value: number }>
): { path: string; checksums: ChecksumResult; knownBytes: Array<{ offset: number; value: number }> } {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Generate base random content
  const buffer = generateRandomBuffer(size, 54321);

  // Set known bytes at specific offsets
  for (const { offset, value } of knownOffsets) {
    if (offset < size) {
      buffer[offset] = value;
    }
  }

  writeFileSync(outputPath, buffer);

  return {
    path: outputPath,
    checksums: computeChecksums(buffer),
    knownBytes: knownOffsets,
  };
}

/**
 * Corrupt a file at specific offset
 */
export function corruptFileAtOffset(
  filePath: string,
  offset: number,
  newValue: number
): void {
  const content = readFileSync(filePath);
  if (offset >= content.length) {
    throw new Error(`Offset ${offset} is beyond file size ${content.length}`);
  }
  content[offset] = newValue;
  writeFileSync(filePath, content);
}

/**
 * Pre-defined file size constants for testing
 */
export const FILE_SIZES = {
  TINY: 10,
  SMALL: 1024,
  MEDIUM: 1024 * 1024,
  LARGE: 10 * 1024 * 1024,
  XLARGE: 100 * 1024 * 1024,
  HUGE: 1024 * 1024 * 1024,
} as const;

/**
 * Generate test files at various size thresholds
 */
export function generateSizeThresholdFiles(
  basePath: string,
  maxSize: keyof typeof FILE_SIZES = "LARGE"
): TestDataSet {
  const sizes = Object.entries(FILE_SIZES).filter(
    ([_, size]) => size <= FILE_SIZES[maxSize]
  );

  const specs: TestFileSpec[] = sizes.map(([name, size]) => ({
    name: `size_${name.toLowerCase()}.bin`,
    size,
    type: "random" as const,
    seed: size,
  }));

  return generateTestDataSet(basePath, specs);
}
