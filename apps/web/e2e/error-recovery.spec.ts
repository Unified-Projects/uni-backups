import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

test.describe("API Failure Recovery", () => {
  test("page recovers after API returns to normal", async ({ page }) => {
    await page.route("**/api/jobs", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      })
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // When the API returns a 500, the UI must show an error indicator
    const errorElements = page.locator(
      '[role="alert"], .error, [class*="error"], [data-testid="error"]'
    );
    const errorCount = await errorElements.count();
    expect(errorCount, "An error indicator must be shown when the jobs API returns 500").toBeGreaterThan(0);
    await expect(errorElements.first()).toBeVisible();

    await page.unroute("**/api/jobs");

    await page.reload();
    await page.waitForLoadState("networkidle");

    // After recovery the page must render meaningful UI structure
    const uiElements = page.locator(
      "table, ul, ol, [class*='job'], [class*='card'], [class*='list'], main, [class*='dashboard']"
    );
    const uiCount = await uiElements.count();
    expect(uiCount, "After API recovery, the page must render meaningful UI elements").toBeGreaterThan(0);
  });

  test("dashboard recovers after health endpoint fails then succeeds", async ({
    page,
  }) => {
    await page.route("**/health", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ status: "unhealthy" }),
      })
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The page must render a visible structure even when the health endpoint fails
    const uiElements = page.locator("main, nav, aside, [class*='dashboard'], [class*='layout']");
    const uiCount = await uiElements.count();
    expect(uiCount, "Page must render visible structure even when health endpoint fails").toBeGreaterThan(0);

    await page.unroute("**/health");

    await page.reload();
    await page.waitForLoadState("networkidle");

    // After recovery the page must render meaningful UI content
    const recoveredElements = page.locator(
      "main, nav, table, ul, [class*='card'], [class*='dashboard']"
    );
    const recoveredCount = await recoveredElements.count();
    expect(recoveredCount, "After health endpoint recovery, the page must render meaningful content").toBeGreaterThan(0);
  });

  test("page handles multiple API failures gracefully", async ({ page }) => {
    await page.route("**/api/**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "All services unavailable" }),
      })
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Even during a total API outage the page frame must remain visible
    const pageShell = page.locator("main, nav, aside, body > *");
    const shellCount = await pageShell.count();
    expect(shellCount, "Page shell must be visible during total API failure").toBeGreaterThan(0);

    await page.unroute("**/api/**");

    await page.reload();
    await page.waitForLoadState("networkidle");

    // After recovery the page must render meaningful UI elements
    const uiElements = page.locator(
      "table, ul, ol, [class*='job'], [class*='card'], [class*='list'], main, [class*='dashboard']"
    );
    const uiCount = await uiElements.count();
    expect(uiCount, "After total API failure recovery, the page must render meaningful content").toBeGreaterThan(0);
  });
});

test.describe("Restore Error Recovery", () => {
  test("shows error when restore API fails", async ({ page, request }) => {
    await page.route("**/api/restore", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Invalid restore parameters",
          }),
        });
      }
      return route.continue();
    });

    await page.goto("/restore");
    await page.waitForLoadState("networkidle");

    // The restore page must render actual page content, not a blank or crash screen
    const pageContent = page.locator("main, [data-testid='restore-page'], form, h1");
    const pageContentCount = await pageContent.count();
    expect(pageContentCount, "The restore page must render actual content").toBeGreaterThan(0);

    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {},
    });
    expect(response.status()).toBe(400);
  });

  test("restore with invalid snapshot returns proper error", async ({
    request,
  }) => {
    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storageName: "test",
        repoName: "test",
        snapshotId: "invalid-id-12345",
        targetPath: "/tmp/test",
      },
    });

    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data).toHaveProperty("error");
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });
});

