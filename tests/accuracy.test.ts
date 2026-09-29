import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { CATEGORIES, type Category } from "../src/types.js";
import { answerByDescription, type ScriptedReply } from "./support/fakeAnthropic.js";
import {
  formatAccuracyReport,
  parseGoldenCsv,
  scoreAccuracy,
  type AccuracyScore,
  type GoldenRow,
} from "./support/loadAccuracy.js";
import { classifyAll, type ExpectedClassifiedTxn } from "./support/loadClassifier.js";
import { overloadedError } from "./support/septemberExport.js";

const EASY_GOLDEN_PATH = "data/golden.csv";
const HARD_GOLDEN_PATH = "data/golden-hard.csv";

const parseGoldenFile = async (goldenPath: string): Promise<GoldenRow[]> =>
  parseGoldenCsv({ csv: readFileSync(goldenPath, "utf-8"), goldenPath });

const goldenRow = (
  date: string,
  description: string,
  amount: number,
  expectedCategory: Category,
): GoldenRow => ({ txn: { date, description, amount }, expectedCategory });

/** The rows of `data/golden.csv`, written out so the scoring tests do not depend on the parser. */
const golden: GoldenRow[] = [
  goldenRow("2026-08-03", "GITHUB INC", 84, "software"),
  goldenRow("2026-08-04", "UNITED AIR 0012938475", 512.3, "travel"),
  goldenRow("2026-08-05", "SQ *CAFE GRUMPY", 5.5, "meals"),
  goldenRow("2026-08-06", "WEWORK AUGUST", 1250, "office"),
  goldenRow("2026-08-07", "GUSTO PAYROLL 0826", 18400, "payroll"),
  goldenRow("2026-08-10", "GOOGLE ADS 8811203", 850, "marketing"),
  goldenRow("2026-08-11", "NOTION LABS", 96, "software"),
  goldenRow("2026-08-12", "LYFT RIDE LGA", 41.75, "travel"),
  goldenRow("2026-08-13", "DOORDASH TEAM DINNER", 212.4, "meals"),
  goldenRow("2026-08-14", "USPS POSTAGE", 18.6, "office"),
];

const LYFT_FALLBACK_REASON = "Anthropic API call failed: 529 overloaded_error";

/** Every golden row answered correctly, except a plain wrong answer and an API-failure fallback. */
const resultsWithTwoMisses = (): ExpectedClassifiedTxn[] =>
  golden.map(({ txn, expectedCategory }) => {
    if (txn.description === "SQ *CAFE GRUMPY") {
      return { ...txn, category: "office", fallbackReason: null };
    }
    if (txn.description === "LYFT RIDE LGA") {
      return { ...txn, category: "other", fallbackReason: LYFT_FALLBACK_REASON };
    }
    return { ...txn, category: expectedCategory, fallbackReason: null };
  });

const reportLines = (report: string): string[] => report.trimEnd().split("\n");

let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("parseGoldenCsv", () => {
  it("parses the golden set with each row's expected category", async () => {
    const rows = await parseGoldenFile(EASY_GOLDEN_PATH);

    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({
      txn: { date: "2026-08-03", description: "GITHUB INC", amount: 84 },
      expectedCategory: "software",
    });
    for (const row of rows) {
      expect(CATEGORIES).toContain(row.expectedCategory);
    }
  });

  it("parses the hard golden set exactly as approved, including negative refunds", async () => {
    const rows = await parseGoldenFile(HARD_GOLDEN_PATH);

    expect(rows).toEqual([
      goldenRow("2026-08-17", "AMZN MKTP US PRINTER PAPER", 38.4, "office"),
      goldenRow("2026-08-18", "AMAZON WEB SERVICES", 1210.55, "software"),
      goldenRow("2026-08-19", "UBER EATS PENDING", 34.1, "meals"),
      goldenRow("2026-08-20", "UBER *TRIP HELP.UBER.COM", 27.8, "travel"),
      goldenRow("2026-08-21", "GOOGLE *GSUITE_ACME", 144, "software"),
      goldenRow("2026-08-24", "FACEBK *ADS 7Z2K9", 640, "marketing"),
      goldenRow("2026-08-25", "ADP TX/FI TAX DEBIT", 5230.18, "payroll"),
      goldenRow("2026-08-26", "JUSTWORKS INV 9921", 21400, "payroll"),
      goldenRow("2026-08-27", "GUSTO FEE 0926", 149, "software"),
      goldenRow("2026-08-28", "AIRBNB HMFK2Q9", 684, "travel"),
      goldenRow("2026-08-31", "HILTON GARDEN INN BOS", 212.3, "travel"),
      goldenRow("2026-09-01", "SHELL OIL 57442", 61.2, "travel"),
      goldenRow("2026-09-02", "STARBUCKS 0231", 4.85, "meals"),
      goldenRow("2026-09-03", "TST* BLUE BOTTLE CATERING ALL HANDS", 420, "meals"),
      goldenRow("2026-09-04", "COSTCO WHSE 0112", 318.75, "office"),
      goldenRow("2026-09-07", "IRS USATAXPYMT", 12500, "other"),
      goldenRow("2026-09-08", "STRIPE FEE", 88.4, "other"),
      goldenRow("2026-09-09", "CHASE MONTHLY SERVICE FEE", 15, "other"),
      goldenRow("2026-09-10", "COMCAST BUSINESS", 189, "other"),
      goldenRow("2026-09-11", "VISTAPRINT BUSINESS CARDS", 72.5, "marketing"),
      goldenRow("2026-09-14", "EVENTBRITE SAASTR ANNUAL", 1199, "marketing"),
      goldenRow("2026-09-15", "LINKEDIN JOBS 44821", 495, "other"),
      goldenRow("2026-09-16", "ZOOM.US 888-799-9666", 149.9, "software"),
      goldenRow("2026-09-17", "GODADDY DNS RENEWAL", 21.99, "software"),
      goldenRow("2026-09-18", "APPLE.COM/BILL", 9.99, "software"),
      goldenRow("2026-09-21", "SLACK T0123ABC REFUND", -45, "software"),
      goldenRow("2026-09-22", "DELTA AIR REFUND 00482", -412.6, "travel"),
    ]);
  });

  it("rejects a category outside the chart, naming its file, line, and value", async () => {
    const csv = [
      "date,description,amount,category",
      "2026-08-03,GITHUB INC,84.00,software",
      "2026-08-04,UNITED AIR 0012938475,512.30,travel",
      "2026-08-16,CONED ELECTRIC,220.14,utilities",
    ].join("\n");

    const parsing = parseGoldenCsv({ csv, goldenPath: "data/example.csv" });

    await expect(parsing).rejects.toThrow("data/example.csv");
    await expect(parsing).rejects.toThrow(/line 4\b/i);
    await expect(parsing).rejects.toThrow(/utilities/);
  });
});

