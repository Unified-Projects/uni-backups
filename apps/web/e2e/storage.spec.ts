import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

test.describe("Storage Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/storage");
  });

  test("displays storage page title", async ({ page }) => {
    await expect(page.locator("h1")).toBeVisible();
  });

  test("shows configured storage backends", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    // The storage list container must be present and contain at least one storage entry
    const storageList = page.locator("[data-testid='storage-list'], .storage-list");
    await expect(storageList).toBeVisible({ message: "Storage list container must be visible on the storage page" });
    const storageItems = storageList.locator("[data-testid*='storage-item'], [data-testid*='storage-card'], .storage-item, .storage-card");
    await expect(storageItems.first()).toBeVisible({ message: "At least one storage backend must be displayed" });
  });

  test("displays storage type badges", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    // Storage type badges must be present — every configured backend must show its type
    const typeBadges = page.locator("[data-testid='storage-type'], .storage-type-badge, [class*='type-badge']");
    await expect(typeBadges.first()).toBeVisible({ message: "Storage type badges must be displayed for configured backends" });
    const badgeTexts = await typeBadges.allTextContents();
    for (const text of badgeTexts) {
      expect(["local", "sftp", "s3", "rest"].some(t => text.toLowerCase().includes(t)),
        `Storage type badge "${text}" must contain a valid storage type`).toBe(true);
    }
  });

  test("shows storage status indicators", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    const storageItems = page.locator('[data-testid*="storage"], .storage-item, .storage-card');
    const count = await storageItems.count();
    expect(count, "At least one storage item must be displayed on the storage page").toBeGreaterThan(0);

    // Each storage item must have a status indicator
    const statusIndicators = page.locator('[data-testid*="status"], .status-indicator, [class*="status"]');
    await expect(statusIndicators.first()).toBeVisible({ message: "Storage status indicators must be present" });
  });
});

test.describe("Storage API Integration", () => {
  test("API returns storage configuration", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/storage`);
    expect(response.ok(), `GET /api/storage failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("storage");
    expect(Array.isArray(data.storage)).toBe(true);
  });

  test("API health check returns valid status", async ({ request }) => {
    const response = await request.get(`${apiUrl}/health`);
    expect(response.ok(), `GET /health failed with status ${response.status()} — the API must be healthy`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("status");
    expect(["ok", "healthy", "degraded"]).toContain(data.status);
  });

  test("storage backends have required properties", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/storage`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.storage).toBeDefined();

    for (const storage of data.storage) {
      expect(storage).toHaveProperty("name");
      expect(storage).toHaveProperty("type");
      expect(["local", "sftp", "s3", "rest"]).toContain(storage.type);
    }
  });

  test("can get storage status", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const data = await storageResponse.json();
    expect(data.storage.length, "At least one storage backend should be configured").toBeGreaterThan(0);

    const storageName = data.storage[0].name;
    const statusResponse = await request.get(`${apiUrl}/api/storage/${storageName}/status`);
    expect(statusResponse.ok(), `GET /api/storage/${storageName}/status failed`).toBe(true);

    const statusData = await statusResponse.json();
    expect(statusData).toHaveProperty("status");
    expect(["connected", "error"]).toContain(statusData.status);
  });

  test("can list repositories in storage", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const data = await storageResponse.json();
    expect(data.storage.length).toBeGreaterThan(0);

    const storageName = data.storage[0].name;
    const reposResponse = await request.get(`${apiUrl}/api/storage/${storageName}/repos`);
    expect(reposResponse.ok(), `GET /api/storage/${storageName}/repos failed`).toBe(true);

    const reposData = await reposResponse.json();
    expect(reposData).toHaveProperty("repos");
    expect(Array.isArray(reposData.repos)).toBe(true);
  });

  test("returns 404 for non-existent storage", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/storage/nonexistent-storage-12345/status`);
    expect(response.status()).toBe(404);
  });

  test("can get aggregated storage stats", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const data = await storageResponse.json();
    expect(data.storage.length).toBeGreaterThan(0);

    const storageName = data.storage[0].name;
    const statsResponse = await request.get(`${apiUrl}/api/storage/${storageName}/stats`);
    expect(statsResponse.status(), `GET /api/storage/${storageName}/stats must return 200 — the stats endpoint must be implemented`).toBe(200);

    const statsData = await statsResponse.json();
    expect(statsData).toHaveProperty("storage");
    expect(statsData).toHaveProperty("totalSize");
    expect(statsData).toHaveProperty("totalFileCount");
    expect(statsData).toHaveProperty("repoCount");
  });
});
