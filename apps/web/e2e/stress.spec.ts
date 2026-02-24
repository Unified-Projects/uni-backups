import { test, expect } from "@playwright/test";
import type { Job, StorageStats, PaginatedJobsResponse, StorageRepoStats } from "../src/lib/api";

function generateMockJobs(count: number): Job[] {
  const jobs: Job[] = [];
  const types: Array<"volume" | "folder" | "postgres" | "mariadb" | "redis"> = [
    "volume",
    "folder",
    "postgres",
    "mariadb",
    "redis",
  ];
  const statuses: Array<"running" | "success" | "failed"> = ["running", "success", "failed"];
  const storages = ["local-storage", "s3-prod", "sftp-backup", "rest-archive"];

  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    const status = statuses[i % statuses.length];
    const storage = storages[i % storages.length];
    const isRunning = status === "running";

    jobs.push({
      name: `job-${i.toString().padStart(4, "0")}`,
      type,
      storage,
      repo: `repo-${i % 50}`,
      schedule: i % 3 === 0 ? "0 2 * * *" : null,
      isRunning,
      lastRun:
        i % 10 === 0
          ? null
          : {
              startTime: new Date(Date.now() - Math.random() * 86400000).toISOString(),
              endTime: isRunning
                ? undefined
                : new Date(Date.now() - Math.random() * 43200000).toISOString(),
              status,
              message:
                status === "failed"
                  ? `Error backing up ${type} at iteration ${i}`
                  : status === "success"
                    ? `Successfully backed up ${type}`
                    : undefined,
              snapshotId: status === "success" ? `snap-${i}` : undefined,
            },
      source: type === "volume" ? `/var/data/volume-${i}` : type === "folder" ? `/data/folder-${i}` : undefined,
      database: type === "postgres" || type === "mariadb" || type === "redis" ? `db-${i}` : undefined,
      host: type === "postgres" || type === "mariadb" || type === "redis" ? `host-${i % 10}.example.com` : undefined,
    });
  }

  return jobs;
}

function generateMockRepos(count: number): StorageRepoStats[] {
  const repos: StorageRepoStats[] = [];

  for (let i = 0; i < count; i++) {
    repos.push({
      repo: `repo-${i.toString().padStart(3, "0")}`,
      totalSize: Math.floor(Math.random() * 10000000000) + 1000000,
      totalFileCount: Math.floor(Math.random() * 100000) + 1000,
      snapshotsCount: Math.floor(Math.random() * 500) + 10,
      error: i % 20 === 0 ? "Repository check failed" : undefined,
    });
  }

  return repos;
}

