import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { parseCsv } from "../src/parse.js";
import { CATEGORIES, type Txn } from "../src/types.js";
import { answerByDescription, buildMessage, fakeClient, replyWith } from "./support/fakeAnthropic.js";
import { classifyTxn } from "./support/loadClassifier.js";
import { overloadedError, septemberCategories, septemberReplies } from "./support/septemberExport.js";

const githubTxn: Txn = { date: "2026-09-01", description: "GITHUB INC", amount: 84 };

let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("classifyTxn", () => {
  it("returns a valid reply's category and keeps the transaction fields", async () => {
    const client = fakeClient(() => replyWith("software"));

    const result = await classifyTxn({ txn: githubTxn, client });

    expect(result).toEqual({
      date: "2026-09-01",
      description: "GITHUB INC",
      amount: 84,
      category: "software",
      fallbackReason: null,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("sends the transaction and every category name to Claude", async () => {
    const client = fakeClient(() => replyWith("meals"));

    await classifyTxn({
      txn: { date: "2026-09-02", description: "SQ *BROOKLYN ROASTERS", amount: 6.75 },
      client,
    });

    const [request] = client.requests;
    const userMessages = JSON.stringify(request.messages);
    expect(userMessages).toContain("SQ *BROOKLYN ROASTERS");
    expect(userMessages).toContain("2026-09-02");
    expect(userMessages).toContain("6.75");
    expect(JSON.stringify(request.system)).toContain(CATEGORIES.join(", "));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("normalizes whitespace and case", async () => {
    const client = fakeClient(() => replyWith("  Travel\n"));

    const result = await classifyTxn({ txn: githubTxn, client });

    expect(result.category).toBe("travel");
    expect(result.fallbackReason).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each([
    { reply: "Software.", category: "software" },
    { reply: "**meals**", category: "meals" },
  ])("strips punctuation from $reply", async ({ reply, category }) => {
    const client = fakeClient(() => replyWith(reply));

    const result = await classifyTxn({ txn: githubTxn, client });

    expect(result.category).toBe(category);
    expect(result.fallbackReason).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps a deliberate \"other\" from Claude unflagged", async () => {
    const client = fakeClient(() => replyWith("other"));

    const result = await classifyTxn({ txn: githubTxn, client });

    expect(result.category).toBe("other");
    expect(result.fallbackReason).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  describe("falls back to \"other\" with a reason and a warning", () => {
    it("when the label is not a category", async () => {
      const client = fakeClient(() => replyWith("groceries"));

      const result = await classifyTxn({ txn: githubTxn, client });

      expect(result).toEqual({
        ...githubTxn,
        category: "other",
        fallbackReason: expect.stringContaining("groceries"),
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("GITHUB INC"));
    });

    it("when the reply is a sentence around a category", async () => {
      const client = fakeClient(() => replyWith("The category is not software"));

      const result = await classifyTxn({ txn: githubTxn, client });

      expect(result.category).toBe("other");
      expect(result.fallbackReason).toEqual(expect.stringContaining("The category is not software"));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("GITHUB INC"));
    });

    it.each([
      { response: "an empty reply", message: replyWith("") },
      {
        response: "a reply with no text block",
        message: buildMessage([
          { type: "tool_use", id: "toolu_fake_01", name: "record_category", input: {} },
        ]),
      },
      { response: "a reply with no content", message: buildMessage([]) },
    ])("when Claude sends $response", async ({ message }) => {
      const client = fakeClient(() => message);

      const result = await classifyTxn({ txn: githubTxn, client });

      expect(result.category).toBe("other");
      expect(result.fallbackReason).toEqual(expect.stringMatching(/\S/));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("GITHUB INC"));
    });

    it("when the API call fails, resolving instead of rejecting", async () => {
      const client = fakeClient(() => {
        throw overloadedError();
      });

      const result = await classifyTxn({ txn: githubTxn, client });

      expect(result).toEqual({
        ...githubTxn,
        category: "other",
        fallbackReason: expect.stringContaining("overloaded_error"),
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("GITHUB INC"));
    });
  });
});

describe("classifying the September bank export", () => {
  it("classifies every row and flags only the invalid label and the API failure", async () => {
    const answerFromDescription = answerByDescription(septemberReplies());
    const txns = parseCsv(readFileSync("data/transactions.csv", "utf-8"));

    const results = await Promise.all(
      txns.map((txn) => classifyTxn({ txn, client: answerFromDescription })),
    );

    expect(results.map(({ description, category }) => [description, category])).toEqual(
      septemberCategories,
    );
    const flagged = results.filter((result) => result.fallbackReason !== null);
    expect(flagged.map((result) => result.description)).toEqual(["CONED ELECTRIC", "APPLE.COM/BILL"]);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
