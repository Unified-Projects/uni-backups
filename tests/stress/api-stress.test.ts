/**
 * API Stress Tests
 *
 * These tests validate API behavior under high load conditions:
 * - Concurrent request handling
 * - Response time consistency
 * - Error handling under stress
 * - Queue capacity
 *
 * Requirements:
 * - A running API server at TEST_API_URL (default: http://localhost:3001)
 * - Tests will be skipped if the API is not reachable
 */

import { describe, it, expect, beforeAll } from "vitest";

const API_URL = process.env.TEST_API_URL || "http://localhost:3001";

/**
 * Check if the API is reachable
 */
async function checkAPIConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${API_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch (error) {
    console.warn(`API not reachable at ${API_URL}:`, error);
    return false;
  }
}

let hasAPI = false;

describe("API Stress Tests", { timeout: 120000 }, () => {
  beforeAll(async () => {
    hasAPI = await checkAPIConnectivity();
    if (!hasAPI) {
      console.warn(
        `Skipping API stress tests - API not reachable at ${API_URL}`
      );
      console.warn("Start the API server with: npm run dev");
    }
  });

  it(
    "100 concurrent GET /api/jobs",
    { skip: !hasAPI },
    async () => {
      const startTime = Date.now();
      const requests = Array.from({ length: 100 }, () =>
        fetch(`${API_URL}/api/jobs`)
      );

      const responses = await Promise.all(requests);
      const duration = Date.now() - startTime;

      // All requests should return 200
      const statusCodes = responses.map((r) => r.status);
      const allSuccess = statusCodes.every((code) => code === 200);

      expect(allSuccess).toBe(true);
      expect(statusCodes.filter((code) => code === 200).length).toBe(100);

      // All requests should complete under 5 seconds total
      expect(duration).toBeLessThan(5000);

      // Verify responses are valid JSON with expected structure
      const bodies = await Promise.all(responses.map((r) => r.json()));
      bodies.forEach((body) => {
        expect(body).toHaveProperty("jobs");
        expect(body).toHaveProperty("pagination");
        expect(Array.isArray(body.jobs)).toBe(true);
      });

      console.log(`100 concurrent GET /api/jobs completed in ${duration}ms`);
    }
  );

  it(
    "50 concurrent POST job runs",
    { skip: !hasAPI },
    async () => {
      // First, get list of available jobs
      const jobsResponse = await fetch(`${API_URL}/api/jobs`);
      expect(jobsResponse.ok).toBe(true);

      const jobsData = await jobsResponse.json();
      const jobs = jobsData.jobs;

      if (jobs.length === 0) {
        // Fail explicitly: there must be at least one job configured for
        // this stress test to be meaningful. An empty jobs list means the
        // test environment is not set up correctly.
        expect(jobs.length).toBeGreaterThan(0);
        return;
      }

      // Use the first job for testing
      const testJobName = jobs[0].name;

      // Send 50 concurrent POST requests to run the same job
      const requests = Array.from({ length: 50 }, () =>
        fetch(`${API_URL}/api/jobs/${testJobName}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );

      const responses = await Promise.all(requests);

      // Collect status codes
      const statusCodes = responses.map((r) => r.status);
      const status200Count = statusCodes.filter((code) => code === 200).length;
      const status409Count = statusCodes.filter((code) => code === 409).length;
      const status500Count = statusCodes.filter((code) => code === 500).length;

      // Each should return 200 (started) or 409 (already running)
      // No 500 errors should occur
      expect(status500Count).toBe(0);
      expect(status200Count + status409Count).toBe(50);

      // At least one should succeed
      expect(status200Count).toBeGreaterThan(0);

      console.log(
        `50 concurrent POST /api/jobs/${testJobName}/run: ${status200Count} started, ${status409Count} already running, ${status500Count} errors`
      );
    }
  );

  it(
    "100 jobs queued rapidly",
    { skip: !hasAPI },
    async () => {
      // Get list of available jobs
      const jobsResponse = await fetch(`${API_URL}/api/jobs`);
      expect(jobsResponse.ok).toBe(true);

      const jobsData = await jobsResponse.json();
      const jobs = jobsData.jobs;

      if (jobs.length === 0) {
        // Fail explicitly: there must be at least one job configured for
        // this rapid queue test to be meaningful.
        expect(jobs.length).toBeGreaterThan(0);
        return;
      }

      // Use all available jobs, cycling through them
      const jobNames = jobs.map((j: { name: string }) => j.name);

      const results = {
        accepted: 0,
        alreadyRunning: 0,
        errors: 0,
      };

      // Queue 100 jobs sequentially but rapidly
      for (let i = 0; i < 100; i++) {
        const jobName = jobNames[i % jobNames.length];

        try {
          const response = await fetch(`${API_URL}/api/jobs/${jobName}/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });

          if (response.status === 200) {
            results.accepted++;
          } else if (response.status === 409) {
            results.alreadyRunning++;
          } else {
            results.errors++;
          }
        } catch (error) {
          results.errors++;
        }
      }

      // Verify queue accepted the requests
      expect(results.accepted + results.alreadyRunning).toBeGreaterThan(0);
      expect(results.errors).toBe(0);

      console.log(
        `100 jobs queued: ${results.accepted} accepted, ${results.alreadyRunning} already running, ${results.errors} errors`
      );
    }
  );

  it(
    "API responsive after sustained load",
    { skip: !hasAPI },
    async () => {
      const testDuration = 30000; // 30 seconds
      const startTime = Date.now();
      const responseTimes: number[] = [];
      const statusCodes: { [key: number]: number } = {};

      let requestCount = 0;

      // Send requests continuously for 30 seconds
      while (Date.now() - startTime < testDuration) {
        const requestStart = Date.now();

        try {
          const response = await fetch(`${API_URL}/api/jobs`);
          const requestDuration = Date.now() - requestStart;

          responseTimes.push(requestDuration);
          statusCodes[response.status] =
            (statusCodes[response.status] || 0) + 1;

          requestCount++;

          // Parse response to ensure it's valid
          await response.json();
        } catch (error) {
          statusCodes[0] = (statusCodes[0] || 0) + 1;
          console.error("Request failed:", error);
        }

        // Small delay to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 30));
      }

      const totalDuration = Date.now() - startTime;

      // Calculate p99 response time
      const sortedTimes = [...responseTimes].sort((a, b) => a - b);
      const p99Index = Math.floor(0.99 * sortedTimes.length);
      const p99ResponseTime = sortedTimes[p99Index] || 0;

      // Calculate average response time
      const avgResponseTime =
        responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length;

      // Calculate median response time
      const medianIndex = Math.floor(sortedTimes.length / 2);
      const medianResponseTime = sortedTimes[medianIndex] || 0;

      // Assertions
      expect(requestCount).toBeGreaterThan(0);
      expect(requestCount).toBeGreaterThanOrEqual(
        900,
        "Should process at least 900 requests in 30 seconds"
      );
      expect(p99ResponseTime).toBeLessThan(
        2000,
        "p99 response time should be under 2 seconds"
      );
      expect(statusCodes[500] || 0).toBe(
        0,
        "No 500 errors should occur during sustained load"
      );

      console.log(`Sustained load test results (${totalDuration}ms):`);
      console.log(`  Total requests: ${requestCount}`);
      console.log(`  Successful (200): ${statusCodes[200] || 0}`);
      console.log(`  Errors (500): ${statusCodes[500] || 0}`);
      console.log(`  Failed requests: ${statusCodes[0] || 0}`);
      console.log(`  Average response time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`  Median response time: ${medianResponseTime}ms`);
      console.log(`  p99 response time: ${p99ResponseTime}ms`);
      console.log(
        `  Min response time: ${sortedTimes[0] || 0}ms`
      );
      console.log(
        `  Max response time: ${sortedTimes[sortedTimes.length - 1] || 0}ms`
      );
    }
  );
});
