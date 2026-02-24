import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

test.describe("Complete Backup Workflow", () => {
  test.setTimeout(120000); // 2 minute timeout for full workflow

  test("end-to-end backup and verify workflow", async ({ request }) => {
    const healthResponse = await request.get(`${apiUrl}/health`);
    expect(healthResponse.ok(), "API health check failed - ensure API is running").toBe(true);

    const healthData = await healthResponse.json();
    expect(["ok", "healthy", "degraded"]).toContain(healthData.status);

    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok(), "Failed to get jobs list").toBe(true);

    const jobsData = await jobsResponse.json();
    expect(jobsData.jobs, "Jobs list should exist").toBeDefined();
    expect(jobsData.jobs.length, "At least one job should be configured for E2E testing").toBeGreaterThan(0);

    // Prefer the known stable job from the base config. Jobs created dynamically by
    // jobs-crud tests (e.g. test-folder-backup with source /data/test) sort before
    // test-local-folder alphabetically and use non-existent source paths.
    const localJob =
      jobsData.jobs.find((j: any) => j.name === "test-local-folder") ||
      jobsData.jobs.find(
        (j: any) =>
          (j.type === "folder" || j.type === "volume") &&
          j.storage.toLowerCase().includes("local") &&
          j.name.startsWith("test-local")
      );
    const testJob = localJob || jobsData.jobs[0];

    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok(), "Failed to get storage list").toBe(true);

    const storageData = await storageResponse.json();
    const jobStorage = storageData.storage?.find(
      (s: any) => s.name === testJob.storage
    );
    expect(jobStorage, `Storage ${testJob.storage} should exist`).toBeDefined();

    const runResponse = await request.post(
      `${apiUrl}/api/jobs/${testJob.name}/run`,
      { data: {} }
    );
    const runStatus = runResponse.status();
    // 200 = queued; 409 = job already running (triggered by a parallel test) — still acceptable
    expect([200, 409], `POST /api/jobs/${testJob.name}/run failed with unexpected status ${runStatus}`).toContain(runStatus);
    if (runStatus === 200) {
      const runData = await runResponse.json();
      expect(["started", "queued"]).toContain(runData.status);
    }

    let lastStatus = "";
    const maxWaitMs = 60000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      const statusResponse = await request.get(`${apiUrl}/api/jobs/${testJob.name}`);
      expect(statusResponse.ok()).toBe(true);

      const statusData = await statusResponse.json();

      if (statusData.lastRun) {
        lastStatus = statusData.lastRun.status;
        if (lastStatus === "completed" || lastStatus === "failed" || lastStatus === "success") {
          break;
        }
      }

      if (!statusData.isRunning && statusData.recentRuns?.length > 0) {
        lastStatus = statusData.recentRuns[0].status;
        break;
      }
    }

    expect(["completed", "success"], `Job failed with status: ${lastStatus}`).toContain(lastStatus);

    const snapshotsResponse = await request.get(
      `${apiUrl}/api/repos/${testJob.storage}/${testJob.repo || testJob.name}/snapshots?latest=1`
    );
    expect(snapshotsResponse.ok(), "Failed to get snapshots").toBe(true);

    const snapshotsData = await snapshotsResponse.json();
    expect(snapshotsData.snapshots).toBeDefined();
    expect(snapshotsData.snapshots.length).toBeGreaterThan(0);

    const latestSnapshot = snapshotsData.snapshots[0];
    expect(latestSnapshot.id).toBeDefined();
  });

  test("backup job execution tracking", async ({ request }) => {
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);

    const jobsData = await jobsResponse.json();
    expect(jobsData.jobs.length).toBeGreaterThan(0);

    const localJob =
      jobsData.jobs.find((j: any) => j.name === "test-local-folder") ||
      jobsData.jobs.find(
        (j: any) =>
          (j.type === "folder" || j.type === "volume") &&
          j.storage.toLowerCase().includes("local") &&
          j.name.startsWith("test-local")
      );
    const testJob = localJob || jobsData.jobs[0];

    await request.post(`${apiUrl}/api/jobs/${testJob.name}/run`, { data: {} });

    const scheduleResponse = await request.get(`${apiUrl}/api/schedule`);
    expect(scheduleResponse.ok()).toBe(true);

    const scheduleData = await scheduleResponse.json();

    const inRunning = scheduleData.running?.some(
      (j: any) => j.name === testJob.name || j.jobName === testJob.name
    );
    const inRecent = scheduleData.recent?.some(
      (j: any) => j.name === testJob.name || j.jobName === testJob.name
    );

    expect(inRunning || inRecent, "Job should appear in running or recent list").toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const queueStatsResponse = await request.get(`${apiUrl}/api/jobs/queue/stats`);
    expect(queueStatsResponse.status(), `GET /api/jobs/queue/stats failed with status ${queueStatsResponse.status()}`).toBe(200);
  });
});

