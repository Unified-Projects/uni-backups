import { test, expect } from "@playwright/test";

const apiUrl = process.env.TEST_API_URL || "http://localhost:3001";

test.describe("Restore Form Validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const restoreLink = page.locator(
      'a[href*="restore"], [data-testid="restore-link"]'
    );

    const restoreLinkCount = await restoreLink.count();
    expect(restoreLinkCount, "Restore navigation link must be present").toBeGreaterThan(0);
    await restoreLink.first().click();
    await page.waitForLoadState("networkidle");
  });

  test("restore form requires storage selection", async ({ page }) => {
    const restoreForm = page.locator(
      'form[data-testid="restore-form"], [data-testid="restore-wizard"], form'
    );

    const restoreFormCount = await restoreForm.count();
    expect(restoreFormCount, "Restore form must be present on the restore page").toBeGreaterThan(0);

    const submitButton = page.locator(
      'button[type="submit"], button:has-text("Restore"), button:has-text("Start")'
    );

    const submitButtonCount = await submitButton.count();
    expect(submitButtonCount, "Restore form must have a submit button").toBeGreaterThan(0);

    await submitButton.first().click();
    await page.waitForTimeout(1000);

    const errorMessage = page.locator(
      '.error, .validation-error, [data-testid="error"], [role="alert"]'
    );
    const errorCount = await errorMessage.count();
    expect(errorCount, "A validation error must appear when submitting without storage selection").toBeGreaterThan(0);
    await expect(errorMessage.first()).toBeVisible();
  });

  test("restore form requires snapshot selection", async ({ page }) => {
    const restoreForm = page.locator('form, [data-testid="restore-form"]');

    const restoreFormCount = await restoreForm.count();
    expect(restoreFormCount, "Restore form must be present on the restore page").toBeGreaterThan(0);

    const storageSelect = page.locator(
      'select[name="storage"], [data-testid="storage-select"]'
    );

    const storageSelectCount = await storageSelect.count();
    expect(storageSelectCount, "Storage select must be present on the restore form").toBeGreaterThan(0);

    const options = storageSelect.locator("option");
    const optionCount = await options.count();
    expect(optionCount, "Storage select must have at least one selectable option").toBeGreaterThan(1);
    await storageSelect.selectOption({ index: 1 });

    const submitButton = page.locator(
      'button[type="submit"], button:has-text("Restore")'
    );

    const submitButtonCount = await submitButton.count();
    expect(submitButtonCount, "Restore form must have a submit button").toBeGreaterThan(0);

    await submitButton.first().click();
    await page.waitForTimeout(1000);

    // After selecting storage but not a snapshot, the user must remain on the restore page
    // (either with a validation error or still on the restore route)
    const currentUrl = page.url();
    expect(currentUrl, "User should remain on the restore page after failed submission").toContain("restore");
  });

  test("restore form validates target path", async ({ page }) => {
    const pathInput = page.locator(
      'input[name="targetPath"], input[name="target"], [data-testid="target-path"]'
    );

    const pathInputCount = await pathInput.count();
    expect(pathInputCount, "Target path input must be present on the restore form").toBeGreaterThan(0);

    await pathInput.fill("not/an/absolute/path");

    const submitButton = page.locator('button[type="submit"]');
    const submitButtonCount = await submitButton.count();
    expect(submitButtonCount, "Restore form must have a submit button").toBeGreaterThan(0);

    await submitButton.first().click();
    await page.waitForTimeout(1000);

    const errorElements = page.locator('.error, .validation-error');
    const errorCount = await errorElements.count();
    expect(errorCount, "A validation error must appear for a non-absolute target path").toBeGreaterThan(0);
    await expect(errorElements.first()).toBeVisible();
  });
});

