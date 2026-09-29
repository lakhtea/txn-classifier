// Opt-in: hits the real Anthropic API. Run only with `npm run test:live`, never from `npm test`.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Txn } from "../../src/types.js";
import { fakeClient, type FakeClient } from "../support/fakeAnthropic.js";
import { classifyAll, classifyTxn } from "../support/loadClassifier.js";

const MAX_LIVE_API_CALLS = 5;
const LIVE_TEST_TIMEOUT_MS = 30_000;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (apiKey === undefined || apiKey.trim() === "") {
  throw new Error("ANTHROPIC_API_KEY is not set: add it to .env to run the live tests");
}

const countingClients: FakeClient[] = [];

/**
 * A real SDK client whose `messages.create` calls are recorded, so the suite can enforce its budget.
 * Retries are off so every request that reaches the API is one the budget counts.
 */
const countedRealClient = (clientApiKey: string): FakeClient => {
  const realClient = new Anthropic({ apiKey: clientApiKey, maxRetries: 0 });
  const client = fakeClient((params) => realClient.messages.create(params));
  countingClients.push(client);
  return client;
};

let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

afterAll(() => {
  const liveApiCallCount = countingClients.reduce((total, client) => total + client.requests.length, 0);
  expect(liveApiCallCount).toBeLessThanOrEqual(MAX_LIVE_API_CALLS);
});

describe("against the real Anthropic API", () => {
  it(
    "classifies unambiguous golden rows correctly and in input order",
    async () => {
      const txns: Txn[] = [
        { date: "2026-08-03", description: "GITHUB INC", amount: 84 },
        { date: "2026-08-07", description: "GUSTO PAYROLL 0826", amount: 18400 },
        { date: "2026-08-04", description: "UNITED AIR 0012938475", amount: 512.3 },
      ];

      const results = await classifyAll({ txns, client: countedRealClient(apiKey) });

      expect(results).toEqual([
        { ...txns[0], category: "software", fallbackReason: null },
        { ...txns[1], category: "payroll", fallbackReason: null },
        { ...txns[2], category: "travel", fallbackReason: null },
      ]);
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    "falls back to \"other\" with the SDK's authentication error when the key is invalid",
    async () => {
      const txn: Txn = { date: "2026-08-03", description: "GITHUB INC", amount: 84 };

      const result = await classifyTxn({
        txn,
        client: countedRealClient("sk-ant-invalid-key-for-live-test"),
      });

      expect(result).toEqual({
        ...txn,
        category: "other",
        fallbackReason: expect.stringContaining("authentication_error"),
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
