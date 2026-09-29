# Adversarial Review

Reviewer: adversarial review agent, fresh context, 2026-09-24.
Everything below is a hypothesis until someone verifies it independently.
Where a finding says "reproduced", the probe ran against the current working tree or a scratch copy, and no project file was changed.

## Scope Reviewed

- Plan/spec reviewed: `PLAN.md` (all sections, from Milestone 1 through PLAN-021), `SUGGESTIONS.md` (SUG-001 to SUG-011), `CHALLENGE.md`, `README.md`, and the global conventions (`general.md`, `javascript-typescript.md`, `architecture.md`, `AGENTS.md`).
- Diff/files reviewed: the full `git diff` (`.env.example`, `package.json`, `src/types.ts`, `tsconfig.json`), plus every untracked file: `src/classify.ts`, `src/accuracy.ts`, `scripts/accuracy.ts`, `vitest.config.ts`, `vitest.live.config.ts`, and `data/golden-hard.csv`.
  I also read the existing `src/parse.ts` for context.
- Tests reviewed: `tests/classify.test.ts`, `tests/classifyAll.test.ts`, `tests/accuracy.test.ts`, `tests/accuracyScript.test.ts`, `tests/testConfig.test.ts`, `tests/sdkClientFit.test-d.ts`, `tests/live/classify.test.ts`, and everything under `tests/support/`.
- Commands run: `npm test` (30 of 30 pass), `npm run typecheck` (clean).
  I also ran `scripts/accuracy.ts` against a local stand-in API (never the real network), ran direct probes of `parseGoldenCsv`, `formatAccuracyReport`, and `classifyAll`, and ran 5 mutations on a scratch copy.
- Important areas not reviewed: I did not run the live suite or the real accuracy runs, so the before/after numbers (21/27 to 24/27) are unverified user reports.
  I did not review `package-lock.json` beyond confirming that `@anthropic-ai/sdk` 0.30.1 is installed.

## Code Review Findings

### REV-001 - A fallback on an `other` row is scored as correct and does not appear in the report

- Severity: MEDIUM
- Type: correctness
- Location: `src/accuracy.ts` `scoreAccuracy` (lines 59-64), `formatAccuracyReport`, and `scripts/accuracy.ts`.
- Evidence: `scoreAccuracy` compares only `category` values, so a row that expects `other` and fell back to `other` is not a miss, and its `fallbackReason` is dropped.
  Reproduced: `scripts/accuracy.ts data/golden-hard.csv` against a stand-in API that rejects every request with 401 printed `Accuracy on data/golden-hard.csv: 5/27 (19%)` and exited 0.
  No classification happened at all.
  A stand-in that correctly answers `other` for every row printed the same headline, `5/27 (19%)`.
  In the stdout report, the 5 fallback rows cannot be told apart from 5 real answers.
  The only signal is the `console.warn` lines on stderr.