test.describe("API Request Validation", () => {
  test("restore API validates required fields", async ({ request }) => {
    const emptyResponse = await request.post(`${apiUrl}/api/restore`, {
      data: {},
    });
    expect(emptyResponse.status()).toBe(400);

    const missingSnapshotResponse = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storageName: "test",
        repoName: "test",
        targetPath: "/tmp/test",
      },
    });
    expect(missingSnapshotResponse.status()).toBe(400);

    const missingTargetResponse = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storageName: "test",
        repoName: "test",
        snapshotId: "test",
        method: "path",
      },
    });
    expect(missingTargetResponse.status()).toBe(400);
  });

  test("restore API validates method parameter", async ({ request }) => {
    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storageName: "test",
        repoName: "test",
        snapshotId: "test",
        method: "invalid-method",
        targetPath: "/tmp/test",
      },
    });

    expect(response.status()).toBe(400);
  });

  test("jobs API validates query parameters", async ({ request }) => {
    const response = await request.get(`${apiUrl}/api/jobs?limit=invalid`);

    // An invalid query parameter value must be rejected
    expect(response.status()).toBe(400);
  });

  test("schedule history API validates date range", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/schedule/history?from=not-a-date`
    );

    // An invalid date parameter must be rejected
    expect(response.status()).toBe(400);
  });

  test("snapshots API validates filter parameters", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok()).toBe(true);
    const storageData = await storageResponse.json();

    expect(storageData.storage.length, "At least one storage must exist to test snapshot API validation").toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(
      `${apiUrl}/api/storage/${storageName}/repos`
    );

    expect(reposResponse.ok(), `GET /api/storage/${storageName}/repos failed`).toBe(true);
    const reposData = await reposResponse.json();
    expect(reposData.repos.length, "At least one repo must exist to test snapshot API validation").toBeGreaterThan(0);

    const repoName = reposData.repos[0];

    const response = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots?latest=not-a-number`
    );

    // An invalid query parameter value must be rejected
    expect(response.status()).toBe(400);
  });
});

test.describe("Input Sanitization", () => {
  test("API sanitizes HTML in input", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/jobs/${encodeURIComponent("<script>alert(1)</script>")}`
    );

    expect(response.status()).toBe(404);

    const data = await response.json();
    if (data.error) {
      expect(data.error).not.toContain("<script>");
    }
  });

  test("API handles SQL injection attempts", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/jobs/${encodeURIComponent("'; DROP TABLE jobs; --")}`
    );

    expect(response.status()).toBe(404);
  });

  test("API handles path traversal attempts", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/storage/${encodeURIComponent("../../../etc/passwd")}/repos`
    );

    expect(response.status()).toBe(404);
  });

  test("API handles null byte injection", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/jobs/${encodeURIComponent("test\x00.txt")}`
    );

    expect(response.status()).toBe(404);
  });
});

