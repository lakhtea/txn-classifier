// Type-only check, run by `npm run typecheck` and never executed:
// the real SDK client must be accepted wherever classifyTxn expects a MessagesClient.
import Anthropic from "@anthropic-ai/sdk";
import { classifyTxn, type MessagesClient } from "../src/classify.js";

const realClient: MessagesClient = new Anthropic({ apiKey: "unused" });

type ClassifyTxnInput = Parameters<typeof classifyTxn>[0];

export const inputWithRealClient: ClassifyTxnInput = {
  txn: { date: "2026-09-01", description: "GITHUB INC", amount: 84 },
  client: realClient,
};
