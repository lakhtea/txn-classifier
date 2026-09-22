import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/parse.js";

describe("parseCsv", () => {
  it("parses the sample export", () => {
    const csv = readFileSync("data/transactions.csv", "utf-8");
    const txns = parseCsv(csv);
    expect(txns).toHaveLength(15);
    expect(txns[0]).toEqual({ date: "2026-09-01", description: "GITHUB INC", amount: 84 });
  });

  it("skips blank lines", () => {
    const txns = parseCsv("date,description,amount\n2026-09-01,GITHUB INC,84.00\n\n");
    expect(txns).toHaveLength(1);
  });
});
