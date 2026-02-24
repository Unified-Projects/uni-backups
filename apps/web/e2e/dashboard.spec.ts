import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

test.describe("Dashboard Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("renders the main layout", async ({ page }) => {
    const sidebar = page.locator('[data-testid="sidebar"], nav, aside').first();
    await expect(sidebar).toBeVisible();
  });

  test("displays application title", async ({ page }) => {
    const title = page.locator('h1, [data-testid="app-title"], header');
    await expect(title.first()).toBeVisible();
  });

  test("has working navigation links", async ({ page }) => {
    const navLinks = page.locator("nav a, [data-testid='nav-link']");
    const linkCount = await navLinks.count();
    expect(linkCount, "Navigation should have at least one link").toBeGreaterThan(0);
  });

  test("shows health status indicator", async ({ page }) => {
    const statusIndicator = page.locator(
      '[data-testid*="status"], [data-testid*="health"], .status, .health'
    );
    const count = await statusIndicator.count();
    expect(count, "Health status indicator must be present on the dashboard").toBeGreaterThan(0);
    await expect(statusIndicator.first()).toBeVisible();
  });

  test("page loads without errors", async ({ page }) => {
    // Exclude the Next.js AppRouterAnnouncer element which uses role="alert" for
    // accessibility purposes (screen reader route announcements) and is always present.
    const errorElements = page.locator(
      '[data-testid="error"], .error-boundary, [role="alert"]:not([id="__next-route-announcer__"])'
    );
    const errorCount = await errorElements.count();
    expect(errorCount, "Unexpected errors on page").toBe(0);
  });
});

test.describe("Dashboard API Integration", () => {
  test("API health check returns OK", async ({ request }) => {
    const response = await request.get(`${apiUrl}/health`);
    expect(response.ok(), `GET /health failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("status");
    expect(data.status).toBe("healthy");
  });

  test("can fetch cluster status", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/cluster/groups`);
    expect(response.ok(), `GET /api/cluster/groups failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("groups");
    expect(Array.isArray(data.groups)).toBe(true);
  });

  test("can fetch workers list", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers`);
    expect(response.ok(), `GET /api/workers failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("workers");
    expect(Array.isArray(data.workers)).toBe(true);
  });

  test("can fetch schedule overview", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/schedule`);
    expect(response.ok(), `GET /api/schedule failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("scheduled");
    expect(Array.isArray(data.scheduled)).toBe(true);
  });

  test("can fetch jobs list", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/jobs`);
    expect(response.ok(), `GET /api/jobs failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("jobs");
    expect(Array.isArray(data.jobs)).toBe(true);
  });

  test("can fetch storage configuration", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/storage`);
    expect(response.ok(), `GET /api/storage failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("storage");
    expect(Array.isArray(data.storage)).toBe(true);
  });
});

test.describe("Dashboard Overview Data", () => {
  test("displays job summary", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const jobElements = page.locator(
      '[data-testid*="job"], [class*="job"], .job-count, .jobs-summary'
    );
    const count = await jobElements.count();
    expect(count, "Job summary elements must be present on the dashboard").toBeGreaterThan(0);
    await expect(jobElements.first()).toBeVisible();
  });

  test("displays storage summary", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const storageElements = page.locator(
      '[data-testid*="storage"], [class*="storage"], .storage-count'
    );
    const count = await storageElements.count();
    expect(count, "Storage summary elements must be present on the dashboard").toBeGreaterThan(0);
    await expect(storageElements.first()).toBeVisible();
  });

  test("displays worker summary", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const workerElements = page.locator(
      '[data-testid*="worker"], [class*="worker"], .worker-count'
    );
    const count = await workerElements.count();
    expect(count, "Worker summary elements must be present on the dashboard").toBeGreaterThan(0);
    await expect(workerElements.first()).toBeVisible();
  });
});

test.describe("Dashboard Navigation", () => {
  test("can navigate to all main sections", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const jobsLink = page.locator('a[href*="job"]');
    const jobsLinkCount = await jobsLink.count();
    expect(jobsLinkCount, "Jobs navigation link must be present").toBeGreaterThan(0);
    await jobsLink.first().click();
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toContain("job");

    await page.goto("/");

    const storageLink = page.locator('a[href*="storage"]');
    const storageLinkCount = await storageLink.count();
    expect(storageLinkCount, "Storage navigation link must be present").toBeGreaterThan(0);
    await storageLink.first().click();
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toContain("storage");
  });

  test("sidebar remains visible during navigation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const sidebar = page.locator('[data-testid="sidebar"], nav, aside').first();
    await expect(sidebar).toBeVisible();

    const anyLink = page.locator('nav a').first();
    const anyLinkCount = await anyLink.count();
    expect(anyLinkCount, "Navigation must contain at least one link").toBeGreaterThan(0);
    await anyLink.click();
    await page.waitForLoadState("networkidle");

    await expect(sidebar).toBeVisible();
  });
});