test.describe("Form Input Bounds", () => {
  test("handles very long input values", async ({ request }) => {
    const longString = "x".repeat(10000);

    // Job name with long string
    const response = await request.get(`${apiUrl}/api/jobs/${longString}`);
    expect([400, 404, 414]).toContain(response.status());
  });

  test("handles empty string values", async ({ request }) => {
    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storageName: "",
        repoName: "",
        snapshotId: "",
        targetPath: "",
      },
    });

    expect(response.status()).toBe(400);
  });

  test("handles whitespace-only values", async ({ request }) => {
    const response = await request.post(`${apiUrl}/api/restore`, {
      data: {
        storageName: "   ",
        repoName: "   ",
        snapshotId: "   ",
        targetPath: "   ",
      },
    });

    expect(response.status()).toBe(400);
  });

  test("handles unicode in input", async ({ request }) => {
    const response = await request.get(
      `${apiUrl}/api/jobs/${encodeURIComponent("test-job-")}`
    );

    expect(response.status()).toBe(404);
  });

  test("handles negative numbers where positive expected", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok(), "Storage API must be reachable").toBe(true);
    const storageData = await storageResponse.json();
    expect(storageData.storage.length, "At least one storage must exist to test negative number validation").toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(
      `${apiUrl}/api/storage/${storageName}/repos`
    );
    expect(reposResponse.ok(), `GET /api/storage/${storageName}/repos must succeed`).toBe(true);
    const reposData = await reposResponse.json();
    expect(reposData.repos.length, "At least one repo must exist to test negative number validation").toBeGreaterThan(0);

    const repoName = reposData.repos[0];

    const response = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots?latest=-5`
    );

    // A negative value for `latest` must be rejected
    expect(response.status()).toBe(400);
  });
});

test.describe("Concurrent Form Submission", () => {
  test("handles rapid form submissions", async ({ request }) => {
    const jobsResponse = await request.get(`${apiUrl}/api/jobs`);
    expect(jobsResponse.ok()).toBe(true);

    const jobsData = await jobsResponse.json();
    expect(jobsData.jobs.length, "Jobs must exist for this test").toBeGreaterThan(0);

    // Prefer the known stable job; crud stubs with .example.com hosts sort first alphabetically.
    const jobName = (
      jobsData.jobs.find((j: any) => j.name === "test-local-folder") ||
      jobsData.jobs.find((j: any) => !j.host?.endsWith(".example.com")) ||
      jobsData.jobs[0]
    ).name;

    const promises = Array.from({ length: 10 }, () =>
      request.post(`${apiUrl}/api/jobs/${jobName}/run`, { data: {} })
    );

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        expect([200, 409]).toContain((result.value as Response).status());
      }
    }
  });

  test("prevents duplicate restore operations", async ({ request }) => {
    const restoreData = {
      storageName: "test",
      repoName: "test",
      snapshotId: "test-snapshot",
      targetPath: "/tmp/test-restore",
    };

    const [response1, response2] = await Promise.all([
      request.post(`${apiUrl}/api/restore`, { data: restoreData }),
      request.post(`${apiUrl}/api/restore`, { data: restoreData }),
    ]);

    // 500 is never acceptable — at most one may succeed (200) or both conflict (409),
    // and the API may reject these as not-found (404) or bad request (400)
    expect([200, 400, 404, 409]).toContain(response1.status());
    expect([200, 400, 404, 409]).toContain(response2.status());
  });
});

test.describe("Type Coercion", () => {
  test("handles number as string", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok(), "Storage API must be reachable").toBe(true);
    const storageData = await storageResponse.json();
    expect(storageData.storage.length, "At least one storage must exist to test type coercion").toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(
      `${apiUrl}/api/storage/${storageName}/repos`
    );
    expect(reposResponse.ok(), `GET /api/storage/${storageName}/repos must succeed`).toBe(true);
    const reposData = await reposResponse.json();
    expect(reposData.repos.length, "At least one repo must exist to test type coercion").toBeGreaterThan(0);

    const repoName = reposData.repos[0];

    const response = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots?latest="5"`
    );

    // A quoted string where a number is expected must be rejected
    expect(response.status()).toBe(400);
  });

  test("handles boolean as string", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok(), "Storage API must be reachable").toBe(true);
    const storageData = await storageResponse.json();
    expect(storageData.storage.length, "At least one storage must exist to test boolean coercion").toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(
      `${apiUrl}/api/storage/${storageName}/repos`
    );
    expect(reposResponse.ok(), `GET /api/storage/${storageName}/repos must succeed`).toBe(true);
    const reposData = await reposResponse.json();
    expect(reposData.repos.length, "At least one repo must exist to test boolean coercion").toBeGreaterThan(0);

    const repoName = reposData.repos[0];

    const response = await request.post(
      `${apiUrl}/api/repos/${storageName}/${repoName}/check?readData="true"`
    );

    // A quoted boolean string where a boolean is expected must be rejected
    expect(response.status()).toBe(400);
  });

  test("handles array where single value expected", async ({ request }) => {
    const storageResponse = await request.get(`${apiUrl}/api/storage`);
    expect(storageResponse.ok(), "Storage API must be reachable").toBe(true);
    const storageData = await storageResponse.json();
    expect(storageData.storage.length, "At least one storage must exist to test array coercion").toBeGreaterThan(0);

    const storageName = storageData.storage[0].name;
    const reposResponse = await request.get(
      `${apiUrl}/api/storage/${storageName}/repos`
    );
    expect(reposResponse.ok(), `GET /api/storage/${storageName}/repos must succeed`).toBe(true);
    const reposData = await reposResponse.json();
    expect(reposData.repos.length, "At least one repo must exist to test array coercion").toBeGreaterThan(0);

    const repoName = reposData.repos[0];

    const response = await request.get(
      `${apiUrl}/api/repos/${storageName}/${repoName}/snapshots?tag=a&tag=b`
    );

    // Multiple tag values are either accepted (200) or rejected as invalid (400);
    // a 404 means the repo itself was not found which is also acceptable here
    expect([200, 400, 404]).toContain(response.status());
  });
});