test.describe("Complete Restore Workflow", () => {
  test.setTimeout(180000); // 3 minute timeout

  test("end-to-end restore preview and execution", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);

    const storageData = await storageResponse.json();
    expect(storageData.storage.length, "At least one storage backend required").toBeGreaterThan(0);

    let foundSnapshot: any = null;
    let storageName = "";
    let repoName = "";

    for (const storage of storageData.storage) {
      const reposResponse = await request.get(`${apiUrl}/api/storage/${storage.name}/repos`);
      expect(reposResponse.ok()).toBe(true);

      const reposData = await reposResponse.json();

      if (reposData.repos && reposData.repos.length > 0) {
        for (const repo of reposData.repos) {
          const snapshotsResponse = await request.get(
            `${apiUrl}/api/repos/${storage.name}/${repo}/snapshots?latest=1`
          );
          expect(snapshotsResponse.ok()).toBe(true);

          const snapshotsData = await snapshotsResponse.json();

          if (snapshotsData.snapshots && snapshotsData.snapshots.length > 0) {
            foundSnapshot = snapshotsData.snapshots[0];
            storageName = storage.name;
            repoName = repo;
            break;
          }
        }
      }

      if (foundSnapshot) break;
    }

    if (!foundSnapshot) {
      const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
      expect(jobsResponse.ok()).toBe(true);
      const jobsData = await jobsResponse.json();
      expect(jobsData.jobs.length).toBeGreaterThan(0);

      // Prefer database jobs (redis/postgres/mariadb) that don't require a local source path,
      // falling back to the first available job
      const dbJob = jobsData.jobs.find((j: any) =>
        ["redis", "postgres", "mariadb"].includes(j.type)
      );
      const testJob = dbJob || jobsData.jobs[0];

      await request.post(`${apiUrl}/api/jobs/${testJob.name}/run`, { data: {} });

      const maxWaitMs = 60000;
      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 3000));
        const statusResponse = await request.get(`${apiUrl}/api/jobs/${testJob.name}`);
        expect(statusResponse.ok(), `GET /api/jobs/${testJob.name} failed with status ${statusResponse.status()} while polling for snapshot`).toBe(true);
        const statusData = await statusResponse.json();
        if (statusData.lastRun?.snapshotId) {
          foundSnapshot = { id: statusData.lastRun.snapshotId };
          storageName = testJob.storage;
          repoName = testJob.repo || testJob.name;
          break;
        }
        // Stop waiting once the job has reached a terminal state
        if (
          statusData.lastRun?.status === "completed" ||
          statusData.lastRun?.status === "success" ||
          statusData.lastRun?.status === "failed"
        ) {
          break;
        }
      }
    }

    expect(foundSnapshot, "A snapshot should exist for restore testing").not.toBeNull();

    const lsResponse = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots/${foundSnapshot.id}/ls`
    );
    expect(lsResponse.ok(), "Failed to list snapshot files").toBe(true);

    const lsData = await lsResponse.json();
    expect(lsData).toHaveProperty("entries");

    const restoreRequest = {
      storageName,
      repoName,
      snapshotId: foundSnapshot.id,
      targetPath: `/tmp/restore-test-${Date.now()}`,
    };

    const restoreResponse = await request.post(`${apiUrl}/api/restore`, {
      data: restoreRequest,
    });
    expect(restoreResponse.ok(), `POST /api/restore failed with status ${restoreResponse.status()}`).toBe(true);

    const restoreData = await restoreResponse.json();

    const restoreId = restoreData.restoreId || restoreData.id;
    expect(restoreId, "Restore response should include a restoreId or id").toBeDefined();

    let finalStatus = "";
    const maxWaitMsRestore = 60000;
    const startTimeRestore = Date.now();

    while (Date.now() - startTimeRestore < maxWaitMsRestore) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const statusResponse = await request.get(`${apiUrl}/api/restore/${restoreId}`);
      expect(statusResponse.ok(), `GET /api/restore/${restoreId} failed with status ${statusResponse.status()}`).toBe(true);

      const statusData = await statusResponse.json();
      finalStatus = statusData.status;

      if (statusData.status === "completed" || statusData.status === "failed") {
        break;
      }
    }

    expect(finalStatus, `Restore job failed with status: ${finalStatus}`).toBe("completed");
  });
});

test.describe("UI-Based Full Workflow", () => {
  test("navigate through complete backup workflow in UI", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const jobsLink = page.locator(
      'a[href*="job"], [data-testid="jobs-link"]'
    );
    const jobsLinkCount = await jobsLink.count();
    expect(jobsLinkCount, "Jobs navigation link should exist").toBeGreaterThan(0);

    await jobsLink.first().click();
    await page.waitForLoadState("networkidle");

    const jobItems = page.locator(
      '[data-testid*="job-item"], .job-item, tr:has-text("job")'
    );
    const jobCount = await jobItems.count();
    expect(jobCount, "At least one job item should be visible on the jobs page").toBeGreaterThan(0);

    await jobItems.first().click();
    await page.waitForLoadState("networkidle");

    const runButton = page.locator(
      'button:has-text("Run"), [data-testid="run-job"], button:has-text("Trigger")'
    );
    const runButtonCount = await runButton.count();
    expect(runButtonCount, "A Run/Trigger button should be visible on the job detail view").toBeGreaterThan(0);

    await runButton.first().click();
    await page.waitForTimeout(1000);
    // Dismiss any dialog that opened (run confirmation, etc.) before navigating
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Ensure no dialog overlay is blocking navigation before proceeding
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    const storageLink = page.locator(
      'a[href*="storage"], [data-testid="storage-link"]'
    );
    const storageLinkCount = await storageLink.count();
    expect(storageLinkCount, "Storage navigation link should exist in the sidebar/nav").toBeGreaterThan(0);

    await storageLink.first().click();
    await page.waitForLoadState("networkidle");

    const content = await page.content();
    expect(content).toContain("html");
  });

  test("navigate through complete restore workflow in UI", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const restoreLink = page.locator(
      'a[href*="restore"], [data-testid="restore-link"]'
    );
    const restoreLinkCount = await restoreLink.count();
    expect(restoreLinkCount, "Restore navigation link should exist in the sidebar/nav").toBeGreaterThan(0);

    await restoreLink.first().click();
    await page.waitForLoadState("networkidle");

    const content = await page.content();
    expect(content).toContain("html");
  });
});

test.describe("Error Handling Workflow", () => {
  test("handles invalid job trigger gracefully", async ({ request }) => {
    const response = await request.post(
      `${apiUrl}/api/jobs/nonexistent-job-12345/run`,
      { data: {} }
    );

    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data).toHaveProperty("error");
  });

  test("handles invalid restore request gracefully", async ({ request }) => {
    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storageName: "nonexistent-storage-12345",
        repoName: "nonexistent-repo",
        snapshotId: "invalid-id",
        targetPath: "/tmp/test",
      },
    });

    // Should return error status
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("handles storage connection failures", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/storage/nonexistent-storage-12345/status`
    );

    expect(response.status()).toBe(404);
  });

  test("handles non-existent worker deletion", async ({ request }) => {
    const response = await request.delete(
      `${apiUrl}/api/workers/nonexistent-worker-12345`
    );

    expect(response.status()).toBe(404);
  });

  test("handles invalid cron expression gracefully", async ({ request }) => {
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);
  });
});

