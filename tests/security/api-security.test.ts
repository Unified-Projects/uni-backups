/**
 * API Security Tests
 *
 * Tests for API endpoint security including:
 * - Input validation (path traversal, shell injection, SQL injection)
 * - Response safety (no credential leaks, no internal path leaks)
 * - Error handling (proper status codes, sanitized error messages)
 * - Payload size limits
 */

import { describe, it, expect, beforeAll } from "vitest";

const API_URL = process.env.TEST_API_URL || "http://localhost:3001";
let hasAPI = false;

describe("API Security Tests", { timeout: 60000 }, () => {
  beforeAll(async () => {
    try {
      const res = await fetch(`${API_URL}/api/health`);
      hasAPI = res.ok;
      if (!hasAPI) {
        console.warn("API server not available at", API_URL);
      }
    } catch (error) {
      hasAPI = false;
      console.warn("Cannot connect to API server:", error);
    }
  });

  describe("Input validation", () => {
    describe("Path traversal in job names", () => {
      const pathTraversalPayloads = [
        "../",
        "../../etc/passwd",
        "..\\",
        "..\\..\\windows\\system32",
        "../../../root/.ssh/id_rsa",
        "....//....//etc/passwd",
        "..%2F..%2F..%2Fetc%2Fpasswd",
        "job/../../../etc/passwd",
      ];

      pathTraversalPayloads.forEach((payload) => {
        it(`should reject path traversal attempt: ${payload}`, async () => {
          if (!hasAPI) return;

          const res = await fetch(`${API_URL}/api/jobs/${encodeURIComponent(payload)}`);

          // Should not return 200 with file contents
          expect(res.status).not.toBe(200);

          // Should return 400 (Bad Request) or 404 (Not Found)
          expect([400, 404]).toContain(res.status);

          // Response should not contain sensitive file markers
          const text = await res.text();
          expect(text).not.toMatch(/root:/i);
          expect(text).not.toMatch(/\/etc\/passwd/);
          expect(text).not.toMatch(/ssh-rsa/);
        });
      });

      it("should reject path traversal in job history endpoint", async () => {
        if (!hasAPI) return;

        const payload = "../../etc/passwd";
        const res = await fetch(`${API_URL}/api/jobs/${encodeURIComponent(payload)}/history`);

        expect(res.status).not.toBe(200);
        expect([400, 404]).toContain(res.status);
      });

      it("should reject path traversal in job run endpoint", async () => {
        if (!hasAPI) return;

        const payload = "../../../bin/sh";
        const res = await fetch(`${API_URL}/api/jobs/${encodeURIComponent(payload)}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        expect(res.status).not.toBe(200);
        expect([400, 404, 405]).toContain(res.status);
      });
    });

    describe("Shell injection in storage names", () => {
      const shellInjectionPayloads = [
        "storage; ls -la",
        "storage | cat /etc/passwd",
        "storage`whoami`",
        "storage$(cat /etc/passwd)",
        "storage && rm -rf /",
        "storage; echo vulnerable",
        "storage\ncat /etc/passwd",
        "storage;sleep 10;",
        "storage`sleep 10`",
        "storage$(sleep 10)",
      ];

      shellInjectionPayloads.forEach((payload) => {
        it(`should reject shell injection attempt: ${payload}`, async () => {
          if (!hasAPI) return;

          const res = await fetch(`${API_URL}/api/storage/${encodeURIComponent(payload)}/status`);

          // Should not execute commands
          expect(res.status).not.toBe(200);

          // Should return 400 (Bad Request) or 404 (Not Found)
          expect([400, 404]).toContain(res.status);

          const text = await res.text();
          // Should not contain shell command output
          expect(text).not.toMatch(/root:/);
          expect(text).not.toMatch(/vulnerable/);
          expect(text).not.toMatch(/total \d+/);
        });
      });

      it("should reject shell injection in storage repos endpoint", async () => {
        if (!hasAPI) return;

        const payload = "storage; cat /etc/passwd";
        const res = await fetch(`${API_URL}/api/storage/${encodeURIComponent(payload)}/repos`);

        expect(res.status).not.toBe(200);
        expect([400, 404]).toContain(res.status);
      });

      it("should reject shell injection in storage stats endpoint", async () => {
        if (!hasAPI) return;

        const payload = "storage`whoami`";
        const res = await fetch(`${API_URL}/api/storage/${encodeURIComponent(payload)}/stats`);

        expect(res.status).not.toBe(200);
        expect([400, 404]).toContain(res.status);
      });
    });

    describe("Non-alphanumeric snapshot IDs", () => {
      const maliciousSnapshotIds = [
        "'; DROP TABLE snapshots;--",
        "<script>alert('xss')</script>",
        "../../etc/passwd",
        "snapshot`whoami`",
        "snapshot$(cat /etc/passwd)",
        "../../../bin/bash",
        "snapshot; rm -rf /",
        "snapshot\0null-byte",
        "%00null-byte",
        "snapshot\n\nmalicious",
      ];

      maliciousSnapshotIds.forEach((snapshotId) => {
        it(`should reject malicious snapshot ID: ${snapshotId}`, async () => {
          if (!hasAPI) return;

          const storage = "test-storage";
          const repo = "test-repo";
          const res = await fetch(
            `${API_URL}/api/repos/${encodeURIComponent(storage)}/${encodeURIComponent(repo)}/snapshots/${encodeURIComponent(snapshotId)}`
          );

          // Should not return 200 or execute malicious code
          expect(res.status).not.toBe(200);

          // Should return 400 (Bad Request) or 404 (Not Found)
          expect([400, 404]).toContain(res.status);

          const text = await res.text();
          // Should not contain SQL or XSS execution results
          expect(text).not.toMatch(/<script>/);
          expect(text).not.toMatch(/DROP TABLE/);
        });
      });

      it("should reject malicious snapshot ID in ls endpoint", async () => {
        if (!hasAPI) return;

        const storage = "test-storage";
        const repo = "test-repo";
        const snapshotId = "'; DELETE FROM files;--";

        const res = await fetch(
          `${API_URL}/api/repos/${encodeURIComponent(storage)}/${encodeURIComponent(repo)}/snapshots/${encodeURIComponent(snapshotId)}/ls`
        );

        expect(res.status).not.toBe(200);
        expect([400, 404]).toContain(res.status);
      });
    });

    describe("Restore paths outside allowed directories", () => {
      const dangerousPaths = [
        "/etc/shadow",
        "../../../etc/passwd",
        "/root/.ssh/id_rsa",
        "../../../../../../etc/shadow",
        "/var/log/auth.log",
        "/proc/self/environ",
        "C:\\Windows\\System32\\config\\SAM",
        "/dev/null",
        "/sys/kernel/security",
      ];

      dangerousPaths.forEach((targetPath) => {
        it(`should reject restore to dangerous path: ${targetPath}`, async () => {
          if (!hasAPI) return;

          const res = await fetch(`${API_URL}/api/restore`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storage: "test-storage",
              repo: "test-repo",
              snapshotId: "test-snapshot",
              paths: ["/some/path"],
              method: "path",
              target: targetPath,
            }),
          });

          // Should not allow restore to dangerous locations
          expect(res.status).not.toBe(200);
          expect(res.status).not.toBe(201);

          // Should return 400 (Bad Request) or 403 (Forbidden)
          expect([400, 403, 404]).toContain(res.status);
        });
      });

      it("should reject restore with path traversal in paths array", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage: "test-storage",
            repo: "test-repo",
            snapshotId: "test-snapshot",
            paths: ["../../../etc/passwd", "../../root/.ssh/"],
            method: "download",
          }),
        });

        expect(res.status).not.toBe(200);
        expect(res.status).not.toBe(201);
        expect([400, 403, 404]).toContain(res.status);
      });
    });

    describe("404 for non-existent resources", () => {
      it("should return 404 for non-existent job", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/jobs/nonexistent-job-name-12345`);
        expect(res.status).toBe(404);

        const json = await res.json();
        expect(json).toHaveProperty("error");
      });

      it("should return 404 for non-existent storage", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/storage/nonexistent-storage-12345/status`);
        expect(res.status).toBe(404);

        const json = await res.json();
        expect(json).toHaveProperty("error");
      });

      it("should return 404 for non-existent storage repos", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/storage/nonexistent-storage-12345/repos`);
        expect(res.status).toBe(404);
      });

      it("should return 404 for non-existent snapshot", async () => {
        if (!hasAPI) return;

        const res = await fetch(
          `${API_URL}/api/repos/nonexistent-storage/nonexistent-repo/snapshots/nonexistent-snapshot`
        );
        expect(res.status).toBe(404);
      });

      it("should return 404 for non-existent restore operation", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/restore/nonexistent-restore-id-12345`);
        expect(res.status).toBe(404);
      });
    });

    describe("400 for malformed request bodies", () => {
      it("should return 400 for empty POST body on restore", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "",
        });

        expect(res.status).toBe(400);
      });

      it("should return 400 for invalid JSON on restore", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{invalid json here}",
        });

        expect(res.status).toBe(400);
      });

      it("should return 400 for missing required fields on restore", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage: "test-storage",
            // Missing repo, snapshotId, method
          }),
        });

        expect(res.status).toBe(400);

        const json = await res.json();
        expect(json).toHaveProperty("error");
      });

      it("should return 400 for wrong type on restore method", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage: "test-storage",
            repo: "test-repo",
            snapshotId: "test-snapshot",
            method: "invalid-method-type",
            paths: ["/some/path"],
          }),
        });

        expect(res.status).toBe(400);
      });

      it("should return 400 for array instead of string on storage name", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage: ["array", "not", "string"],
            repo: "test-repo",
            snapshotId: "test-snapshot",
            method: "download",
          }),
        });

        expect(res.status).toBe(400);
      });

      it("should return 400 for null values on required fields", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage: null,
            repo: null,
            snapshotId: null,
            method: null,
          }),
        });

        expect(res.status).toBe(400);
      });
    });

    describe("Oversized payload rejection", () => {
      it("should reject very large POST body (1MB+)", async () => {
        if (!hasAPI) return;

        // Create a 2MB payload
        const largePayload = {
          storage: "test-storage",
          repo: "test-repo",
          snapshotId: "test-snapshot",
          method: "download",
          paths: Array(50000).fill("/very/long/path/name/that/repeats/many/times/to/create/large/payload"),
          extraData: "x".repeat(1024 * 1024), // 1MB of x's
        };

        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(largePayload),
        });

        // Should reject with 413 (Payload Too Large) or 400
        expect([400, 413]).toContain(res.status);
      });

      it("should reject extremely large JSON array", async () => {
        if (!hasAPI) return;

        const largeArray = Array(100000).fill({
          storage: "test",
          repo: "test",
          snapshotId: "test",
          method: "download",
          paths: ["/test/path"],
        });

        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(largeArray),
        });

        expect([400, 413]).toContain(res.status);
      });
    });
  });

  describe("Response safety", () => {
    describe("Credentials not leaked in API responses", () => {
      it("should not leak credentials in storage list response", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/storage`);

        // The /api/storage endpoint must return 200 (an empty list is fine) or
        // 404 (no storage configured). A 500 is never acceptable.
        expect(res.status).not.toBe(500);

        if (res.status !== 200) {
          // No storage configured — the test cannot proceed further, but we
          // have already asserted it did not fail with a server error.
          expect([404, 204]).toContain(res.status);
          return;
        }

        const json = await res.json();
        const responseText = JSON.stringify(json);

        // Check that actual credential VALUES are not present
        // (field names like "password" are OK, but not the actual password values)

        // Should not contain common credential patterns
        expect(responseText).not.toMatch(/password["']?\s*:\s*["'][^"']{3,}/i);
        expect(responseText).not.toMatch(/secret_key["']?\s*:\s*["'][^"']{3,}/i);
        expect(responseText).not.toMatch(/access_key["']?\s*:\s*["'][^"']{3,}/i);
        expect(responseText).not.toMatch(/api_key["']?\s*:\s*["'][^"']{3,}/i);
        expect(responseText).not.toMatch(/token["']?\s*:\s*["'][^"']{3,}/i);

        // Should not contain AWS-style keys
        expect(responseText).not.toMatch(/AKIA[0-9A-Z]{16}/);

        // Should not contain base64-encoded secrets (common pattern)
        // Allow short base64 strings, but flag long ones that look like secrets
        const base64Pattern = /["'][A-Za-z0-9+/]{40,}={0,2}["']/;
        if (base64Pattern.test(responseText)) {
          console.warn("Warning: Response may contain base64-encoded credentials");
        }

        // If storage array exists and has items, verify redaction
        if (json.storage && Array.isArray(json.storage) && json.storage.length > 0) {
          json.storage.forEach((storage: any) => {
            // Credentials should be undefined, null, or redacted strings like "***"
            if (storage.password !== undefined) {
              expect(storage.password === null ||
                     storage.password === undefined ||
                     storage.password === "***" ||
                     storage.password === "[REDACTED]").toBe(true);
            }
            if (storage.secret_key !== undefined) {
              expect(storage.secret_key === null ||
                     storage.secret_key === undefined ||
                     storage.secret_key === "***" ||
                     storage.secret_key === "[REDACTED]").toBe(true);
            }
            if (storage.access_key !== undefined) {
              expect(storage.access_key === null ||
                     storage.access_key === undefined ||
                     storage.access_key === "***" ||
                     storage.access_key === "[REDACTED]").toBe(true);
            }
          });
        }
      });

      it("should not leak credentials in error responses", async () => {
        if (!hasAPI) return;

        // Trigger an error with a malformed request
        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invalid: "data" }),
        });

        expect(res.status).toBe(400);

        const text = await res.text();

        // Error messages should not leak credentials
        expect(text).not.toMatch(/password=\S+/i);
        expect(text).not.toMatch(/secret[_-]?key=\S+/i);
        expect(text).not.toMatch(/access[_-]?key=\S+/i);
        expect(text).not.toMatch(/AKIA[0-9A-Z]{16}/);
      });

      it("should not leak credentials in job details", async () => {
        if (!hasAPI) return;

        // Try to get a job (may not exist, that's OK)
        const res = await fetch(`${API_URL}/api/jobs`);

        // /api/jobs must not return a 500 — an empty list (200) is acceptable.
        expect(res.status).not.toBe(500);

        if (res.status !== 200) {
          expect([404, 204]).toContain(res.status);
          return;
        }

        const json = await res.json();
        const responseText = JSON.stringify(json);

        // Should not contain credential values
        expect(responseText).not.toMatch(/password["']?\s*:\s*["'][^"']{3,}/i);
        expect(responseText).not.toMatch(/secret["']?\s*:\s*["'][^"']{3,}/i);
        expect(responseText).not.toMatch(/AKIA[0-9A-Z]{16}/);
      });
    });

    describe("Error responses do not leak internal paths", () => {
      it("should not leak absolute file paths in 404 errors", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/jobs/nonexistent-job-12345`);
        expect(res.status).toBe(404);

        const text = await res.text();

        // Should not contain absolute paths
        expect(text).not.toMatch(/\/home\/[a-z0-9_-]+\//i);
        expect(text).not.toMatch(/\/Users\/[a-z0-9_-]+\//i);
        expect(text).not.toMatch(/\/var\/www\//i);
        expect(text).not.toMatch(/\/opt\//);
        expect(text).not.toMatch(/C:\\Users\\/i);
        expect(text).not.toMatch(/C:\\Program Files\\/i);

        // Should not contain common app paths
        expect(text).not.toMatch(/\/app\//);
        expect(text).not.toMatch(/\/src\//);
        expect(text).not.toMatch(/node_modules/);
      });

      it("should not leak stack traces in error responses", async () => {
        if (!hasAPI) return;

        // Try to trigger an error
        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{{{{invalid",
        });

        expect(res.status).toBe(400);

        const text = await res.text();

        // Should not contain stack trace markers
        expect(text).not.toMatch(/at \w+\s+\(/);
        expect(text).not.toMatch(/Error:\s+\w+\s+at/);
        expect(text).not.toMatch(/\.ts:\d+:\d+/);
        expect(text).not.toMatch(/\.js:\d+:\d+/);
        expect(text).not.toMatch(/\s+at Object\./);
        expect(text).not.toMatch(/\s+at Module\./);
      });

      it("should not leak module paths in error responses", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/storage/malformed%00null/status`);

        const text = await res.text();

        // Should not contain module paths
        expect(text).not.toMatch(/node_modules/);
        expect(text).not.toMatch(/packages\/\w+\/src/);
        expect(text).not.toMatch(/dist\/\w+/);
        expect(text).not.toMatch(/build\/\w+/);
      });

      it("should not leak environment variables in error responses", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage: "$(env)",
            repo: "${PATH}",
            snapshotId: "$HOME",
            method: "download",
          }),
        });

        const text = await res.text();

        // Should not contain environment variable expansions
        expect(text).not.toMatch(/\/usr\/local\/bin/);
        expect(text).not.toMatch(/\/bin:/);
        expect(text).not.toMatch(/HOME=/);
        expect(text).not.toMatch(/PATH=/);
      });

      it("should provide clean error messages without internal details", async () => {
        if (!hasAPI) return;

        const res = await fetch(`${API_URL}/api/jobs/nonexistent`);
        expect(res.status).toBe(404);

        const json = await res.json();

        // Should have a clean error message
        expect(json).toHaveProperty("error");
        expect(typeof json.error).toBe("string");
        expect(json.error.length).toBeGreaterThan(0);
        expect(json.error.length).toBeLessThan(200); // Reasonable length

        // Should not contain technical jargon or internal details
        expect(json.error).not.toMatch(/undefined|null|NaN/);
        expect(json.error).not.toMatch(/stack|trace/i);
      });
    });
  });
});
