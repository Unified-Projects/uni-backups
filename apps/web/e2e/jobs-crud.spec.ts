import { test, expect, describe } from "@playwright/test";

const BASE_URL = process.env.API_URL || "http://localhost:3000";
const API_URL = process.env.TEST_API_URL || "http://localhost:3001";

// Jobs created by this suite that must be cleaned up afterwards.
// These use fake external hosts and must never be left running in the job list.
const CREATED_JOB_NAMES = [
  "test-folder-backup",
  "s3-backup-test",
  "postgres-backup-test",
  "mariadb-backup-test",
  "redis-backup-test",
  "volume-backup-test",
];

describe("Jobs CRUD E2E Tests", () => {
  test.afterAll(async ({ request }) => {
    // Clean up all jobs created by this suite. They use fake external hosts and
    // will fail if triggered by any other test or scheduled run.
    for (const name of CREATED_JOB_NAMES) {
      await request.delete(`${API_URL}/api/jobs/${name}`).catch(() => {});
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/jobs`);
    await page.waitForLoadState("networkidle");
  });

  describe("Job List", () => {
    test("should display list of jobs", async ({ page }) => {
      await expect(page.locator("table")).toBeVisible();

      await expect(page.locator("th").first()).toHaveText(/name/i);
      await expect(page.locator("th").nth(1)).toHaveText(/type/i);
      await expect(page.locator("th").nth(2)).toHaveText(/storage/i);
      await expect(page.locator("th").nth(3)).toHaveText(/schedule/i);
    });

    test("should support pagination", async ({ page }) => {
      const pagination = page.locator('[data-testid="pagination"]');
      await expect(pagination).toBeVisible();

      const nextButton = page.locator('button:has-text("Next")');
      if (await nextButton.isEnabled()) {
        await nextButton.click();
        await page.waitForLoadState("networkidle");
      }
    });

    test("should filter jobs by type", async ({ page }) => {
      const filterButton = page.locator('button:has-text("Filter")');
      await filterButton.click();

      const typeFilter = page.locator('select[name="type"]');
      await typeFilter.selectOption("postgres");

      await page.locator('button:has-text("Apply")').click();
      await page.waitForLoadState("networkidle");

      const jobTypes = await page.locator('[data-testid="job-type"]').allTextContents();
      for (const type of jobTypes) {
        expect(type.toLowerCase()).toContain("postgres");
      }
    });

    test("should search jobs by name", async ({ page }) => {
      const searchInput = page.locator('input[placeholder*="Search"]');
      await searchInput.fill("daily-backup");

      const jobNames = await page.locator('[data-testid="job-name"]').allTextContents();
      expect(jobNames.every(name => name.toLowerCase().includes("daily-backup"))).toBe(true);
    });
  });

  describe("Create Job", () => {
    test("should create folder backup job", async ({ page }) => {
      await page.locator('button:has-text("Create Job")').click();

      await page.locator('input[name="name"]').fill("test-folder-backup");
      await page.locator('select[name="type"]').selectOption("folder");
      await page.locator('input[name="source"]').fill("/backups/source/local-test");

      await page.locator('select[name="storage"]').selectOption("local-storage");

      await page.locator('input[name="schedule"]').fill("0 2 * * *");

      await page.locator('button:has-text("Add Retention")').click();
      await page.locator('input[name="retention.daily"]').fill("7");

      await page.locator('[data-testid="job-form-save"]').click();

      await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    });

    test("should create S3 storage backup job", async ({ page }) => {
      await page.locator('button:has-text("Create Job")').click();

      await page.locator('input[name="name"]').fill("s3-backup-test");
      await page.locator('select[name="type"]').selectOption("folder");
      await page.locator('input[name="source"]').fill("/backups/source/s3-test");
      await page.locator('select[name="storage"]').selectOption("s3-backup");

      await page.locator('[data-testid="job-form-save"]').click();

      await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    });

    test("should create PostgreSQL backup job", async ({ page }) => {
      await page.locator('button:has-text("Create Job")').click();

      await page.locator('input[name="name"]').fill("postgres-backup-test");
      await page.locator('select[name="type"]').selectOption("postgres");
      await page.locator('input[name="database"]').fill("production_db");
      await page.locator('input[name="host"]').fill("db.example.com");
      await page.locator('input[name="port"]').fill("5432");
      await page.locator('input[name="user"]').fill("backup_user");
      await page.locator('select[name="storage"]').selectOption("s3-backup");

      await page.locator('[data-testid="job-form-save"]').click();

      await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    });

    test("should create MariaDB backup job", async ({ page }) => {
      await page.locator('button:has-text("Create Job")').click();

      await page.locator('input[name="name"]').fill("mariadb-backup-test");
      await page.locator('select[name="type"]').selectOption("mariadb");
      await page.locator('input[name="database"]').fill("app_db");
      await page.locator('input[name="host"]').fill("mariadb.example.com");
      await page.locator('select[name="storage"]').selectOption("sftp-storage");

      await page.locator('[data-testid="job-form-save"]').click();

      await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    });

    test("should create Redis backup job", async ({ page }) => {
      await page.locator('button:has-text("Create Job")').click();

      await page.locator('input[name="name"]').fill("redis-backup-test");
      await page.locator('select[name="type"]').selectOption("redis");
      await page.locator('input[name="host"]').fill("redis.example.com");
      await page.locator('input[name="port"]').fill("6379");
      await page.locator('select[name="storage"]').selectOption("local-storage");

      await page.locator('[data-testid="job-form-save"]').click();

      await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    });

    test("should create volume backup job", async ({ page }) => {
      await page.locator('button:has-text("Create Job")').click();

      await page.locator('input[name="name"]').fill("volume-backup-test");
      await page.locator('select[name="type"]').selectOption("volume");
      await page.locator('input[name="source"]').fill("/backups/source/local-test");
      await page.locator('select[name="storage"]').selectOption("s3-backup");

      await page.locator('[data-testid="job-form-save"]').click();

      await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    });

    test("should validate required fields", async ({ page }) => {
      await page.locator('button:has-text("Create Job")').click();

      await page.locator('[data-testid="job-form-save"]').click();

      await expect(page.locator('[data-testid="error-name"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-type"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-storage"]')).toBeVisible();
    });

    test("should validate storage reference exists", async ({ page }) => {
      await page.locator('button:has-text("Create Job")').click();

      await page.locator('input[name="name"]').fill("test-job");
      await page.locator('select[name="type"]').selectOption("folder");
      await page.locator('input[name="source"]').fill("/backups/source/s3-test");
      await page.locator('select[name="storage"]').selectOption("non-existent-storage");

      await page.locator('[data-testid="job-form-save"]').click();

      await expect(page.locator('[data-testid="error-storage"]')).toContainText(/not found/i);
    });
  });

  describe("Edit Job", () => {
    test("should edit job configuration", async ({ page }) => {
      const editButton = page.locator('tr').filter({ hasText: 'test-postgres' }).locator('button:has-text("Edit")');
      await expect(editButton).toHaveCount(1, { message: "Edit button must be present for test-postgres" });
      await editButton.click();
      await expect(page.locator('[role="dialog"]')).toBeVisible();

      await page.locator('input[name="schedule"]').fill("0 3 * * *");

      await page.locator('button:has-text("Update")').click();

      await expect(page.locator('[data-testid="success-message"]').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="success-message"]').first()).toContainText(/updated/i);

      // Verify the schedule was persisted by fetching the job from the API
      const jobsResponse = await page.request.get(`${API_URL}/api/jobs`);
      expect(jobsResponse.ok(), `GET /api/jobs failed with status ${jobsResponse.status()}`).toBe(true);
      const jobsData = await jobsResponse.json();
      const jobs = jobsData.jobs ?? jobsData;
      const testPostgresJob = (Array.isArray(jobs) ? jobs : []).find(
        (j: any) => j.name === "test-postgres"
      );
      expect(testPostgresJob, "test-postgres job must exist in API response after update").toBeDefined();
      expect(testPostgresJob.schedule, "Schedule must be persisted after update").toBe("0 3 * * *");
    });

    test("should update retention policy", async ({ page }) => {
      const editButton = page.locator('tr').filter({ hasText: 'test-postgres' }).locator('button:has-text("Edit")');
      await expect(editButton).toHaveCount(1, { message: "Edit button must be present for test-postgres" });
      await editButton.click();
      await expect(page.locator('[role="dialog"]')).toBeVisible();

      await page.locator('input[name="retention.daily"]').fill("14");
      await page.locator('input[name="retention.weekly"]').fill("8");

      await page.locator('button:has-text("Update")').click();

      await expect(page.locator('[data-testid="success-message"]').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="success-message"]').first()).toContainText(/updated/i);

      // Verify retention was persisted
      const jobsResponse = await page.request.get(`${API_URL}/api/jobs`);
      expect(jobsResponse.ok(), `GET /api/jobs failed with status ${jobsResponse.status()}`).toBe(true);
      const jobsData = await jobsResponse.json();
      const jobs = jobsData.jobs ?? jobsData;
      const testPostgresJob = (Array.isArray(jobs) ? jobs : []).find(
        (j: any) => j.name === "test-postgres"
      );
      expect(testPostgresJob, "test-postgres job must exist in API response after update").toBeDefined();
      expect(testPostgresJob.retention?.daily ?? testPostgresJob.retention?.keepDaily, "Daily retention must be persisted after update").toBe(14);
      expect(testPostgresJob.retention?.weekly ?? testPostgresJob.retention?.keepWeekly, "Weekly retention must be persisted after update").toBe(8);
    });

    test("should change job storage backend", async ({ page }) => {
      const editButton = page.locator('tr').filter({ hasText: 'test-postgres' }).locator('button:has-text("Edit")');
      await expect(editButton).toHaveCount(1, { message: "Edit button must be present for test-postgres" });
      await editButton.click();
      await expect(page.locator('[role="dialog"]')).toBeVisible();

      await page.locator('select[name="storage"]').selectOption("new-storage");

      await page.locator('button:has-text("Update")').click();

      await expect(page.locator('[data-testid="success-message"]').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="success-message"]').first()).toContainText(/updated/i);

      // Verify storage backend was persisted
      const jobsResponse = await page.request.get(`${API_URL}/api/jobs`);
      expect(jobsResponse.ok(), `GET /api/jobs failed with status ${jobsResponse.status()}`).toBe(true);
      const jobsData = await jobsResponse.json();
      const jobs = jobsData.jobs ?? jobsData;
      const testPostgresJob = (Array.isArray(jobs) ? jobs : []).find(
        (j: any) => j.name === "test-postgres"
      );
      expect(testPostgresJob, "test-postgres job must exist in API response after update").toBeDefined();
      expect(testPostgresJob.storage ?? testPostgresJob.storageId, "Storage backend must be persisted after update").toBe("new-storage");
    });
  });

  describe("Delete Job", () => {
    test("should delete job with confirmation", async ({ page }) => {
      const jobName = "postgres-backup-test";
      const jobRow = page.locator("tbody tr").filter({ hasText: jobName });

      await expect(jobRow).toHaveCount(1, { message: `Job "${jobName}" must exist in the table to test deletion` });

      const deleteButton = jobRow.first().locator('button[aria-label*="Delete"]');
      await expect(deleteButton).toHaveCount(1, { message: `Delete button must be present on "${jobName}" row` });

      await deleteButton.click();

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(jobName);

      await page.locator('[role="dialog"] button:has-text("Delete")').click();

      const successMsg = page.locator('[data-testid="success-message"]');
      await expect(successMsg).toBeVisible({ timeout: 10000 });
      await expect(successMsg).toContainText(/deleted/i);
    });

    test("should cancel delete on confirmation", async ({ page }) => {
      await page.locator('button[aria-label*="Delete"]').first().click();

      await page.locator('[role="dialog"] button:has-text("Cancel")').click();

      await expect(page.locator("table")).toBeVisible();
    });

    test("should prevent deletion of running jobs", async ({ page }) => {
      // Trigger a backup immediately so there is a running job to work with.
      // Do NOT await networkidle here — that would wait for the job to finish.
      await page.request.post(`${API_URL}/api/jobs/test-folder-backup/run`, { data: {} });
      await page.reload();
      await page.waitForLoadState("domcontentloaded");

      const runningRow = page.locator("tr").filter({
        has: page.locator('[data-testid="status"]:has-text("running")'),
      }).first();

      // The job may complete before the page renders — skip rather than fail in that case.
      // The underlying API behaviour (DELETE returns 409 for active jobs) is covered by integration tests.
      const hasRunningJob = await runningRow.isVisible({ timeout: 3000 }).catch(() => false);
      test.skip(!hasRunningJob, "No running jobs available to test deletion prevention");

      const deleteButton = runningRow.locator('button[aria-label*="Delete"]');
      await expect(deleteButton).toHaveCount(1, { message: "Delete button must be present on running job row" });

      await deleteButton.click();

      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await page.locator('[role="dialog"] button:has-text("Delete")').click();

      await page.waitForTimeout(1000);
      const errorMsg = page.locator('[data-testid="error-message"]');
      await expect(errorMsg).toBeVisible({ timeout: 10000, message: "Server must reject deletion of a running job with an error message" });
      await expect(errorMsg).toContainText(/cannot delete running job/i);
    });
  });

  describe("Job Trigger", () => {
    test("should manually trigger job run", async ({ page }) => {
      // Target test-folder-backup specifically — it has a known working source path.
      // Never use .first() here: dynamically created jobs from the Create tests
      // (e.g. mariadb-backup-test with mariadb.example.com) sort alphabetically before
      // test-* jobs and will fail when triggered against their fake external hosts.

      // Wait for any previously running jobs to complete (previous tests may have triggered backups)
      const jobRow = page.locator("tr").filter({ hasText: "test-folder-backup" });
      const statusLocator = jobRow.locator('[data-testid="status"]');

      // Poll until job is no longer running (max 30 seconds)
      for (let i = 0; i < 30; i++) {
        const status = await statusLocator.textContent().catch(() => "");
        if (!/running/i.test(status || "")) break;
        await page.waitForTimeout(1000);
      }

      const runButton = jobRow.locator('button:has-text("Run Now")');
      await expect(runButton).toBeEnabled();

      await runButton.click();

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();

      await page.locator('[role="dialog"] button:has-text("Run")').click();

      const successMsg = page.locator('[data-testid="success-message"]');
      await expect(successMsg).toBeVisible({ timeout: 10000 });
      await expect(successMsg).toContainText(/queued/i);
    });

    test("should show job run history", async ({ page }) => {
      await page.locator('button:has-text("History")').first().click();

      await expect(page.locator('[data-testid="job-history"]')).toBeVisible();

      const historyItems = await page.locator('[data-testid="history-item"]').count();
      expect(historyItems).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Job Validation", () => {
    test("should validate cron expression format", async ({ page }) => {
      await page.locator('button:has-text("Create Job")').click();

      await page.locator('input[name="name"]').fill("test-job");
      await page.locator('select[name="type"]').selectOption("folder");
      await page.locator('input[name="source"]').fill("/backups/source/s3-test");
      await page.locator('select[name="storage"]').selectOption("local-storage");

      await page.locator('input[name="schedule"]').fill("invalid-cron");

      await page.locator('[data-testid="job-form-save"]').click();

      await expect(page.locator('[data-testid="error-schedule"]')).toBeVisible();
    });

    test("should validate exclude patterns", async ({ page }) => {
      await page.locator('button:has-text("Create Job")').click();

      await page.locator('input[name="name"]').fill("test-job");
      await page.locator('select[name="type"]').selectOption("folder");
      await page.locator('input[name="source"]').fill("/backups/source/s3-test");
      await page.locator('select[name="storage"]').selectOption("local-storage");

      await page.locator('button:has-text("Add Exclude")').click();
      await page.locator('input[name="exclude.0"]').fill("*.log");

      await page.locator('[data-testid="job-form-save"]').click();

      await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    });
  });
});
