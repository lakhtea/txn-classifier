import type { Txn } from "./types.js";

/** Parse a bank CSV export. Header: date,description,amount */
export function parseCsv(csv: string): Txn[] {
  const lines = csv
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const [, ...rows] = lines;
  return rows.map((line) => {
    const [date, description, amount] = line.split(",");
    return { date, description, amount: Number(amount) };
  });
}