- Impact: 5 of the 27 hard rows (19%) expect `other`.
  During a partial outage (for example, 529s that outlast the SDK's 2 retries), any of those rows that fail get scored as correct without any sign in the report.
  PLAN-020 says "There were no fallbacks in either run".
  That claim can only come from stderr, not from the report, so the before/after comparison depends on someone having read the warnings.
- Why this matters: The point of the Stretch goal is an honest before/after number (D-9).
  This behavior follows the letter of PLAN-009 ("A fallback to `other` counts as correct only if `other` was expected").
  D-10 also ruled out fallback counts.
  So this is a risk in the plan, not an implementation deviation, and the planning agent should decide whether to accept it.
- Suggested verification: Run the script against any stand-in that returns 401, as the S-1/S-3 tests already do, and compare its output with a run where the stand-in answers `other`.
- Suggested direction: Either treat any fallback as a miss for scoring, or add one line to the report when any row fell back.
  Either way it needs a PLAN entry, because it touches D-10.

### REV-002 - `classifyAll` rejects the whole batch when a reply has no `content`

- Severity: LOW
- Type: edge-case
- Location: `src/classify.ts` `classifyTxn` line 90 (`reply.content.find(...)`), and `classifyAll`.
- Evidence: The `try/catch` wraps only `messages.create`.
  If the API or a gateway at `ANTHROPIC_BASE_URL` returns a 200 whose body has no `content` array, line 90 throws a `TypeError` outside the catch.
  Reproduced with a 7-row batch where one reply is `{}`: `classifyAll` rejected with `Cannot read properties of undefined (reading 'find')`.
  No fallback happened and no warning was logged.
  SDK 0.30 does not check the shape of the response body.
- Impact: This breaks D-2 ("One failed row never fails the batch") and the Milestone 1 rule that "any API failure" falls back to `other`.
  In the script, the 26 rows that did succeed are lost.
- Why this matters: The real Anthropic API is very unlikely to send this body, which is why this is LOW.
  Still, the reply is external data used without runtime validation, and the conventions call for validating data at this boundary.
- Suggested verification: Add a fake reply of `{}` (or `{ content: null }`) to one row of a `classifyAll` batch and assert that the batch resolves with that row flagged.
- Suggested direction: Treat a missing or non-array `content` the same as "no text block".

### REV-003 - `parseGoldenCsv` accepts bad amounts, missing headers, and empty files without an error

- Severity: LOW
- Type: edge-case
- Location: `src/accuracy.ts` `parseGoldenCsv`, and `scripts/accuracy.ts`.
- Evidence (all reproduced with direct calls):
  - An empty amount field parses as `amount: 0`, because `Number("")` is 0.
  - An amount of `12x` parses as `NaN`, which is then sent to Claude as `Amount: NaN`.
  - A file with no header row silently loses its first data row, because line 1 is always dropped.
  - A file with only a header, or an empty file, returns `[]`.
    The script then prints `Accuracy on ...: 0/0 (0%)` and exits 0.
- Impact: The amount's sign matters now: `LABELING_RULES` says a refund is recognized by a negative amount.
  A typo in the amount changes what Claude sees, and the golden run still reports a clean number.
  A lost row changes the denominator, and nobody is told.
- Why this matters: PLAN-009 says "A typo in the golden file must never be silently scored", but only the category column is checked.
  G-1 pins the two real files, so this only affects future or edited golden files, hence LOW.
- Suggested verification: Call `parseGoldenCsv` with the inputs above.
- Suggested direction: Reject non-finite amounts and rows with the wrong number of fields, and check the header, all with the same `path line N` message format.

### REV-004 - The rounded percentage can show 100% when some rows were wrong

- Severity: LOW
- Type: correctness
- Location: `src/accuracy.ts` `formatAccuracyReport` line 77.
- Evidence: Reproduced: `{ correct: 199, total: 200 }` prints `199/200 (100%)`.
  None of the tests check the percentage (see Test Coverage Gaps).
- Impact: This cannot happen with 10 or 27 rows, where the smallest possible error is at least 3.7 points.
  It becomes misleading once a golden set grows past 200 rows.
- Why this matters: The headline number is the thing people copy into before/after comparisons.
- Suggested verification: The probe above.
- Suggested direction: Round down, or print one decimal place.

### REV-005 - Agent artifacts are not in `.gitignore`

- Severity: LOW
- Type: convention
- Location: `.gitignore` (contains only `node_modules`, `dist`, `.env`).
- Evidence: `AGENTS.md` says: "Never commit agent tooling artifacts (review pages, scratch files, `.lavish/`). Add them to `.gitignore` before the first commit."
  `review.md` (this file) and `SUGGESTIONS.md` are untracked and not ignored.
  The user should decide whether `PLAN.md` counts as an agent artifact.
- Impact: A routine `git add .` would commit these files.
- Suggested verification: `git status --ignored`.
- Suggested direction: The user decides which of these files should be versioned.

## Test Coverage Gaps

Each item below was checked with a mutation on a scratch copy.
The full suite still passed 30 of 30 under every one of these mutations.

- The percentage in the report is never checked.
  - Mutation: `Math.round((correct / total) * 100)` changed to `Math.round(correct / total)`, so the report prints `(1%)` for 8/10.
    All tests still pass.
  - Why it matters: the percentage is the headline of every before/after result.
  - Suggested test: in A-4, assert that the first line contains `(80%)`.
- The fixed request parameters are never checked: `MODEL`, `temperature: 0`, and `MAX_REPLY_TOKENS`.
  - Mutation: the model changed to another name, `temperature` changed to 1, and `max_tokens` changed to 4096.
    All tests still pass.
  - Why it matters: PLAN-015 and PLAN-020 require these to stay unchanged for the before/after comparison to be valid, but only a manual review in PLAN-020 checked that.
  - Suggested test: assert these fields on `client.requests[0]` in Milestone 1 test 2.
- The script's successful run has no offline test.
  - Mutation: the script passes `goldenPath: "x"` to `formatAccuracyReport`.
    All tests still pass.
    PLAN-017 accepts this gap, and S-3 does prove that the path argument is read.
  - Still, nothing proves that the script prints a report or exits 0 when things go right: S-1 and S-3 only cover the two exit-1 branches.
  - Suggested test: the stand-in server in `tests/accuracyScript.test.ts` already exists.
    Make it answer valid messages and assert the first stdout line and exit code 0 for `data/golden.csv`.
    That makes 10 requests to localhost and none to the network.
- Only the first text block is ever tested.
  - Mutation: `classifyTxn` reads the last text block instead of the first.
    All tests still pass.
  - Why it matters: this is minor, but the plan says "reads the first text block".
- There is no test for a malformed reply without `content` (REV-002), and none for bad amounts, a missing header, or an empty golden file (REV-003).

## Feature / Product Suggestions

- Fallback visibility in the accuracy report (see REV-001).
  - Benefit: the before/after numbers can be trusted from stdout alone.
  - Tradeoff: this reverses part of D-10.
  - Scope: outside current scope; needs a PLAN entry.
- Exit with a non-zero code when every row fell back.
  - Benefit: an expired key or an outage cannot produce a plausible-looking "19%" run that exits 0.
  - Tradeoff: this adds a rule on top of "exits 0 whatever the accuracy is" (PLAN-009).
  - Scope: outside current scope.
- A held-out golden set, already listed as an open item in PLAN-021.
  - Benefit: I agree with the in-sample caveat.
    Several category definitions closely restate hard-set rows even though no merchant is named.
    Examples: "a payroll provider's own software fee" matches GUSTO FEE, "bulk warehouse purchases with no item detail" matches COSTCO, and "food for team events" matches the catering row.
  - Tradeoff: needs new labeled data.
  - Scope: outside current scope.

## Areas Checked With No Material Finding

- Validation path: every successful result goes through `normalizeLabel` and then `isCategory`.
  Stripping punctuation cannot join separate words into a category name, because whitespace is kept, so `The category is not software` is still rejected.
  A reply that is an empty string gets a non-empty `fallbackReason`.
- The narrow `try/catch` around `messages.create` matches the plan.
  Real SDK errors reach `fallbackReason`: the stand-in 401 produced `401 {"type":"error","error":{"type":"authentication_error",...}}`.
  I found no key material in error messages or logs.
- `classifyAll` worker pool: the shared `nextIndex` is safe on a single-threaded event loop, results are written by index, an empty input sends no request, and the concurrency cap is 5.
  C-2 and C-3 are meaningful and not timing-fragile at the chosen delays.
- Script order: the key is checked first, then the file is read, then the client is built, as PLAN-012 and PLAN-015 require.
  `dotenv/config` does not override variables that are already set, so S-1 cannot pick up a real key.
  S-1 and S-3 point the SDK at a localhost stand-in, so they cannot reach the network.
- Live test isolation: S-2 lists files with `--filesOnly`, so live files are never imported.
  The live budget guard disables retries, so every request that reaches the API is counted.
- `data/golden-hard.csv` matches the 27 rows in PLAN-015 exactly (G-1).
  CRLF line endings parse correctly because each field is trimmed.
- Prompt: the category list is still `CATEGORIES.join(", ")`, and `Record<Category, string>` guarantees every category has a definition.
  I found no merchant names from either golden file in the prompt text.
  Prompt injection through a description can only produce a valid category, because every reply goes through the membership check.
- Scope: every changed file matches a PLAN entry.
  I found no unrelated refactors.
  `src/parse.ts` is unchanged.
- The type-level SDK fit check (`tests/sdkClientFit.test-d.ts`) is covered by `tsc`, and vitest does not collect it.

## Summary

- Findings by severity: 0 BLOCKER, 0 HIGH, 1 MEDIUM (REV-001), 4 LOW (REV-002 to REV-005).
- Needs independent verification: REV-001 (and whether the planning agent accepts it under D-10), REV-002, and REV-003.
  All three were reproduced by the reviewer and should be reproduced again independently.
- Test gaps: 4 mutations survive the full suite: the percentage, the request parameters, the script's successful run (a gap PLAN-017 accepts), and which text block is read.
- Feature suggestions: 3, all outside current scope.
- Possible blocker: nothing blocks what PLAN-021 closed.
  REV-001 does weaken how far the recorded before/after numbers can be trusted from the report alone.
  The planning agent should decide whether PLAN-020's "no fallbacks" claim needs re-checking from the stderr output of those runs.