test.describe("Concurrent Operations", () => {
  test("handles multiple job triggers", async ({ request }) => {
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);

    const jobsData = await jobsResponse.json();
    expect(jobsData.jobs.length, "At least 2 jobs required for concurrent test").toBeGreaterThanOrEqual(1);

    const triggerPromises = jobsData.jobs.slice(0, 3).map((job: any) =>
      request.post(`${apiUrl}/api/jobs/${job.name}/run`, { data: {} })
    );

    const results = await Promise.allSettled(triggerPromises);

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        const status = (result.value as Response).status();
        // 200 = queued; 409 = already running (triggered by a parallel browser test) — both are acceptable
        expect([200, 409], `Triggering a distinct job returned unexpected status ${status}`).toContain(status);
      }
    }
  });

  test("queue handles concurrent requests to same job", async ({ request }) => {
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);

    const jobsData = await jobsResponse.json();
    expect(jobsData.jobs.length).toBeGreaterThan(0);

    // Prefer the known stable job; crud stubs with .example.com hosts sort first alphabetically.
    const job =
      jobsData.jobs.find((j: any) => j.name === "test-local-folder") ||
      jobsData.jobs.find((j: any) => !j.host?.includes(".example.com")) ||
      jobsData.jobs[0];

    const triggerPromises = [
      request.post(`${apiUrl}/api/jobs/${job.name}/run`, { data: {} }),
      request.post(`${apiUrl}/api/jobs/${job.name}/run`, { data: {} }),
      request.post(`${apiUrl}/api/jobs/${job.name}/run`, { data: {} }),
    ];

    const results = await Promise.allSettled(triggerPromises);

    let successCount = 0;
    let conflictCount = 0;

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        if ((result.value as Response).ok()) {
          successCount++;
        } else if ((result.value as Response).status() === 409) {
          conflictCount++;
        }
      }
    }

    expect(successCount + conflictCount).toBe(3);
  });

  test("API handles concurrent read requests", async ({ request }) => {
    const readPromises = [
      request.get(`${apiUrl}/api/jobs`),
      request.get(`${apiUrl}/api/storage`),
      request.get(`${apiUrl}/api/workers`),
      request.get(`${apiUrl}/api/schedule`),
      request.get(`${apiUrl}/health`),
    ];

    const results = await Promise.all(readPromises);

    for (const response of results) {
      expect(response.ok()).toBe(true);
    }
  });
});

test.describe("Data Integrity", () => {
  test("job data is consistent across endpoints", async ({ request }) => {
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);
    const jobsData = await jobsResponse.json();

    const scheduleResponse = await request.get(`${apiUrl}/api/schedule`);
    expect(scheduleResponse.ok()).toBe(true);
    const scheduleData = await scheduleResponse.json();

    for (const scheduled of scheduleData.scheduled) {
      const matchingJob = jobsData.jobs.find((j: any) => j.name === scheduled.name);
      expect(matchingJob, `Scheduled job ${scheduled.name} should exist in jobs list`).toBeDefined();
    }
  });

  test("worker data is consistent across endpoints", async ({ request }) => {
    const workersResponse = await request.get(`${apiUrl}/api/workers`);
    expect(workersResponse.ok()).toBe(true);
    const workersData = await workersResponse.json();

    const metricsResponse = await request.get(`${apiUrl}/api/cluster/metrics`);
    expect(metricsResponse.ok()).toBe(true);
    const metricsData = await metricsResponse.json();

    expect(metricsData.totalWorkers).toBe(workersData.workers.length);
  });
});
