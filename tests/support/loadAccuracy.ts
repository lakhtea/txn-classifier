import type { Category, Txn } from "../../src/types.js";
import type { ExpectedClassifiedTxn } from "./loadClassifier.js";
import { loadExport } from "./loadExport.js";

/** The contracts from PLAN-009 that `src/accuracy.ts` must export. */
export interface GoldenRow {
  txn: Txn;
  expectedCategory: Category;
}

export interface AccuracyMiss {
  txn: Txn;
  expectedCategory: Category;
  actualCategory: Category;
  fallbackReason: string | null;
}

export interface AccuracyScore {
  correct: number;
  total: number;
  misses: AccuracyMiss[];
}

export interface ScoreAccuracyInput {
  golden: GoldenRow[];
  results: ExpectedClassifiedTxn[];
}

export interface ParseGoldenCsvInput {
  csv: string;
  /** The file the CSV came from, named in parse errors. */
  goldenPath: string;
}

export interface FormatAccuracyReportInput {
  score: AccuracyScore;
  /** The golden file that was scored, named on the report's first line. */
  goldenPath: string;
}

type ParseGoldenCsv = (input: ParseGoldenCsvInput) => GoldenRow[];
type ScoreAccuracy = (input: ScoreAccuracyInput) => AccuracyScore;
type FormatAccuracyReport = (input: FormatAccuracyReportInput) => string;

const ACCURACY_MODULE = "src/accuracy.ts";

export const parseGoldenCsv = async (input: ParseGoldenCsvInput): Promise<GoldenRow[]> => {
  const implementation = await loadExport<ParseGoldenCsv>(ACCURACY_MODULE, "parseGoldenCsv");
  return implementation(input);
};

export const scoreAccuracy = async (input: ScoreAccuracyInput): Promise<AccuracyScore> => {
  const implementation = await loadExport<ScoreAccuracy>(ACCURACY_MODULE, "scoreAccuracy");
  return implementation(input);
};

export const formatAccuracyReport = async (input: FormatAccuracyReportInput): Promise<string> => {
  const implementation = await loadExport<FormatAccuracyReport>(
    ACCURACY_MODULE,
    "formatAccuracyReport",
  );
  return implementation(input);
};