test.describe("Frontend Stress Tests", () => {
  test("Renders 500 jobs without crash", async ({ page }) => {
    const mockJobs = generateMockJobs(500);

    await page.route("**/api/jobs*", async (route) => {
      const url = new URL(route.request().url());
      const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
      const pageSizeParam = parseInt(url.searchParams.get("pageSize") || "50", 10);

      const startIndex = (pageParam - 1) * pageSizeParam;
      const endIndex = startIndex + pageSizeParam;
      const paginatedJobs = mockJobs.slice(startIndex, endIndex);

      const response: PaginatedJobsResponse = {
        jobs: paginatedJobs,
        pagination: {
          page: pageParam,
          pageSize: pageSizeParam,
          total: mockJobs.length,
          totalPages: Math.ceil(mockJobs.length / pageSizeParam),
        },
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    });

    await page.route("**/api/storage", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ storage: [] }),
      });
    });

    await page.route("**/api/schedule", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scheduled: [], running: [], recentRuns: [] }),
      });
    });

    const startTime = Date.now();

    await page.goto("/jobs");

    await page.waitForSelector("table, [data-testid='job-list'], main", { timeout: 30000 });

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(10000);

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0);

    const hasError = await page.locator("text=/error|crash|failed to load/i").count();
    expect(hasError).toBe(0);
  });

  test("Renders 100 repos without crash", async ({ page }) => {
    const mockRepos = generateMockRepos(100);

    await page.route("**/api/storage/*/stats", async (route) => {
      const totalSize = mockRepos.reduce((sum, repo) => sum + repo.totalSize, 0);
      const totalFileCount = mockRepos.reduce((sum, repo) => sum + repo.totalFileCount, 0);
      const totalSnapshots = mockRepos.reduce((sum, repo) => sum + repo.snapshotsCount, 0);

      const response: StorageStats = {
        storage: "test-storage",
        totalSize,
        totalFileCount,
        totalSnapshots,
        repoCount: mockRepos.length,
        repos: mockRepos,
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    });

    await page.route("**/api/storage", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          storage: [
            {
              name: "test-storage",
              type: "local",
              path: "/backup",
            },
          ],
        }),
      });
    });

    await page.route("**/api/storage/*/repos", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          storage: "test-storage",
          repos: mockRepos.map((r) => r.repo),
        }),
      });
    });

    await page.goto("/storage");

    await page.waitForSelector("main, [data-testid='storage-page']", { timeout: 30000 });

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0);

    const hasError = await page.locator("text=/error|crash|failed to load/i").count();
    expect(hasError).toBe(0);
  });

  test("Rapid pagination (10 clicks)", async ({ page }) => {
    const mockJobs = generateMockJobs(500);

    await page.route("**/api/jobs*", async (route) => {
      const url = new URL(route.request().url());
      const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
      const pageSizeParam = parseInt(url.searchParams.get("pageSize") || "50", 10);

      const startIndex = (pageParam - 1) * pageSizeParam;
      const endIndex = startIndex + pageSizeParam;
      const paginatedJobs = mockJobs.slice(startIndex, endIndex);

      const response: PaginatedJobsResponse = {
        jobs: paginatedJobs,
        pagination: {
          page: pageParam,
          pageSize: pageSizeParam,
          total: mockJobs.length,
          totalPages: Math.ceil(mockJobs.length / pageSizeParam),
        },
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    });

    await page.route("**/api/storage", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ storage: [] }),
      });
    });

    await page.route("**/api/schedule", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scheduled: [], running: [], recentRuns: [] }),
      });
    });

    await page.goto("/jobs");

    await page.waitForSelector("table, [data-testid='job-list'], main", { timeout: 30000 });

    for (let i = 0; i < 10; i++) {
      const nextButton = page.locator("button:has-text('Next'), button:has-text('→'), [aria-label*='next' i]").first();

      const isDisabled = await nextButton.isDisabled().catch(() => true);
      if (isDisabled) {
        break;
      }

      await nextButton.click({ timeout: 5000 }).catch(() => {
        console.log(`Click ${i + 1} failed, pagination may have ended`);
      });

      await page.waitForTimeout(100);
    }

    await page.waitForSelector("table, [data-testid='job-list'], main", { timeout: 30000 });

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0);

    const hasError = await page.locator("text=/error|crash/i").count();
    expect(hasError).toBe(0);
  });

  test("50 rapid refetch cycles", async ({ page }) => {
    await page.route("**/api/jobs*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobs: [],
          pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
        }),
      });
    });

    await page.route("**/api/storage", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ storage: [] }),
      });
    });

    await page.route("**/api/schedule", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scheduled: [], running: [], recentRuns: [] }),
      });
    });

    await page.route("**/api/schedule/stats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          successRate7d: 95.5,
          successRate30d: 94.2,
          totalBackups7d: 100,
          totalBackups30d: 500,
          failedBackups7d: 5,
          failedBackups30d: 30,
          averageDuration7d: 300,
          averageDuration30d: 320,
        }),
      });
    });

    await page.goto("/");

    await page.waitForSelector("main, body", { timeout: 30000 });

    for (let i = 0; i < 50; i++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(50);
    }

    await page.waitForSelector("main, body", { timeout: 30000 });

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0);

    const hasError = await page.locator("text=/error|crash/i").count();
    expect(hasError).toBe(0);
  });

  test("Navigate 20 times between pages", async ({ page }) => {
    await page.route("**/api/jobs*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobs: generateMockJobs(10),
          pagination: { page: 1, pageSize: 50, total: 10, totalPages: 1 },
        }),
      });
    });

    await page.route("**/api/storage", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          storage: [
            { name: "local-storage", type: "local", path: "/backup" },
          ],
        }),
      });
    });

    await page.route("**/api/storage/*/stats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          storage: "local-storage",
          totalSize: 1000000,
          totalFileCount: 100,
          totalSnapshots: 50,
          repoCount: 5,
          repos: generateMockRepos(5),
        }),
      });
    });

    await page.route("**/api/storage/*/repos", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          storage: "local-storage",
          repos: ["repo-1", "repo-2", "repo-3"],
        }),
      });
    });

    await page.route("**/api/schedule", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scheduled: [
            { name: "job-1", schedule: "0 2 * * *", nextRun: new Date().toISOString() },
          ],
          running: [],
          recentRuns: [],
        }),
      });
    });

    await page.route("**/api/schedule/stats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          successRate7d: 95.5,
          successRate30d: 94.2,
          totalBackups7d: 100,
          totalBackups30d: 500,
          failedBackups7d: 5,
          failedBackups30d: 30,
          averageDuration7d: 300,
          averageDuration30d: 320,
        }),
      });
    });

    await page.route("**/api/restore", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ operations: [] }),
      });
    });

    const pages = ["/", "/jobs", "/storage", "/schedule", "/restore"];

    for (let i = 0; i < 20; i++) {
      const targetPage = pages[i % pages.length];
      await page.goto(targetPage, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(100);
    }

    await page.waitForSelector("main, body", { timeout: 30000 });

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0);

    const hasError = await page.locator("text=/error|crash/i").count();
    expect(hasError).toBe(0);

    const memoryAvailable = await page.evaluate(() => {
      return (performance as any).memory !== undefined;
    });

    if (memoryAvailable) {
      const memory = await page.evaluate(() => {
        const mem = (performance as any).memory;
        return {
          usedJSHeapSize: mem.usedJSHeapSize,
          totalJSHeapSize: mem.totalJSHeapSize,
          jsHeapSizeLimit: mem.jsHeapSizeLimit,
        };
      });

      console.log("Memory stats after 20 navigations:", memory);

      expect(memory.usedJSHeapSize).toBeLessThan(memory.jsHeapSizeLimit * 0.9);
    }
  });
});
