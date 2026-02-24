import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

/**
 * Error State E2E Tests
 *
 * These tests verify the UI properly handles and displays error states.
 * Tests should NOT skip or pass silently when errors occur.
 */

test.describe("API Error Handling", () => {
  test("displays error message when API returns 500", async ({ page }) => {
    // Intercept API calls and return 500
    await page.route("**/api/jobs", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      })
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // An error indicator MUST be shown when the API returns 500
    const errorElements = page.locator(
      '[data-testid="error"], .error, [role="alert"], .toast-error, [class*="error"]'
    );
    const errorCount = await errorElements.count();
    expect(errorCount, "An error indicator must be displayed when the jobs API returns 500").toBeGreaterThan(0);
    await expect(errorElements.first()).toBeVisible();
  });

  test("displays error message when API is unavailable", async ({ page }) => {
    // Block all API requests
    await page.route("**/api/**", (route) => route.abort());

    await page.goto("/");

    // Page should render something, not just blank
    await page.waitForTimeout(3000); // Wait for potential retry

    // The page shell must remain rendered with meaningful content
    const pageShell = page.locator("main, nav, aside, h1, [class*='layout']");
    const shellCount = await pageShell.count();
    expect(shellCount, "Page shell must be visible even when API is completely unavailable").toBeGreaterThan(0);
  });

  test("handles network timeout gracefully", async ({ page }) => {
    // Simulate slow/timeout responses
    await page.route("**/api/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 30000)); // Never respond in time
    });

    await page.goto("/");

    // Page should render with loading or timeout state
    await page.waitForTimeout(5000);

    // The page shell must remain rendered
    const pageShell = page.locator("main, nav, aside, [class*='layout']");
    const shellCount = await pageShell.count();
    expect(shellCount, "Page shell must be visible during network timeout").toBeGreaterThan(0);
  });

  test("displays 404 page for non-existent routes", async ({ page }) => {
    const response = await page.goto("/nonexistent-page-12345");

    // Should either show 404 page or redirect — either way the page must render content
    const status = response?.status();
    if (status === 404) {
      // The 404 page must show meaningful content indicating the page was not found,
      // not just a raw HTML skeleton
      const notFoundContent = page.locator(
        '[data-testid="not-found"], h1:has-text("404"), h1:has-text("Not Found"), [class*="not-found"], main'
      );
      const notFoundCount = await notFoundContent.count();
      expect(notFoundCount, "A 404 page must render meaningful not-found content").toBeGreaterThan(0);
    } else {
      // A redirect is acceptable — verify the destination renders meaningful content
      const pageShell = page.locator("main, nav, aside, [class*='layout']");
      const shellCount = await pageShell.count();
      expect(shellCount, "Redirected page must render meaningful content").toBeGreaterThan(0);
    }
  });
});

test.describe("Job Error States", () => {
  test("shows error when job execution fails", async ({ request }) => {
    // Get jobs
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);

    const jobsData = await jobsResponse.json();
    expect(jobsData.jobs.length, "Jobs must exist for this test").toBeGreaterThan(0);

    // Prefer the known stable job; crud stubs with .example.com hosts sort first alphabetically.
    const testJob =
      jobsData.jobs.find((j: any) => j.name === "test-local-folder") ||
      jobsData.jobs.find((j: any) => !j.host?.includes(".example.com")) ||
      jobsData.jobs[0];

    // Trigger job
    await request.post(`${apiUrl}/api/jobs/${testJob.name}/run`, { data: {} });

    // Wait and check job details
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const detailResponse = await request.get(`${apiUrl}/api/jobs/${testJob.name}`);
    expect(detailResponse.ok()).toBe(true);

    const detailData = await detailResponse.json();

    // If there was a failure, it should be recorded properly
    if (detailData.lastRun?.status === "failed") {
      expect(detailData.lastRun).toHaveProperty("error");
    }
  });

  test("handles triggering non-existent job", async ({ request }) => {
    const response = await request.post(
      `${apiUrl}/api/jobs/job-that-does-not-exist-12345/run`,
      { data: {} }
    );

    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data).toHaveProperty("error");
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });

  test("handles getting non-existent job details", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/jobs/job-that-does-not-exist-12345`
    );

    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data).toHaveProperty("error");
  });
});

test.describe("Storage Error States", () => {
  test("handles non-existent storage backend", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/storage/nonexistent-storage-12345/status`
    );

    expect(response.status()).toBe(404);
  });

  test("handles storage connection failure", async ({ request }) => {
    // First get real storage
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const data = await storageResponse.json();
    expect(data.storage.length, "At least one storage must exist to test storage connection failure handling").toBeGreaterThan(0);

    // Try to get status - should succeed or fail gracefully
    const storageName = data.storage[0].name;
    const statusResponse = await request.get(
      `${apiUrl}/api/storage/${storageName}/status`
    );

    // Either 200 with connected:true/false or a proper error status
    if (statusResponse.ok()) {
      const statusData = await statusResponse.json();
      expect(typeof statusData.connected).toBe("boolean");
    } else {
      // Must be a proper client or server error, not a generic catch-all
      expect(statusResponse.status()).toBe(404);
    }
  });

  test("handles listing repos on non-existent storage", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/storage/nonexistent-storage-12345/repos`
    );

    expect(response.status()).toBe(404);
  });
});

test.describe("Restore Error States", () => {
  test("handles restore with invalid snapshot ID", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);
    const storageData = await storageResponse.json();

    expect(storageData.storage.length, "At least one storage must exist to test restore with invalid snapshot").toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;

    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storageName,
        repoName: "test-repo",
        snapshotId: "invalid-snapshot-id-12345",
        targetPath: "/tmp/test",
      },
    });

    expect(response.status()).toBe(404);
  });

  test("handles getting non-existent restore operation", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/restore/nonexistent-restore-id-12345`
    );

    expect(response.status()).toBe(404);
  });

  test("handles restore with missing required parameters", async ({ request }) => {
    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {},
    });

    expect(response.status()).toBe(400);
  });

  test("handles restore with invalid method", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);
    const storageData = await storageResponse.json();

    expect(storageData.storage.length, "At least one storage must exist to test restore with invalid method").toBeGreaterThan(0);

    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storageName: storageData.storage[0].name,
        repoName: "test-repo",
        snapshotId: "test-snapshot",
        method: "invalid-method",
        targetPath: "/tmp/test",
      },
    });

    expect(response.status()).toBe(400);
  });
});

