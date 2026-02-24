import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

test.describe("Restore API Integration", () => {
  test("can list restore operations", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/restore`);
    expect(response.ok(), `GET /api/restore failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("operations");
    expect(Array.isArray(data.operations)).toBe(true);
  });

  test("restore initiation with invalid storage returns error", async ({ request }) => {
    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storage: "invalid-storage-12345",
        repo: "invalid-repo",
        snapshotId: "invalid-id",
        method: "path",
      },
    });

    // Should return 400 or 404 for invalid storage
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("restore initiation with missing parameters returns 400", async ({ request }) => {
    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {},
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe("Restore Workflow E2E", () => {
  test.setTimeout(120000); // 2 minute timeout

  test("full backup and restore cycle", async ({ request }) => {
    // 1. Check API health
    const healthResponse = await request.get(`${apiUrl}/health`);
    expect(healthResponse.ok(), "API health check failed").toBe(true);

    // 2. Get jobs with history
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok(), "Failed to get jobs list").toBe(true);

    const jobsData = await jobsResponse.json();
    expect(jobsData.jobs, "Jobs list should exist").toBeDefined();
    expect(jobsData.jobs.length, "At least one job should be configured").toBeGreaterThan(0);

    // Find a job with existing snapshots
    let jobWithSnapshots: { job: any; snapshotId: string } | null = null;
    for (const job of jobsData.jobs) {
      const detailResponse = await request.get(`${apiUrl}/api/jobs/${job.name}`);
      expect(detailResponse.ok()).toBe(true);

      const detail = await detailResponse.json();
      if (detail.recentRuns && detail.recentRuns.length > 0) {
        const successfulRun = detail.recentRuns.find(
          (run: any) => (run.status === "success" || run.status === "completed") && run.snapshotId
        );
        if (successfulRun) {
          jobWithSnapshots = { job, snapshotId: successfulRun.snapshotId };
          break;
        }
      }
    }

    // If no snapshots exist, trigger a backup first and wait for it
    if (!jobWithSnapshots) {
      // Prefer the known stable job over any crud-created stub with a placeholder host.
      const testJob =
        jobsData.jobs.find((j: any) => j.name === "test-local-folder") ||
        jobsData.jobs.find((j: any) => !j.host?.includes(".example.com")) ||
        jobsData.jobs[0];

      // Trigger backup — 409 means a conflict (already running), not a successful start
      const runResponse = await request.post(`${apiUrl}/api/jobs/${testJob.name}/run`, { data: {} });
      expect(runResponse.status(), `Backup trigger returned ${runResponse.status()}, expected 200`).toBe(200);

      // Wait for backup to complete
      const maxWaitMs = 60000;
      const startTime = Date.now();
      let backupStatus = "";
      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const statusResponse = await request.get(`${apiUrl}/api/jobs/${testJob.name}`);
        expect(statusResponse.ok()).toBe(true);
        const statusData = await statusResponse.json();
        if (statusData.lastRun?.status === "completed" && statusData.lastRun?.snapshotId) {
          jobWithSnapshots = { job: testJob, snapshotId: statusData.lastRun.snapshotId };
          backupStatus = "completed";
          break;
        }
        if (statusData.lastRun?.status === "failed") {
          backupStatus = "failed";
          break;
        }
      }

      expect(
        backupStatus,
        `Backup did not complete successfully — final status: "${backupStatus}". A failed backup is a test failure.`
      ).toBe("completed");
    }

    expect(jobWithSnapshots, "A job with a snapshot should exist for restore testing").not.toBeNull();

    // 3. Initiate restore
    const restoreResponse = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storage: jobWithSnapshots!.job.storage,
        repo: jobWithSnapshots!.job.repo || jobWithSnapshots!.job.name,
        snapshotId: jobWithSnapshots!.snapshotId,
        method: "path",
        target: `/tmp/test-restore-${Date.now()}`,
      },
    });
    expect(restoreResponse.ok(), `POST /api/restore failed with status ${restoreResponse.status()}`).toBe(true);

    const restoreData = await restoreResponse.json();
    expect(restoreData).toHaveProperty("id");
    expect(restoreData).toHaveProperty("status");

    // 4. Poll for restore completion
    const restoreId = restoreData.id;
    let finalStatus = "";
    const maxAttempts = 30;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;

      const statusResponse = await request.get(`${apiUrl}/api/restore/${restoreId}`);
      expect(statusResponse.ok(), "Failed to get restore status").toBe(true);

      const statusData = await statusResponse.json();
      finalStatus = statusData.status;

      if (statusData.status === "completed" || statusData.status === "failed") {
        break;
      }
    }

    // "failed" is not an acceptable terminal state — a failed restore IS a test failure
    expect(
      finalStatus,
      `Restore operation ended with status "${finalStatus}" — only "completed" is acceptable`
    ).toBe("completed");
  });

  test("can get restore operation status", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/restore`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("operations");

    // If there are operations, verify their structure
    for (const op of data.operations) {
      expect(op).toHaveProperty("id");
      expect(op).toHaveProperty("status");
      expect(["pending", "running", "completed", "failed"]).toContain(op.status);
    }
  });
});

test.describe("Database Backup and Restore E2E", () => {
  test.setTimeout(180000); // 3 minute timeout for database operations

  test("PostgreSQL backup creates valid snapshot", async ({ request }) => {
    // Get jobs and find a postgres job
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok(), "Failed to get jobs list").toBe(true);

    const jobsData = await jobsResponse.json();
    // Prefer the known good test job over any crud-test-created stub with a placeholder host.
    const pgJob =
      jobsData.jobs?.find((j: any) => j.name === "test-postgres") ||
      jobsData.jobs?.find((j: any) => j.type === "postgres" && !j.host?.includes(".example.com"));

    if (!pgJob) {
      test.skip(true, "No PostgreSQL job configured — skipping PostgreSQL backup test");
      return;
    }

    // Run the backup — 409 means conflict/already running, not a successful trigger
    const runResponse = await request.post(`${apiUrl}/api/jobs/${pgJob.name}/run`, {
      data: {},
    });
    expect(runResponse.status(), `Backup trigger returned ${runResponse.status()}, expected 200`).toBe(200);

    const runData = await runResponse.json();
    expect(["started", "already_running", "queued"]).toContain(runData.status);

    // Wait for completion
    let finalStatus = "";
    let snapshotId = "";
    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;

      const statusResponse = await request.get(`${apiUrl}/api/jobs/${pgJob.name}`);
      expect(statusResponse.ok()).toBe(true);

      const statusData = await statusResponse.json();

      if (!statusData.isRunning && statusData.recentRuns && statusData.recentRuns.length > 0) {
        const lastRun = statusData.recentRuns[0];
        finalStatus = lastRun.status;
        snapshotId = lastRun.snapshotId || "";

        if (finalStatus === "completed" || finalStatus === "success" || finalStatus === "failed") {
          break;
        }
      }
    }

    // "failed" is not an acceptable terminal state for a backup operation
    expect(
      ["completed", "success"],
      `PostgreSQL backup ended with status "${finalStatus}" — only "completed" or "success" are acceptable`
    ).toContain(finalStatus);
    expect(snapshotId, "Successful backup should have a snapshot ID").toBeTruthy();
  });

  test("MariaDB backup creates valid snapshot", async ({ request }) => {
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);

    const jobsData = await jobsResponse.json();
    // Prefer the known good test job; fall back to any mariadb-type job as a last resort.
    // crud tests may have created stub mariadb jobs with placeholder hostnames that would fail.
    const mariaJob =
      jobsData.jobs?.find((j: any) => j.name === "test-mariadb") ||
      jobsData.jobs?.find((j: any) => j.type === "mariadb" && !j.host?.includes(".example.com"));

    if (!mariaJob) {
      test.skip(true, "No MariaDB job configured — skipping MariaDB backup test");
      return;
    }

    // 409 means conflict/already running, not a successful trigger
    const runResponse = await request.post(`${apiUrl}/api/jobs/${mariaJob.name}/run`, {
      data: {},
    });
    expect(runResponse.status(), `Backup trigger returned ${runResponse.status()}, expected 200`).toBe(200);

    // Wait for completion
    let finalStatus = "";
    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;

      const statusResponse = await request.get(`${apiUrl}/api/jobs/${mariaJob.name}`);
      expect(statusResponse.ok()).toBe(true);

      const statusData = await statusResponse.json();
      if (!statusData.isRunning && statusData.lastRun) {
        finalStatus = statusData.lastRun.status;
        break;
      }
    }

    // "failed" is not an acceptable terminal state for a backup operation
    expect(
      ["completed", "success"],
      `MariaDB backup ended with status "${finalStatus}" — only "completed" or "success" are acceptable`
    ).toContain(finalStatus);
  });

  test("Redis backup creates valid snapshot", async ({ request }) => {
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);

    const jobsData = await jobsResponse.json();
    // Prefer the known good test job; fall back to any redis-type job that isn't a crud stub.
    const redisJob =
      jobsData.jobs?.find((j: any) => j.name === "test-redis") ||
      jobsData.jobs?.find((j: any) => j.type === "redis" && !j.host?.includes(".example.com"));

    if (!redisJob) {
      test.skip(true, "No Redis job configured — skipping Redis backup test");
      return;
    }

    // 409 means conflict/already running, not a successful trigger
    const runResponse = await request.post(`${apiUrl}/api/jobs/${redisJob.name}/run`, {
      data: {},
    });
    expect(runResponse.status(), `Backup trigger returned ${runResponse.status()}, expected 200`).toBe(200);

    // Wait for completion
    let finalStatus = "";
    const maxAttempts = 30;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;

      const statusResponse = await request.get(`${apiUrl}/api/jobs/${redisJob.name}`);
      expect(statusResponse.ok()).toBe(true);

      const statusData = await statusResponse.json();
      if (!statusData.isRunning && statusData.lastRun) {
        finalStatus = statusData.lastRun.status;
        break;
      }
    }

    // "failed" is not an acceptable terminal state for a backup operation
    expect(
      ["completed", "success"],
      `Redis backup ended with status "${finalStatus}" — only "completed" or "success" are acceptable`
    ).toContain(finalStatus);
  });
});
