import type { ClassifiedTxn, Txn } from "../../src/types.js";
import type { FakeClient } from "./fakeAnthropic.js";
import { loadExport } from "./loadExport.js";

/** Any client the tests hand to the classifier: the fake, or a wrapper around the real SDK. */
export type TestClient = Pick<FakeClient, "messages">;

/** The contract from PLAN.md that `src/classify.ts` must export as `classifyTxn`. */
export interface ClassifyTxnInput {
  txn: Txn;
  client: TestClient;
}

/** `fallbackReason` is null when Claude's answer was used, else why it fell back to "other". */
export type ExpectedClassifiedTxn = ClassifiedTxn & { fallbackReason: string | null };

export type ClassifyTxn = (input: ClassifyTxnInput) => Promise<ExpectedClassifiedTxn>;

/** The contract from PLAN-009 that `src/classify.ts` must export as `classifyAll`. */
export interface ClassifyAllInput {
  txns: Txn[];
  client: TestClient;
}

export type ClassifyAll = (input: ClassifyAllInput) => Promise<ExpectedClassifiedTxn[]>;

const CLASSIFY_MODULE = "src/classify.ts";

export const classifyTxn: ClassifyTxn = async (input) => {
  const implementation = await loadExport<ClassifyTxn>(CLASSIFY_MODULE, "classifyTxn");
  return implementation(input);
};

export const classifyAll: ClassifyAll = async (input) => {
  const implementation = await loadExport<ClassifyAll>(CLASSIFY_MODULE, "classifyAll");
  return implementation(input);
};
