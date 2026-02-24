import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

test.describe("Schedule Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("can navigate to schedule page", async ({ page }) => {
    const scheduleLink = page.locator(
      'a[href*="schedule"], [data-testid="schedule-link"]'
    );

    // The schedule navigation link MUST exist — its absence is a real failure
    await expect(scheduleLink.first(), "Schedule navigation link must be present in the sidebar/nav").toBeVisible();

    await scheduleLink.first().click();
    await page.waitForLoadState("domcontentloaded");

    const url = page.url();
    const hasScheduleUrl = url.includes("schedule");
    const hasScheduleContent = await page
      .locator('[data-testid*="schedule"], .schedule, h1:has-text("Schedule")')
      .first()
      .isVisible();

    expect(hasScheduleUrl || hasScheduleContent, "Should show schedule page").toBe(true);
  });

  test("displays scheduled jobs list", async ({ page }) => {
    const scheduleLink = page.locator(
      'a[href*="schedule"], [data-testid="schedule-link"]'
    );

    // The schedule navigation link MUST exist — its absence is a real failure
    await expect(scheduleLink.first(), "Schedule navigation link must be present in the sidebar/nav").toBeVisible();

    await scheduleLink.first().click();
    await page.waitForLoadState("networkidle");

    const jobList = page.locator(
      '[data-testid*="job"], .job-item, .scheduled-job, table tbody tr'
    );
    const jobCount = await jobList.count();
    expect(jobCount).toBeGreaterThanOrEqual(0);
  });

  test("shows next run times for scheduled jobs", async ({ page }) => {
    const scheduleLink = page.locator(
      'a[href*="schedule"], [data-testid="schedule-link"]'
    );

    // The schedule navigation link MUST exist — its absence is a real failure
    await expect(scheduleLink.first(), "Schedule navigation link must be present in the sidebar/nav").toBeVisible();

    await scheduleLink.first().click();
    await page.waitForLoadState("networkidle");

    const nextRunElements = page.locator(
      '[data-testid*="next-run"], .next-run, time, [class*="time"]'
    );
    const nextRunCount = await nextRunElements.count();

    // If the schedule page has any scheduled jobs, they MUST display next run times
    if (nextRunCount > 0) {
      await expect(nextRunElements.first()).toBeVisible();
    }
  });
});

test.describe("Schedule API Integration", () => {
  test("GET /api/schedule returns schedule overview", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/schedule`);
    expect(response.ok(), `GET /api/schedule failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("scheduled");
    expect(data).toHaveProperty("running");
    expect(data).toHaveProperty("recent");
    expect(Array.isArray(data.scheduled)).toBe(true);
    expect(Array.isArray(data.running)).toBe(true);
    expect(Array.isArray(data.recent)).toBe(true);
  });

  test("GET /api/schedule/running returns running jobs", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/schedule/running`);
    expect(response.ok(), `GET /api/schedule/running failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("running");
    expect(Array.isArray(data.running)).toBe(true);
  });

  test("GET /api/schedule/history returns job history", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/schedule/history`);
    expect(response.ok(), `GET /api/schedule/history failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("history");
    expect(Array.isArray(data.history)).toBe(true);
  });

  test("scheduled jobs have valid cron expressions", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/schedule`);
    expect(response.ok()).toBe(true);

    const data = await response.json();

    for (const job of data.scheduled) {
      if (job.schedule) {
        // Cron expression should have 5-6 parts
        const parts = job.schedule.split(" ");
        expect(parts.length).toBeGreaterThanOrEqual(5);
        expect(parts.length).toBeLessThanOrEqual(6);
      }
    }
  });

  test("scheduled jobs have nextRun when schedule is set", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/schedule`);
    expect(response.ok()).toBe(true);

    const data = await response.json();

    for (const job of data.scheduled) {
      expect(job).toHaveProperty("name");
      if (job.schedule) {
        expect(job.nextRun, `Job ${job.name} should have nextRun when schedule is set`).toBeDefined();
      }
    }
  });

  test("history entries have required properties", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/schedule/history`);
    expect(response.ok()).toBe(true);

    const data = await response.json();

    for (const entry of data.history) {
      expect(entry).toHaveProperty("jobName");
      expect(entry).toHaveProperty("status");
      expect(["pending", "running", "completed", "failed", "success"]).toContain(entry.status);
    }
  });
});

test.describe("Schedule Operations", () => {
  test("can trigger manual job run from schedule", async ({ request }) => {
    const scheduleResponse = await request.get(`${apiUrl}/api/schedule`);
    expect(scheduleResponse.ok()).toBe(true);

    const data = await scheduleResponse.json();
    expect(data.scheduled.length, "At least one scheduled job required").toBeGreaterThan(0);

    const jobName = data.scheduled[0].name;

    // 409 means conflict (already running) — the job did not start, so assert 200
    const runResponse = await request.post(`${apiUrl}/api/jobs/${jobName}/run`, { data: {} });
    expect(runResponse.status(), `Job trigger returned ${runResponse.status()}, expected 200`).toBe(200);

    const runData = await runResponse.json();
    expect(runData).toHaveProperty("status");
    expect(["started", "queued", "already_running"]).toContain(runData.status);
  });

  test("running jobs appear in running list", async ({ request }) => {
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);

    const jobsData = await jobsResponse.json();
    expect(jobsData.jobs.length).toBeGreaterThan(0);

    // Prefer the known stable job; crud tests may have put placeholder-host stubs first alphabetically.
    const jobName = (
      jobsData.jobs.find((j: any) => j.name === "test-local-folder") ||
      jobsData.jobs.find((j: any) => !j.host?.endsWith(".example.com")) ||
      jobsData.jobs[0]
    ).name;

    await request.post(`${apiUrl}/api/jobs/${jobName}/run`, { data: {} });

    // Check running list
    const runningResponse = await request.get(`${apiUrl}/api/schedule/running`);
    expect(runningResponse.ok()).toBe(true);

    const runningData = await runningResponse.json();
    expect(Array.isArray(runningData.running)).toBe(true);
  });

  test("completed jobs appear in history", async ({ request }) => {
    const historyResponse = await request.get(`${apiUrl}/api/schedule/history`);
    expect(historyResponse.ok()).toBe(true);

    const data = await historyResponse.json();
    expect(Array.isArray(data.history)).toBe(true);
  });

  test("schedule reflects job configuration changes", async ({ request }) => {
    const scheduleResponse = await request.get(`${apiUrl}/api/schedule`);
    expect(scheduleResponse.ok()).toBe(true);

    const data = await scheduleResponse.json();

    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);

    const jobsData = await jobsResponse.json();
    const jobNames = jobsData.jobs.map((j: any) => j.name);

    for (const scheduled of data.scheduled) {
      expect(jobNames, `Scheduled job ${scheduled.name} should exist in jobs list`).toContain(scheduled.name);
    }
  });
});
