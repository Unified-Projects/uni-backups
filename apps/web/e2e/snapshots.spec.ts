import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

test.describe("Snapshots Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("can navigate to snapshots/repos page", async ({ page }) => {
    const snapshotsLink = page.locator(
      'a[href*="snapshot"], a[href*="repo"], [data-testid="snapshots-link"]'
    );

    // The snapshots/repos navigation link MUST exist — its absence is a real failure
    await expect(snapshotsLink.first(), "Snapshots/repos navigation link must be present in the sidebar/nav").toBeVisible();

    await snapshotsLink.first().click();
    await page.waitForLoadState("domcontentloaded");

    const url = page.url();
    const hasSnapshotsUrl = url.includes("snapshot") || url.includes("repo");
    const hasSnapshotsContent = await page
      .locator('[data-testid*="snapshot"], .snapshot, h1:has-text("Snapshot")')
      .first()
      .isVisible();

    expect(hasSnapshotsUrl || hasSnapshotsContent, "Should show snapshots page").toBe(true);
  });

  test("displays storage list for snapshot browsing", async ({ page }) => {
    const storageLink = page.locator(
      'a[href*="storage"], [data-testid="storage-link"]'
    );

    // The storage navigation link MUST exist — its absence is a real failure
    await expect(storageLink.first(), "Storage navigation link must be present in the sidebar/nav").toBeVisible();

    await storageLink.first().click();
    await page.waitForLoadState("networkidle");

    const storageItems = page.locator(
      '[data-testid*="storage"], .storage-item, .storage-card'
    );
    const storageCount = await storageItems.count();
    expect(storageCount).toBeGreaterThanOrEqual(0);
  });
});

test.describe("Snapshots API Integration", () => {
  test("GET /api/storage returns storage backends", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/storage`);
    expect(response.ok(), `GET /api/storage failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("storage");
    expect(Array.isArray(data.storage)).toBe(true);
  });

  test("can list repositories in storage", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length, "At least one storage backend required").toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(`${apiUrl}/api/storage/${storageName}/repos`);
    expect(reposResponse.ok(), `GET /api/storage/${storageName}/repos failed`).toBe(true);

    const reposData = await reposResponse.json();
    expect(reposData).toHaveProperty("repos");
    expect(Array.isArray(reposData.repos)).toBe(true);
  });

  test("can list snapshots in repository", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length).toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(`${apiUrl}/api/storage/${storageName}/repos`);
    expect(reposResponse.ok()).toBe(true);

    const reposData = await reposResponse.json();

    // Repos must exist for this test to be meaningful
    expect(reposData.repos.length, "At least one repository must exist in the storage backend").toBeGreaterThan(0);

    const repoName = reposData.repos[0];
    const snapshotsResponse = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots`
    );
    expect(snapshotsResponse.ok(), `GET /api/repos/${storageName}/${repoName}/snapshots failed`).toBe(true);

    const snapshotsData = await snapshotsResponse.json();
    expect(snapshotsData).toHaveProperty("snapshots");
    expect(Array.isArray(snapshotsData.snapshots)).toBe(true);
  });
});

test.describe("Snapshot Details", () => {
  test("snapshots have required metadata", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length).toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(`${apiUrl}/api/storage/${storageName}/repos`);
    expect(reposResponse.ok()).toBe(true);

    const reposData = await reposResponse.json();

    // Repos must exist for snapshot metadata to be verifiable
    expect(reposData.repos.length, "At least one repository must exist to verify snapshot metadata").toBeGreaterThan(0);

    const repoName = reposData.repos[0];
    const snapshotsResponse = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots`
    );
    expect(snapshotsResponse.ok()).toBe(true);

    const snapshotsData = await snapshotsResponse.json();

    for (const snapshot of snapshotsData.snapshots) {
      expect(snapshot).toHaveProperty("id");
      expect(snapshot).toHaveProperty("time");
      expect(snapshot).toHaveProperty("hostname");
      expect(snapshot).toHaveProperty("paths");
    }
  });

  test("can list files in snapshot", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length).toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(`${apiUrl}/api/storage/${storageName}/repos`);
    expect(reposResponse.ok()).toBe(true);

    const reposData = await reposResponse.json();

    // Repos must exist to list files in a snapshot
    expect(reposData.repos.length, "At least one repository must exist to list snapshot files").toBeGreaterThan(0);

    const repoName = reposData.repos[0];
    const snapshotsResponse = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots`
    );
    expect(snapshotsResponse.ok()).toBe(true);

    const snapshotsData = await snapshotsResponse.json();

    // Snapshots must exist to verify file listing
    expect(
      snapshotsData.snapshots.length,
      "At least one snapshot must exist to test file listing"
    ).toBeGreaterThan(0);

    const snapshotId = snapshotsData.snapshots[0].id;
    const lsResponse = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots/${snapshotId}/ls`
    );
    expect(lsResponse.ok(), `GET /api/repos/.../snapshots/${snapshotId}/ls failed`).toBe(true);

    const lsData = await lsResponse.json();
    expect(lsData).toHaveProperty("entries");
    expect(Array.isArray(lsData.entries)).toBe(true);
  });
});