describe("scoreAccuracy", () => {
  it("counts matches and lists each miss in input order", async () => {
    const score = await scoreAccuracy({ golden, results: resultsWithTwoMisses() });

    expect(score).toEqual({
      correct: 8,
      total: 10,
      misses: [
        {
          txn: golden[2].txn,
          expectedCategory: "meals",
          actualCategory: "office",
          fallbackReason: null,
        },
        {
          txn: golden[7].txn,
          expectedCategory: "travel",
          actualCategory: "other",
          fallbackReason: LYFT_FALLBACK_REASON,
        },
      ],
    });
  });

  it("refuses to score when the results do not line up with the golden rows", async () => {
    const oneResultShort = resultsWithTwoMisses().slice(0, -1);

    const scoring = scoreAccuracy({ golden, results: oneResultShort });

    await expect(scoring).rejects.toThrow(/\b10\b/);
    await expect(scoring).rejects.toThrow(/\b9\b/);
  });
});

describe("formatAccuracyReport", () => {
  it("prints the file and accuracy line, then one line per miss, and only that line when nothing missed", async () => {
    const score = await scoreAccuracy({ golden, results: resultsWithTwoMisses() });

    const lines = reportLines(await formatAccuracyReport({ score, goldenPath: HARD_GOLDEN_PATH }));

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(HARD_GOLDEN_PATH);
    expect(lines[0]).toContain("8/10");
    const [wrongAnswerLine, fallbackLine] = lines.slice(1);
    for (const expected of ["2026-08-05", "SQ *CAFE GRUMPY", "meals", "office"]) {
      expect(wrongAnswerLine).toContain(expected);
    }
    expect(wrongAnswerLine).not.toContain("null");
    for (const expected of ["2026-08-12", "LYFT RIDE LGA", "travel", "other", LYFT_FALLBACK_REASON]) {
      expect(fallbackLine).toContain(expected);
    }

    const perfectScore: AccuracyScore = { correct: 10, total: 10, misses: [] };
    const perfectLines = reportLines(
      await formatAccuracyReport({ score: perfectScore, goldenPath: EASY_GOLDEN_PATH }),
    );
    expect(perfectLines).toHaveLength(1);
    expect(perfectLines[0]).toContain(EASY_GOLDEN_PATH);
    expect(perfectLines[0]).toContain("10/10");
  });
});

describe("scoring the golden set end to end, without I/O", () => {
  it("reports 8/10 and lists the wrong answer and the fallback in file order", async () => {
    const goldenRows = await parseGoldenFile(EASY_GOLDEN_PATH);
    const replies: Record<string, ScriptedReply> = Object.fromEntries(
      goldenRows.map(({ txn, expectedCategory }) => [txn.description, expectedCategory]),
    );
    replies["SQ *CAFE GRUMPY"] = "office";
    replies["LYFT RIDE LGA"] = overloadedError();
    const client = answerByDescription(replies);

    const results = await classifyAll({ txns: goldenRows.map((row) => row.txn), client });
    const score = await scoreAccuracy({ golden: goldenRows, results });
    const lines = reportLines(await formatAccuracyReport({ score, goldenPath: EASY_GOLDEN_PATH }));

    expect(lines[0]).toContain(EASY_GOLDEN_PATH);
    expect(lines[0]).toContain("8/10");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("SQ *CAFE GRUMPY");
    expect(lines[2]).toContain("LYFT RIDE LGA");
    expect(lines[2]).toContain("overloaded_error");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
