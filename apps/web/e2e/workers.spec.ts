import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

test.describe("Workers Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("can navigate to workers page", async ({ page }) => {
    const workersLink = page.locator(
      'a[href*="worker"], [data-testid="workers-link"]'
    );

    await expect(workersLink.first()).toBeVisible({ message: "Workers navigation link must be present in the sidebar or navigation" });
    await workersLink.first().click();
    await page.waitForLoadState("domcontentloaded");

    const url = page.url();
    expect(url, "URL must contain 'worker' after navigating to workers page").toContain("worker");

    await expect(
      page.locator('[data-testid*="worker"], .worker, h1:has-text("Worker")').first(),
      "Workers page content must be visible after navigation"
    ).toBeVisible();
  });

  test("displays worker list", async ({ page }) => {
    const workersLink = page.locator(
      'a[href*="worker"], [data-testid="workers-link"]'
    );

    await expect(workersLink.first()).toBeVisible({ message: "Workers navigation link must be present" });
    await workersLink.first().click();
    await page.waitForLoadState("networkidle");

    const workerList = page.locator(
      '[data-testid*="worker-item"], .worker-item, .worker-card'
    );
    const workerCount = await workerList.count();
    expect(workerCount, "At least one worker must be displayed in the workers list").toBeGreaterThan(0);
  });

  test("shows worker health status indicators", async ({ page }) => {
    const workersLink = page.locator(
      'a[href*="worker"], [data-testid="workers-link"]'
    );

    await expect(workersLink.first()).toBeVisible({ message: "Workers navigation link must be present" });
    await workersLink.first().click();
    await page.waitForLoadState("networkidle");

    const statusIndicators = page.locator(
      '[data-testid*="status"], .status-healthy, .status-degraded, .health-indicator, [class*="status"]'
    );
    await expect(statusIndicators.first()).toBeVisible({ message: "Worker health status indicators must be displayed" });
  });
});

test.describe("Workers API Integration", () => {
  test("GET /api/workers returns workers list", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers`);
    expect(response.ok(), `GET /api/workers failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("workers");
    expect(Array.isArray(data.workers)).toBe(true);
  });

  test("workers have required properties", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers`);
    expect(response.ok()).toBe(true);

    const data = await response.json();

    for (const worker of data.workers) {
      expect(worker).toHaveProperty("id");
      expect(worker).toHaveProperty("name");
      expect(worker).toHaveProperty("status");
      expect(worker).toHaveProperty("lastHeartbeat");
      expect(worker).toHaveProperty("groups");
    }
  });

  test("worker status is valid", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers`);
    expect(response.ok()).toBe(true);

    const data = await response.json();

    const validStatuses = ["starting", "healthy", "degraded", "stopping", "offline"];

    for (const worker of data.workers) {
      expect(validStatuses, `Worker ${worker.id} has invalid status: ${worker.status}`).toContain(worker.status);
    }
  });

  test("GET /api/workers/groups returns worker groups", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers/groups`);
    expect(response.ok(), `GET /api/workers/groups failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("groups");
    expect(Array.isArray(data.groups)).toBe(true);
  });

  test("worker groups have required properties", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers/groups`);
    expect(response.ok()).toBe(true);

    const data = await response.json();

    for (const group of data.groups) {
      expect(group).toHaveProperty("groupId");
      expect(group).toHaveProperty("workers");
      expect(group).toHaveProperty("primaryWorkerId");
      expect(group).toHaveProperty("quorumSize");
    }
  });

  test("returns 404 for non-existent worker", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers/nonexistent-worker-12345`);
    expect(response.status()).toBe(404);
  });
});

