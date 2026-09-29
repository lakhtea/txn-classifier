import { isCategory, type Category, type ClassifiedTxn, type Txn } from "./types.js";

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
  results: ClassifiedTxn[];
}

export interface ParseGoldenCsvInput {
  csv: string;
  goldenPath: string;
}

export interface FormatAccuracyReportInput {
  score: AccuracyScore;
  goldenPath: string;
}

/** Parse the golden set. Header: date,description,amount,category */
export const parseGoldenCsv = ({ csv, goldenPath }: ParseGoldenCsvInput): GoldenRow[] => {
  const parseRow = (line: string, lineNumber: number): GoldenRow => {
    const [date, description, amount, category] = line.split(",").map((field) => field.trim());
    if (!isCategory(category)) {
      throw new Error(`${goldenPath} line ${lineNumber}: unknown category ${JSON.stringify(category)}`);
    }
    return { txn: { date, description, amount: Number(amount) }, expectedCategory: category };
  };

  const [, ...rows] = csv.split("\n");
  // Line numbers count the header as line 1, matching what an editor shows.
  const FIRST_DATA_LINE_NUMBER = 2;
  return rows.flatMap((line, index) =>
    line.trim().length === 0 ? [] : [parseRow(line, index + FIRST_DATA_LINE_NUMBER)],
  );
};

export const scoreAccuracy = ({ golden, results }: ScoreAccuracyInput): AccuracyScore => {
  if (golden.length !== results.length) {
    throw new Error(`Expected ${golden.length} results, got ${results.length}`);
  }

  const misses = golden.flatMap(({ txn, expectedCategory }, index): AccuracyMiss[] => {
    const { category: actualCategory, fallbackReason } = results[index];
    return actualCategory === expectedCategory
      ? []
      : [{ txn, expectedCategory, actualCategory, fallbackReason }];
  });

  return { correct: golden.length - misses.length, total: golden.length, misses };
};

export const formatAccuracyReport = ({ score, goldenPath }: FormatAccuracyReportInput): string => {
  const { correct, total, misses } = score;

  const formatMiss = ({ txn, expectedCategory, actualCategory, fallbackReason }: AccuracyMiss): string => {
    const reason = fallbackReason === null ? "" : ` (fallback: ${fallbackReason})`;
    return `  ${txn.date} ${txn.description}: expected ${expectedCategory}, got ${actualCategory}${reason}`;
  };

  const percent = total === 0 ? 0 : Math.round((correct / total) * 100);
  const accuracyLine = `Accuracy on ${goldenPath}: ${correct}/${total} (${percent}%)`;
  return [accuracyLine, ...misses.map(formatMiss)].join("\n");
};
