// Scores the classifier against a golden CSV (default data/golden.csv) using the real Anthropic API.
// dotenv/config never overrides a variable that is already set, so an explicit empty key wins over .env.
import "dotenv/config";
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { formatAccuracyReport, parseGoldenCsv, scoreAccuracy } from "../src/accuracy.js";
import { classifyAll } from "../src/classify.js";

const DEFAULT_GOLDEN_PATH = "data/golden.csv";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (apiKey === undefined || apiKey.trim() === "") {
  console.error("ANTHROPIC_API_KEY is not set: add it to .env (see .env.example)");
  process.exit(1);
}

const goldenPath = process.argv[2] ?? DEFAULT_GOLDEN_PATH;

const readGoldenCsv = (): string => {
  try {
    return readFileSync(goldenPath, "utf-8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Could not read golden file ${goldenPath}: ${detail}`);
    process.exit(1);
  }
};

const golden = parseGoldenCsv({ csv: readGoldenCsv(), goldenPath });
const client = new Anthropic({ apiKey });
const results = await classifyAll({ txns: golden.map((row) => row.txn), client });
console.log(formatAccuracyReport({ score: scoreAccuracy({ golden, results }), goldenPath }));