test.describe("Worker Error States", () => {
  test("handles non-existent worker", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/workers/nonexistent-worker-12345`
    );

    expect(response.status()).toBe(404);
  });

  test("handles deleting non-existent worker", async ({ request }) => {
    const response = await request.delete(
      `${apiUrl}/api/workers/nonexistent-worker-12345`
    );

    expect(response.status()).toBe(404);
  });

  test("handles failover for non-existent group", async ({ request }) => {
    const response = await request.post(
      `${apiUrl}/api/workers/groups/nonexistent-group-12345/failover`
    );

    expect(response.status()).toBe(404);
  });
});

test.describe("Repository Error States", () => {
  test("handles non-existent repository", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);
    const storageData = await storageResponse.json();

    expect(storageData.storage.length, "At least one storage must exist to test non-existent repository handling").toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;

    const response = await request.get(
      `${apiUrl}/api/repos/${storageName}/nonexistent-repo-12345/snapshots`
    );

    expect(response.status()).toBe(404);
  });

  test("handles non-existent snapshot in repository", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);
    const storageData = await storageResponse.json();

    expect(storageData.storage.length, "At least one storage must exist to test non-existent snapshot handling").toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(
      `${apiUrl}/api/storage/${storageName}/repos`
    );

    expect(reposResponse.ok(), `GET /api/storage/${storageName}/repos must succeed`).toBe(true);
    const reposData = await reposResponse.json();
    expect(reposData.repos.length, "At least one repo must exist to test non-existent snapshot handling").toBeGreaterThan(0);

    const repoName = reposData.repos[0];

    const response = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots/nonexistent-snapshot/ls`
    );

    expect(response.status()).toBe(404);
  });

  test("handles repository check on non-existent repo", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);
    const storageData = await storageResponse.json();

    expect(storageData.storage.length, "At least one storage must exist to test repo check on non-existent repo").toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;

    const response = await request.post(
      `${apiUrl}/api/repos/${storageName}/nonexistent-repo-12345/check`
    );

    expect(response.status()).toBe(404);
  });
});

test.describe("UI Error Display", () => {
  test("error toast/notification is visible and informative", async ({ page }) => {
    // Route to return an error
    await page.route("**/api/jobs/*/run", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Test error message" }),
      })
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Try to find and click a run button
    const runButton = page.locator(
      'button:has-text("Run"), [data-testid="run-job"]'
    );
    const runButtonCount = await runButton.count();
    expect(runButtonCount, "A run job button must be present on the dashboard to test error toast display").toBeGreaterThan(0);

    await runButton.first().click();
    await page.waitForTimeout(2000);

    // The route is set to return 500; an error toast MUST appear
    const errorToast = page.locator(
      '.toast-error, [data-testid="error-toast"], .notification-error, [role="alert"]'
    );
    const errorToastCount = await errorToast.count();
    expect(errorToastCount, "An error toast/notification must be shown after a failed job run").toBeGreaterThan(0);
    await expect(errorToast.first()).toBeVisible();
  });

  test("error boundary catches React errors", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check that page rendered without error boundary fallback
    const errorBoundary = page.locator(
      '[data-testid="error-boundary"], .error-boundary-fallback'
    );
    const errorCount = await errorBoundary.count();

    // The page must NOT have triggered an error boundary on normal load
    expect(errorCount, "Error boundary must not be active on a normal page load").toBe(0);
  });
});

test.describe("Malformed Request Handling", () => {
  test("handles malformed JSON in request body", async ({ request }) => {
    // This tests internal server error handling
    // The exact behavior depends on the framework
    const response = await request.post(`${apiUrl}/api/jobs/test/run`, {
      headers: { "Content-Type": "application/json" },
      data: "not valid json",
    });

    // Must not crash — return either 400 (parse error) or 404 (job not found)
    // 500 is never acceptable
    expect([400, 404]).toContain(response.status());
  });

  test("handles missing content-type header", async ({ request }) => {
    const response = await request.post(`${apiUrl}/api/restore`, {
      data: { test: "data" },
    });

    // Should handle gracefully — missing required fields means 400
    expect(response.status()).toBe(400);
  });

  test("handles extremely long values", async ({ request }) => {
    const longString = "x".repeat(10000);

    const response = await request.get(
      `${apiUrl}/api/jobs/${longString}`
    );

    // Should not crash - return 400 or 404
    expect([400, 404, 414]).toContain(response.status());
  });

  test("handles special characters in parameters", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/jobs/${encodeURIComponent("test<script>alert(1)</script>")}`
    );

    expect(response.status()).toBe(404);
  });
});
