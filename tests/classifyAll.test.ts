import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { parseCsv } from "../src/parse.js";
import type { Txn } from "../src/types.js";
import {
  answerByDescription,
  fakeClient,
  replyWith,
  requestedDescription,
} from "./support/fakeAnthropic.js";
import { classifyAll } from "./support/loadClassifier.js";
import { overloadedError, septemberCategories, septemberReplies } from "./support/septemberExport.js";

const MAX_CONCURRENT_REQUESTS = 5;
// Long enough that every request a correct pool starts is still open when the peak is sampled.
const REQUEST_HOLD_MS = 20;
const REVERSE_DELAY_STEP_MS = 3;

const septemberTxns = (): Txn[] => parseCsv(readFileSync("data/transactions.csv", "utf-8"));

let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("classifyAll", () => {
  it("resolves an empty batch to [] without sending any request", async () => {
    const client = fakeClient(() => replyWith("software"));

    const results = await classifyAll({ txns: [], client });

    expect(results).toEqual([]);
    expect(client.requests).toHaveLength(0);
  });

  it("returns results in input order when later rows are answered first", async () => {
    const txns = septemberTxns().slice(0, 8);
    const descriptions = txns.map((txn) => txn.description);
    const categoryByDescription = Object.fromEntries(septemberCategories);
    const client = fakeClient(async (params) => {
      const description = requestedDescription(params, descriptions);
      const rowsAfter = descriptions.length - descriptions.indexOf(description);
      await sleep(rowsAfter * REVERSE_DELAY_STEP_MS);
      return replyWith(categoryByDescription[description]);
    });

    const results = await classifyAll({ txns, client });

    expect(results).toEqual(
      txns.map((txn) => ({
        ...txn,
        category: categoryByDescription[txn.description],
        fallbackReason: null,
      })),
    );
  });

  it(`keeps exactly ${MAX_CONCURRENT_REQUESTS} requests in flight at the peak`, async () => {
    const txns = septemberTxns().slice(0, 12);
    let inFlightCount = 0;
    let peakInFlightCount = 0;
    const client = fakeClient(async () => {
      inFlightCount += 1;
      peakInFlightCount = Math.max(peakInFlightCount, inFlightCount);
      await sleep(REQUEST_HOLD_MS);
      inFlightCount -= 1;
      return replyWith("software");
    });

    const results = await classifyAll({ txns, client });

    expect(peakInFlightCount).toBe(MAX_CONCURRENT_REQUESTS);
    expect(results).toHaveLength(txns.length);
    const requestedDescriptions = client.requests.map((params) =>
      requestedDescription(
        params,
        txns.map((txn) => txn.description),
      ),
    );
    expect([...requestedDescriptions].sort()).toEqual(txns.map((txn) => txn.description).sort());
  });

  it("resolves when some rows fail, flagging only those rows", async () => {
    const txns: Txn[] = [
      { date: "2026-09-01", description: "GITHUB INC", amount: 84 },
      { date: "2026-09-01", description: "DELTA AIR 0047382910", amount: 412.6 },
      { date: "2026-09-16", description: "CONED ELECTRIC", amount: 220.14 },
      { date: "2026-09-02", description: "WEWORK SEPTEMBER", amount: 1250 },
      { date: "2026-09-17", description: "APPLE.COM/BILL", amount: 2.99 },
      { date: "2026-09-15", description: "MAILCHIMP", amount: 79 },
    ];
    const client = answerByDescription({
      "GITHUB INC": "software",
      "DELTA AIR 0047382910": "travel",
      "CONED ELECTRIC": "utilities",
      "WEWORK SEPTEMBER": "office",
      "APPLE.COM/BILL": overloadedError(),
      MAILCHIMP: "marketing",
    });

    const results = await classifyAll({ txns, client });

    expect(results).toEqual([
      { ...txns[0], category: "software", fallbackReason: null },
      { ...txns[1], category: "travel", fallbackReason: null },
      { ...txns[2], category: "other", fallbackReason: expect.stringContaining("utilities") },
      { ...txns[3], category: "office", fallbackReason: null },
      { ...txns[4], category: "other", fallbackReason: expect.stringContaining("overloaded_error") },
      { ...txns[5], category: "marketing", fallbackReason: null },
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

describe("classifying the September bank export as a batch", () => {
  it("classifies all 15 rows in file order and flags only the invalid label and the API failure", async () => {
    const txns = septemberTxns();
    const client = answerByDescription(septemberReplies());

    const results = await classifyAll({ txns, client });

    expect(results.map(({ description, category }) => [description, category])).toEqual(
      septemberCategories,
    );
    expect(results.map(({ date, description, amount }) => ({ date, description, amount }))).toEqual(
      txns,
    );
    const flagged = results.filter((result) => result.fallbackReason !== null);
    expect(flagged.map((result) => result.description)).toEqual(["CONED ELECTRIC", "APPLE.COM/BILL"]);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
