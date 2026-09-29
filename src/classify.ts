import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { CATEGORIES, isCategory, type Category, type ClassifiedTxn, type Txn } from "./types.js";

/** The part of the Anthropic client this module uses; the real SDK client satisfies it. */
export interface MessagesClient {
  messages: {
    create(
      params: MessageCreateParamsNonStreaming,
    ): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export interface ClassifyTxnInput {
  txn: Txn;
  client: MessagesClient;
}

export interface ClassifyAllInput {
  txns: Txn[];
  client: MessagesClient;
}

const MODEL = "claude-haiku-4-5";
// A category name is a single short word, so a tiny budget is enough.
const MAX_REPLY_TOKENS = 16;
const FALLBACK_CATEGORY: Category = "other";
const MAX_CONCURRENT_REQUESTS = 5;

// Definitions and rules stay general: naming merchants from the golden sets would measure memorization.
const CATEGORY_DEFINITIONS: Record<Category, string> = {
  software:
    "software subscriptions, cloud hosting, domain names, app store charges, and a payroll provider's own software fee",
  travel: "airfare, lodging, fuel, rideshare, taxis, and other ground transport",
  meals: "restaurants, coffee shops, food delivery, and food for team events",
  office: "office rent and coworking, office supplies, postage, and bulk warehouse purchases with no item detail",
  payroll: "wages and payroll provider invoices for wages, and payroll tax debits",
  marketing: "advertising, printed promotional material, and tickets to conferences or industry events",
  other:
    "anything that fits none of the above, including utilities (electricity, internet, phone), taxes other than payroll taxes, bank fees, payment-processing fees, and recruiting",
};

const LABELING_RULES = [
  "A refund has a negative amount and belongs to the same category as the original purchase.",
  "Conference and event tickets are marketing, not travel.",
  "Taxes are payroll only when they are payroll tax debits; every other tax is other.",
  "When no category clearly fits, answer other rather than the nearest named category.",
];

const SYSTEM_PROMPT = [
  "You classify company bank transactions into the chart of accounts.",
  `Reply with exactly one of these categories and nothing else: ${CATEGORIES.join(", ")}.`,
  "",
  "Category definitions:",
  ...CATEGORIES.map((category) => `- ${category}: ${CATEGORY_DEFINITIONS[category]}.`),
  "",
  "Rules:",
  ...LABELING_RULES.map((rule) => `- ${rule}`),
].join("\n");

/** Removes formatting, never meaning: extra words survive and fail the exact match. */
const normalizeLabel = (reply: string): string =>
  reply
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();

const describeTxn = (txn: Txn): string =>
  `Date: ${txn.date}\nDescription: ${txn.description}\nAmount: ${txn.amount}`;

export const classifyTxn = async ({ txn, client }: ClassifyTxnInput): Promise<ClassifiedTxn> => {
  const fallBack = (reason: string): ClassifiedTxn => {
    console.warn(`Classified "${txn.description}" as "${FALLBACK_CATEGORY}": ${reason}`);
    return { ...txn, category: FALLBACK_CATEGORY, fallbackReason: reason };
  };

  let reply: Awaited<ReturnType<MessagesClient["messages"]["create"]>>;
  try {
    reply = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_REPLY_TOKENS,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: describeTxn(txn) }],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fallBack(`Anthropic API call failed: ${detail}`);
  }

  const textBlock = reply.content.find((block) => block.type === "text");
  if (textBlock?.text === undefined) {
    return fallBack("Claude's reply had no text block");
  }

  const label = normalizeLabel(textBlock.text);
  if (!isCategory(label)) {
    return fallBack(`Claude's reply is not a category: ${JSON.stringify(textBlock.text)}`);
  }

  return { ...txn, category: label, fallbackReason: null };
};

/** Classifies every transaction, at most MAX_CONCURRENT_REQUESTS at a time, returning results in input order. */
export const classifyAll = async ({ txns, client }: ClassifyAllInput): Promise<ClassifiedTxn[]> => {
  const results: ClassifiedTxn[] = new Array(txns.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < txns.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await classifyTxn({ txn: txns[index], client });
    }
  };

  const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, txns.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
};
