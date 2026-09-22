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

export interface ClassifiedTxn extends Txn {
  category: Category;
}