test.describe("Repository Statistics", () => {
  test("can get repository stats", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length).toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(`${apiUrl}/api/storage/${storageName}/repos`);
    expect(reposResponse.ok()).toBe(true);

    const reposData = await reposResponse.json();

    // Repos must exist to fetch stats
    expect(reposData.repos.length, "At least one repository must exist to get stats").toBeGreaterThan(0);

    const repoName = reposData.repos[0];
    const statsResponse = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/stats`
    );
    expect(statsResponse.ok(), `GET /api/repos/${storageName}/${repoName}/stats failed`).toBe(true);

    const statsData = await statsResponse.json();
    expect(statsData).toHaveProperty("stats");
    if (statsData.stats) {
      expect(statsData.stats).toHaveProperty("total_size");
      expect(statsData.stats).toHaveProperty("total_file_count");
    }
  });

  test("can verify repository integrity", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length).toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(`${apiUrl}/api/storage/${storageName}/repos`);
    expect(reposResponse.ok()).toBe(true);

    const reposData = await reposResponse.json();

    // Repos must exist to verify integrity
    expect(reposData.repos.length, "At least one repository must exist to verify integrity").toBeGreaterThan(0);

    const repoName = reposData.repos[0];
    const checkResponse = await request.post(
      `${apiUrl}/api/repos/${storageName}/${repoName}/check`
    );
    expect(checkResponse.ok(), `POST /api/repos/${storageName}/${repoName}/check failed`).toBe(true);

    const checkData = await checkResponse.json();
    expect(checkData).toHaveProperty("success");
    expect(checkData.success).toBe(true);
  });
});

test.describe("Snapshot Filtering", () => {
  test("can filter snapshots by tag", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length).toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(`${apiUrl}/api/storage/${storageName}/repos`);
    expect(reposResponse.ok()).toBe(true);

    const reposData = await reposResponse.json();

    // Repos must exist to test snapshot filtering
    expect(reposData.repos.length, "At least one repository must exist to test snapshot tag filtering").toBeGreaterThan(0);

    const repoName = reposData.repos[0];
    const snapshotsResponse = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots?tag=test`
    );
    expect(snapshotsResponse.ok()).toBe(true);

    const snapshotsData = await snapshotsResponse.json();
    expect(snapshotsData).toHaveProperty("snapshots");
    expect(Array.isArray(snapshotsData.snapshots)).toBe(true);
  });

  test("can get latest N snapshots", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length).toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(`${apiUrl}/api/storage/${storageName}/repos`);
    expect(reposResponse.ok()).toBe(true);

    const reposData = await reposResponse.json();

    // Repos must exist to test snapshot pagination
    expect(reposData.repos.length, "At least one repository must exist to test latest N snapshots").toBeGreaterThan(0);

    const repoName = reposData.repos[0];
    const snapshotsResponse = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots?latest=5`
    );
    expect(snapshotsResponse.ok()).toBe(true);

    const snapshotsData = await snapshotsResponse.json();
    expect(snapshotsData).toHaveProperty("snapshots");
    expect(snapshotsData.snapshots.length).toBeLessThanOrEqual(5);
  });

  test("returns 404 for non-existent repo", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length).toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const response = await request.get(
      `${apiUrl}/api/repos/${storageName}/nonexistent-repo-12345/snapshots`
    );
    expect(response.status()).toBe(404);
  });

  test("returns 404 for non-existent snapshot", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length).toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(`${apiUrl}/api/storage/${storageName}/repos`);
    expect(reposResponse.ok()).toBe(true);

    const reposData = await reposResponse.json();

    // Repos must exist to test 404 behaviour for a non-existent snapshot
    expect(reposData.repos.length, "At least one repository must exist to test non-existent snapshot 404").toBeGreaterThan(0);

    const repoName = reposData.repos[0];
    const response = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots/nonexistent-snapshot-id/ls`
    );
    expect(response.status()).toBe(404);
  });
});