test.describe("Worker Group Operations", () => {
  test("can identify primary worker in group", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers/groups`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.groups.length, "At least one worker group must exist").toBeGreaterThan(0);

    for (const group of data.groups) {
      expect(group.primaryWorkerId, `Group ${group.groupId} must have a primaryWorkerId set`).toBeTruthy();
      expect(group.workers, `Primary worker ${group.primaryWorkerId} must be in workers list for group ${group.groupId}`).toContain(group.primaryWorkerId);
    }
  });

  test("quorum size is valid for each group", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers/groups`);
    expect(response.ok()).toBe(true);

    const data = await response.json();

    for (const group of data.groups) {
      expect(group.quorumSize).toBeGreaterThanOrEqual(1);
      if (group.workers.length > 0) {
        expect(group.quorumSize).toBeLessThanOrEqual(group.workers.length);
      }
    }
  });

  test("worker belongs to groups array", async ({ request }) => {
    const workersResponse = await request.get(`${apiUrl}/api/workers`);
    expect(workersResponse.ok()).toBe(true);

    const data = await workersResponse.json();

    for (const worker of data.workers) {
      expect(worker.groups).toBeDefined();
      expect(Array.isArray(worker.groups)).toBe(true);
    }
  });
});

test.describe("Worker Health Monitoring", () => {
  test("healthy workers have recent heartbeat", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    const now = Date.now();
    const thresholdMs = 60000; // 1 minute

    for (const worker of data.workers) {
      if (worker.status === "healthy") {
        const heartbeatAge = now - worker.lastHeartbeat;
        expect(heartbeatAge, `Healthy worker ${worker.id} has stale heartbeat`).toBeLessThan(thresholdMs);
      }
    }
  });

  test("offline workers have stale heartbeat", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    const now = Date.now();
    const thresholdMs = 30000; // 30 seconds

    for (const worker of data.workers) {
      if (worker.status === "offline") {
        const heartbeatAge = now - worker.lastHeartbeat;
        expect(heartbeatAge, `Offline worker ${worker.id} should have stale heartbeat`).toBeGreaterThan(thresholdMs);
      }
    }
  });

  test("worker metrics are available when present", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/workers`);
    expect(response.ok()).toBe(true);

    const data = await response.json();

    for (const worker of data.workers) {
      if (worker.metrics) {
        expect(typeof worker.metrics.jobsProcessed).toBe("number");
        expect(typeof worker.metrics.jobsFailed).toBe("number");
      }
    }
  });
});

test.describe("Cluster Status", () => {
  test("GET /api/cluster/status returns cluster health", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/cluster/status`);
    expect(response.ok(), `GET /api/cluster/status failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("status");
    expect(["healthy", "degraded", "unhealthy"]).toContain(data.status);
  });

  test("GET /api/cluster/metrics returns cluster metrics", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/cluster/metrics`);
    expect(response.ok(), `GET /api/cluster/metrics failed with status ${response.status()}`).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("workers");
    expect(data.workers).toHaveProperty("total");
    expect(data.workers).toHaveProperty("healthy");
    expect(data).toHaveProperty("timestamp");
    expect(data).toHaveProperty("queues");
    expect(data).toHaveProperty("jobs");
    expect(typeof data.workers.total).toBe("number");
    expect(typeof data.workers.healthy).toBe("number");
  });

  test("cluster metrics are consistent with workers list", async ({ request }) => {
    const [metricsResponse, workersResponse] = await Promise.all([
      request.get(`${apiUrl}/api/cluster/metrics`),
      request.get(`${apiUrl}/api/workers`),
    ]);

    expect(metricsResponse.ok()).toBe(true);
    expect(workersResponse.ok()).toBe(true);

    const metrics = await metricsResponse.json();
    const workers = await workersResponse.json();

    expect(metrics.workers.total).toBe(workers.workers.length);

    const healthyCount = workers.workers.filter((w: any) => w.status === "healthy").length;
    expect(metrics.workers.byStatus.healthy).toBe(healthyCount);
  });
});

test.describe("Worker Failover", () => {
  test("can trigger manual failover for group", async ({ request }) => {
    const groupsResponse = await request.get(`${apiUrl}/api/workers/groups`);
    expect(groupsResponse.ok()).toBe(true);

    const data = await groupsResponse.json();
    expect(data.groups.length, "At least one worker group must exist to test failover").toBeGreaterThan(0);

    const groupId = data.groups[0].groupId;

    const failoverResponse = await request.post(`${apiUrl}/api/workers/groups/${groupId}/failover`);
    expect(failoverResponse.status(), `POST /api/workers/groups/${groupId}/failover must succeed with 200 — failover must complete successfully`).toBe(200);
  });
});
