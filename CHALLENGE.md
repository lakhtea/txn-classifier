# Challenge: automatic transaction classification

The finance team hand-classifies every imported transaction into the chart of accounts. Automate it with the Anthropic API.

**Milestone 1:** `classifyTxn(txn): Promise<ClassifiedTxn>`. Claude picks exactly one category from `CATEGORIES`. Response must be validated: anything outside the list, or any API failure, falls back to `"other"` with a flag or log line. The Anthropic client must be injected so tests run with a fake and zero network.

**Milestone 2:** `classifyAll(txns)` for a batch, plus a small script that runs the classifier against `data/golden.csv` and prints accuracy (correct / total).

**Stretch:** change the prompt to improve accuracy and show the before/after numbers.

Constraints: key from `.env`, never hardcoded. Tests must pass offline. Suggested models: claude-sonnet-5, or claude-haiku-4-5 to keep reps cheap.

Wrap questions: what did you fix or build and how do you KNOW it works; what's next with another hour; what did the AI get wrong and how did you catch it.
