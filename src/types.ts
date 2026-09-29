export interface Txn {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
}

export const CATEGORIES = [
  "software",
  "travel",
  "meals",
  "office",
  "payroll",
  "marketing",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (value: string): value is Category =>
  (CATEGORIES as readonly string[]).includes(value);

export interface ClassifiedTxn extends Txn {
  category: Category;
  /** Null when Claude's answer was used, else why the category fell back to "other". */
  fallbackReason: string | null;
}
