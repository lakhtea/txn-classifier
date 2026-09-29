import Anthropic from "@anthropic-ai/sdk";
import type { ScriptedReply } from "./fakeAnthropic.js";

export const overloadedError = (): Error =>
  new Anthropic.InternalServerError(529, { type: "overloaded_error" }, undefined, {});

/**
 * Replies for `data/transactions.csv` as Claude tends to phrase them, keyed by description.
 * CONED ELECTRIC gets a label outside the chart; APPLE.COM/BILL hits an API failure.
 */
export const septemberReplies = (): Record<string, ScriptedReply> => ({
  "GITHUB INC": "software",
  "DELTA AIR 0047382910": "travel",
  "SQ *BROOKLYN ROASTERS": "Meals",
  "WEWORK SEPTEMBER": "office",
  "GUSTO PAYROLL 0926": "payroll",
  "GOOGLE ADS 8827461": "marketing",
  "AMZN MKTP US STAPLERS": "office\n",
  DATADOG: "Software.",
  "UBER TRIP JFK": "travel",
  "SEAMLESS TEAM LUNCH": "meals",
  "FIGMA MONTHLY": "software",
  "MARRIOTT CHICAGO": "**travel**",
  MAILCHIMP: "marketing",
  "CONED ELECTRIC": "utilities",
  "APPLE.COM/BILL": overloadedError(),
});

/** The expected [description, category] per row of the September export, in file order. */
export const septemberCategories: Array<[string, string]> = [
  ["GITHUB INC", "software"],
  ["DELTA AIR 0047382910", "travel"],
  ["SQ *BROOKLYN ROASTERS", "meals"],
  ["WEWORK SEPTEMBER", "office"],
  ["GUSTO PAYROLL 0926", "payroll"],
  ["GOOGLE ADS 8827461", "marketing"],
  ["AMZN MKTP US STAPLERS", "office"],
  ["DATADOG", "software"],
  ["UBER TRIP JFK", "travel"],
  ["SEAMLESS TEAM LUNCH", "meals"],
  ["FIGMA MONTHLY", "software"],
  ["MARRIOTT CHICAGO", "travel"],
  ["MAILCHIMP", "marketing"],
  ["CONED ELECTRIC", "other"],
  ["APPLE.COM/BILL", "other"],
];