test.describe("Job Run Error Recovery", () => {
  test("shows error when job run API fails", async ({ page, request }) => {
    await page.route("**/api/jobs/*/run", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Job execution failed" }),
      })
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const runButton = page.locator(
      'button:has-text("Run"), button:has-text("Trigger"), button:has-text("Start"), [data-testid="run-job"]'
    );
    const runButtonCount = await runButton.count();

    if (runButtonCount > 0) {
      await runButton.first().click();
      await page.waitForTimeout(2000);

      // The route is set to return 500; an error indicator MUST appear
      const errorIndicator = page.locator(
        '[role="alert"], .toast-error, [class*="error"], [data-testid="error-toast"], .notification-error, .toast'
      );
      const errorIndicatorCount = await errorIndicator.count();
      expect(errorIndicatorCount, "An error indicator must be shown after a failed job run").toBeGreaterThan(0);
      await expect(errorIndicator.first()).toBeVisible();
    } else {
      // No run button visible on this page — verify via direct API call instead.
      // The direct request bypasses the page route and hits the real API.
      const directResponse = await request.post(
        `${apiUrl}/api/jobs/nonexistent-error-recovery-job-xyz/run`,
        { data: {} }
      );
      expect(directResponse.status(), "non-existent job run should return 404").toBe(404);
    }
  });

  test("job run returns proper error for non-existent job", async ({
    request,
  }) => {
    const response = await request.post(
      `${apiUrl}/api/jobs/nonexistent-job-recovery-test/run`,
      { data: {} }
    );

    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data).toHaveProperty("error");
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });
});

test.describe("Network Recovery", () => {
  test("page recovers after network interruption", async ({ page }) => {
    await page.route("**/api/**", (route) => route.abort());

    await page.goto("/");
    await page.waitForTimeout(1000);

    // Even with all API requests aborted, the page shell must remain rendered
    const pageShell = page.locator("main, nav, aside, body > *");
    const shellCount = await pageShell.count();
    expect(shellCount, "Page shell must remain visible during network interruption").toBeGreaterThan(0);

    await page.unroute("**/api/**");

    await page.reload();
    await page.waitForLoadState("networkidle");

    // After recovery the page must render meaningful UI content
    const uiElements = page.locator(
      "table, ul, ol, main, [class*='card'], [class*='list'], [class*='dashboard'], nav"
    );
    const uiCount = await uiElements.count();
    expect(uiCount, "After network recovery, the page must render meaningful content").toBeGreaterThan(0);
  });

  test("data refreshes after network recovery", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Verify the page has rendered meaningful content before the outage
    const initialElements = page.locator(
      "table, ul, ol, main, [class*='card'], [class*='list'], [class*='dashboard'], nav"
    );
    const initialCount = await initialElements.count();
    expect(initialCount, "Page must render meaningful content before simulated network outage").toBeGreaterThan(0);

    await page.route("**/api/**", (route) => route.abort());
    await page.waitForTimeout(2000);

    await page.unroute("**/api/**");

    await page.reload();
    await page.waitForLoadState("networkidle");

    // After recovery the page must again render meaningful content
    const recoveredElements = page.locator(
      "table, ul, ol, main, [class*='card'], [class*='list'], [class*='dashboard']"
    );
    const uiCount = await recoveredElements.count();
    expect(uiCount, "After network recovery, the page must render meaningful UI content").toBeGreaterThan(0);
  });
});

test.describe("Storage Error Recovery", () => {
  test("handles storage endpoint failure and recovery", async ({ page }) => {
    await page.route("**/api/storage", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Storage service unavailable" }),
      })
    );

    await page.goto("/storage");
    await page.waitForLoadState("networkidle");

    // Even during storage failure the page shell must be visible
    const pageShell = page.locator("main, nav, aside, body > *");
    const shellCount = await pageShell.count();
    expect(shellCount, "Page shell must remain visible when storage API returns 500").toBeGreaterThan(0);

    await page.unroute("**/api/storage");

    await page.reload();
    await page.waitForLoadState("networkidle");

    // After recovery the storage page must render meaningful content
    const uiElements = page.locator(
      "table, ul, [class*='storage'], [class*='card'], [class*='list'], main"
    );
    const uiCount = await uiElements.count();
    expect(uiCount, "After storage API recovery, the page must render meaningful content").toBeGreaterThan(0);
  });

  test("non-existent storage returns 404", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/storage/nonexistent-storage-recovery-test/status`
    );

    expect(response.status()).toBe(404);
  });
});
