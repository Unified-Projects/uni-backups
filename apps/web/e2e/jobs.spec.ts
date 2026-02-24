import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

test.describe("Jobs Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("displays home page", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    const content = await page.content();
    expect(content).toContain("html");
  });

  test("can navigate to jobs page", async ({ page }) => {
    const jobsLink = page.locator('a[href*="job"], [data-testid="jobs-link"]');
    const linkCount = await jobsLink.count();
    expect(linkCount, "Jobs navigation link should exist").toBeGreaterThan(0);

    await jobsLink.first().click();
    await page.waitForLoadState("domcontentloaded");

    const url = page.url();
    const hasJobsUrl = url.includes("job");
    const hasJobsContent = await page.locator('[data-testid*="job"], .job-list, [class*="job"], h1, h2').first().isVisible();

    expect(hasJobsUrl || hasJobsContent, "Should navigate to jobs page or show jobs content").toBe(true);
  });
});

test.describe("Jobs API Integration", () => {
  test("API returns jobs list", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/jobs`);
    expect(response.ok(), `GET /api/jobs failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("jobs");
    expect(Array.isArray(data.jobs)).toBe(true);
  });

  test("can get job details", async ({ request }) => {
    const listResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(listResponse.ok(), `GET /api/jobs failed with status ${listResponse.status()}`).toBe(true);

    const listData = await listResponse.json();
    expect(listData.jobs, "Jobs list should exist").toBeDefined();
    expect(listData.jobs.length, "At least one job should be configured for testing").toBeGreaterThan(0);

    const jobName = listData.jobs[0].name;

    const detailResponse = await request.get(`${apiUrl}/api/jobs/${jobName}`);
    expect(detailResponse.ok(), `GET /api/jobs/${jobName} failed with status ${detailResponse.status()}`).toBe(true);

    const detailData = await detailResponse.json();
    expect(detailData).toHaveProperty("name");
    expect(detailData.name).toBe(jobName);
  });

  test("can trigger job run", async ({ request }) => {
    const listResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(listResponse.ok(), `GET /api/jobs failed with status ${listResponse.status()}`).toBe(true);

    const listData = await listResponse.json();
    expect(listData.jobs, "Jobs list should exist").toBeDefined();
    expect(listData.jobs.length, "At least one job should be configured for testing").toBeGreaterThan(0);

    const jobName = listData.jobs[0].name;

    const runResponse = await request.post(`${apiUrl}/api/jobs/${jobName}/run`, {
      data: {},
    });
    expect(runResponse.status(), `POST /api/jobs/${jobName}/run failed with status ${runResponse.status()}`).toBe(200);

    const runData = await runResponse.json();
    expect(runData).toHaveProperty("status");
    expect(["started", "queued"]).toContain(runData.status);
  });

  test("returns 404 for non-existent job", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/jobs/nonexistent-job-12345`);
    expect(response.status()).toBe(404);
  });

  test("returns 404 when triggering non-existent job", async ({ request }) => {
    const response = await request.post(`${apiUrl}/api/jobs/nonexistent-job-12345/run`, {
      data: {},
    });
    expect(response.status()).toBe(404);
  });
});

test.describe("Backup Workflow E2E", () => {
  test.setTimeout(120000); // 2 minute timeout for workflow

  test("complete backup workflow", async ({ request }) => {
    const healthResponse = await request.get(`${apiUrl}/health`);
    expect(healthResponse.ok(), "API health check failed - ensure API is running").toBe(true);

    const healthData = await healthResponse.json();
    expect(["ok", "healthy", "degraded"]).toContain(healthData.status);

    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok(), "Failed to get jobs list").toBe(true);

    const jobsData = await jobsResponse.json();
    expect(jobsData.jobs, "Jobs list should exist").toBeDefined();
    expect(jobsData.jobs.length, "At least one job should be configured for E2E testing").toBeGreaterThan(0);

    // Prefer test-local-folder specifically — it has a known source path that exists in
    // the test container. Avoid dynamically-created jobs like test-folder-backup (source
    // /data/test which doesn't exist) that sort alphabetically before test-local-folder.
    const localJob =
      jobsData.jobs.find((j: any) => j.name === "test-local-folder") ||
      jobsData.jobs.find(
        (j: any) =>
          (j.type === "folder" || j.type === "volume") &&
          j.storage.toLowerCase().includes("local") &&
          j.name.startsWith("test-local")
      );
    const testJob = localJob || jobsData.jobs[0];

    const runResponse = await request.post(`${apiUrl}/api/jobs/${testJob.name}/run`, {
      data: {},
    });
    expect(runResponse.status(), `POST /api/jobs/${testJob.name}/run failed with status ${runResponse.status()}`).toBe(200);

    const runData = await runResponse.json();
    expect(["started", "queued"]).toContain(runData.status);

    const maxWaitMs = 60000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();
    let lastStatus = "";

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      const statusResponse = await request.get(`${apiUrl}/api/jobs/${testJob.name}`);
      expect(statusResponse.ok(), "Failed to get job status").toBe(true);

      const statusData = await statusResponse.json();
      expect(statusData).toHaveProperty("name");
      expect(statusData.name).toBe(testJob.name);

      if (statusData.lastRun) {
        lastStatus = statusData.lastRun.status;
        if (lastStatus === "completed" || lastStatus === "failed") {
          break;
        }
      }

      if (!statusData.isRunning && !statusData.lastRun) {
        break;
      }
    }

    expect(["completed"], `Job failed with status: ${lastStatus}`).toContain(lastStatus);
  });

  test("job history is recorded after run", async ({ request }) => {
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);

    const jobsData = await jobsResponse.json();
    expect(jobsData.jobs.length).toBeGreaterThan(0);

    // Prefer a known configured job that parallel browser tests won't delete.
    // jobs-crud tests may create/delete dynamic jobs (e.g. "mariadb-backup-test"),
    // so prefer jobs from the base config (named "test-*") as they are more stable.
    const stableJob =
      jobsData.jobs.find((j: any) =>
        ["test-local-folder", "test-postgres", "test-mariadb", "test-redis",
         "test-s3-folder", "test-sftp-folder", "test-rest-folder"].includes(j.name)
      ) || jobsData.jobs[0];

    const testJob = stableJob;

    await request.post(`${apiUrl}/api/jobs/${testJob.name}/run`, { data: {} });

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const detailResponse = await request.get(`${apiUrl}/api/jobs/${testJob.name}`);
    expect(detailResponse.ok(), `GET /api/jobs/${testJob.name} failed with status ${detailResponse.status()} — job may have been deleted by a parallel test, but stable jobs from the base config should not be deleted`).toBe(true);

    const detailData = await detailResponse.json();
    expect(detailData).toHaveProperty("name");
    expect(detailData).toHaveProperty("recentRuns");
  });
});
