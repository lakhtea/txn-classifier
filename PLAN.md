# Plan

This file is append-only.
New decisions and revisions go in a new dated section at the bottom.
Earlier sections are never edited or deleted, even when a later update supersedes them.
When sections disagree, the latest update wins.

---

## 2026-09-24: Milestone 1, `classifyTxn` with validated output

### Context

The finance team classifies every imported transaction by hand.
Milestone 1 of [CHALLENGE.md](CHALLENGE.md) asks for `classifyTxn(txn)`, which asks Claude for exactly one category from `CATEGORIES`.
The answer must be validated.
Any answer outside the list, and any API failure, must fall back to `"other"` and be flagged.
The Anthropic client must be passed in, so tests use a fake and never touch the network.

The goal is the simplest design where validation cannot be skipped: every path from Claude's reply to the returned category goes through one membership check against `CATEGORIES`.

### Validation: exact match after trimming and lowercasing

Claude is told to reply with the category name only.
The code reads the first text block, trims it, lowercases it, and checks it against `CATEGORIES` using a type guard `isCategory(value: string): value is Category`.
If the check fails, the result is `"other"` with the flag set.

This is intentionally strict.
A reply like `"Software."` or `"The category is software"` is rejected rather than guessed at.
That keeps the rule easy to reason about and easy to test.
The golden-set accuracy script in Milestone 2 will show whether that strictness costs accuracy.

Tool use or JSON output was considered and rejected for now.
Claude's reply would still need the same membership check, so those options add complexity without removing the validation step.
Zod is also skipped: `CATEGORIES.includes` is enough to validate a single string.

### Flagging: a `needsReview` field, plus a warning log

- Add `needsReview: boolean` to `ClassifiedTxn` in [src/types.ts](src/types.ts).
- It is `true` only when the code fell back to `"other"` (invalid label, empty or non-text reply, or API error).
- It is `false` when Claude itself answered `"other"`, which is a valid answer.
- On fallback, also `console.warn` the transaction description and the reason (the bad label or the error), so errors are never silently swallowed.

A field on the result is easier to test and to act on later, for example as a "needs review" list for the finance team.
A log line alone would only be visible to whoever reads the console.

### Client injection

`src/classify.ts` defines a narrow interface that the real SDK client already satisfies:

```ts
interface MessagesClient {
  messages: {
    create(params: MessageCreateParamsNonStreaming): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export const classifyTxn = async ({ txn, client }: ClassifyTxnInput): Promise<ClassifiedTxn> => { ... };
```

Tests pass a small fake that returns a fixed reply or throws.
Building the real `Anthropic` client from `.env` belongs to the Milestone 2 script, so this milestone has no network code and no key handling.
The typecheck will confirm that the real `Anthropic` client can be passed where `MessagesClient` is expected.

### Request

- Model: `claude-haiku-4-5` (a named constant), `max_tokens` small (for example 16), `temperature: 0`.
- System prompt lists `CATEGORIES` and says to reply with exactly one of them and nothing else.
- User message includes the description, amount, and date.
- The `try/catch` wraps only the `messages.create` call.

### TDD order (each test written first and watched failing)

In `tests/classify.test.ts`:

1. A valid reply (`"software"`) returns that category with `needsReview: false`, and keeps the original `date`, `description`, `amount`.
2. The request sent to the fake contains the transaction description and every category name.
3. Whitespace and case are normalized: `"  Travel\n"` returns `travel`.
4. An unknown label (`"groceries"`) returns `other` with `needsReview: true`.
5. A sentence (`"The category is software"`) returns `other` with `needsReview: true`.
6. An empty reply, or a reply with no text block, returns `other` with `needsReview: true`.
7. When the client throws, the call resolves (does not reject) to `other` with `needsReview: true`.
8. When Claude answers `"other"`, the result is `other` with `needsReview: false`.

Scenario test: parse the real `data/transactions.csv` with `parseCsv` ([src/parse.ts](src/parse.ts)).
Classify every row with a fake that maps descriptions to realistic replies, including one invalid label and one thrown error.
Assert that all 15 results are valid categories and that exactly the two bad rows are flagged.

Tests spy on and silence `console.warn` so the output stays clean, and check that it was called on fallback.

### Proving the tests catch bugs

After everything is green, apply each mutation, confirm the tests fail, then revert:

- Remove the `isCategory` check and return the raw label.
- Remove the `try/catch`.
- Always set `needsReview: false`.

### Side note

`.env.example` is deleted in the working tree even though it is tracked, and the README setup step depends on it.
It looks unrelated to this task; restore it with `git checkout -- .env.example` unless it was deleted on purpose.

### Verification

- `npm test`: the full suite passes, including the 2 existing parse tests, with no network access and no stray output.
- `npm run typecheck`: clean, which also confirms the real SDK client fits `MessagesClient`.
- Each mutation above makes at least one test fail.

---

## 2026-09-24 update: validation strips punctuation, still rejects extra words

Source: review feedback on the Milestone 1 plan.
This supersedes "Validation: exact match after trimming and lowercasing" above, and the test list and mutation list that depend on it.

### Revised rule

The reply is normalized with `normalizeLabel`: lowercase, strip every character that is not a letter or whitespace, trim.
The normalized label must then exactly match one of `CATEGORIES`.

- `"Software."` and `"**meals**"` are now accepted, unflagged.
- Any extra word is still rejected.
  `"The category is not software"` must never be read as `software`, so there is no substring or keyword matching.

Normalization removes formatting, never meaning.

### Revised test list

1. A valid reply (`"software"`) returns that category with `needsReview: false`, and keeps the original `date`, `description`, `amount`.
2. The request sent to the fake contains the transaction description and every category name.
3. Whitespace and case are normalized: `"  Travel\n"` returns `travel`.
4. Punctuation is stripped: `"Software."` returns `software` and `"**meals**"` returns `meals`, both unflagged.
5. An unknown label (`"groceries"`) returns `other` with `needsReview: true`.
6. A sentence (`"The category is not software"`) returns `other` with `needsReview: true`.
7. An empty reply, or a reply with no text block, returns `other` with `needsReview: true`.
8. When the client throws, the call resolves (does not reject) to `other` with `needsReview: true`.
9. When Claude answers `"other"`, the result is `other` with `needsReview: false`.

The scenario test is unchanged.
The full suite is now 12 tests: 9 unit, 1 scenario, 2 existing parse tests.

### Added mutations

- Replace the exact match with a substring match (`includes`); test 6 must fail.
- Drop punctuation stripping; test 4 must fail.

---

## 2026-09-24 update: flag is `fallbackReason`, not `needsReview`

Source: user decision while reviewing the Milestone 1 tests.
This supersedes "Flagging: a `needsReview` field, plus a warning log" above, and every test-list item that mentions `needsReview`.

### Revised flag

- `ClassifiedTxn` has `fallbackReason: string | null` instead of `needsReview: boolean`.
- It is `null` when Claude's answer was used, including when Claude itself answered `"other"`.
- On fallback it is a non-empty string saying why:
  - for an invalid label or sentence, it includes Claude's raw reply (for example `groceries`);
  - for an API failure, it includes the error message (for example `overloaded_error`).
- The `console.warn` on fallback stays, and it must include the transaction description.

### Test contract

The tests in `tests/classify.test.ts` encode this plan and are the acceptance criteria.
They load `src/classify.ts` at run time, so they fail one by one until it exists.
`classifyTxn` must be exported with the plan's shape: `classifyTxn({ txn, client })`.

The unit tests follow the revised 9-item list, with `fallbackReason` in place of `needsReview`.
Item 7 covers three replies: an empty text block, a reply with only a non-text block, and a reply with no content.
The scenario test uses `data/transactions.csv`: `CONED ELECTRIC` gets the invalid label `utilities`, and `APPLE.COM/BILL` hits an API failure.
Those two rows must be the only ones flagged, and `console.warn` must be called exactly twice.

The full suite is 15 tests: 12 unit (counting each `it.each` case), 1 scenario, 2 existing parse tests.

---

## PLAN-004 - Accepted suggestion

Source: SUG-001
Type: requirement-gap
Supersedes: nothing; confirms the details in "2026-09-24 update: flag is `fallbackReason`, not `needsReview`"

Decision:
The planning agent confirms the `fallbackReason` details that the test agent added.
They are now approved requirements, not test-agent assumptions.

Acceptance criteria:

- AC-4.1: When the reply is not a category, `fallbackReason` contains Claude's raw reply text, unnormalized (for example `groceries`, or `The category is not software`).
- AC-4.2: When the API call fails, `fallbackReason` contains the error message (for example `overloaded_error`).
- AC-4.3: When the reply is empty or has no text block, `fallbackReason` is a non-empty string.
- AC-4.4: `console.warn` is called exactly once per fallback, never on success, and the message contains the transaction description.
  Over the September export that means exactly 2 warnings.

Reason:
The raw reply and the error message are what a reviewer needs to fix a flagged row by hand.
One warning per fallback keeps the log a reliable count of rows needing review.

Tests:
The four existing assertions named in SUG-001 stay as they are.

## PLAN-005 - Accepted suggestion

Source: SUG-002
Type: edge-case

Decision:
Both tests that go beyond the planned list are approved into it.

- Test 2 also asserts that the date and the amount are sent.
  This matches the Request section, which already requires them in the user message.
- Item 7 includes a third case: a reply whose `content` array is empty.
  It falls back to `other` with a non-empty `fallbackReason` and one warning.

Reason:
Both follow from the approved spec and protect real failure modes: a prompt missing transaction context, and an API reply with no blocks.

## PLAN-006 - Accepted suggestion

Source: SUG-003
Type: correctness
Supersedes: the "every category name" part of test 2 in the revised test list

Decision:
Test 2 must check the category list precisely, not by searching the whole request for each word.

Acceptance criterion:
The request's `system` prompt contains the full category list exactly as `CATEGORIES.join(", ")`, in `CATEGORIES` order.
The test builds the expected string from `CATEGORIES`, not from a hand-typed list.
The description, date, and amount checks stay on the user message.

Reason:
Searching the serialized request lets `other` match ordinary prompt wording, so a prompt that dropped `other` from the list could still pass.
Tying the check to `CATEGORIES` means it fails if any category goes missing from the prompt.

Constraint on implementation:
The system prompt keeps the categories as one comma-separated list in `CATEGORIES` order.
The current `src/classify.ts` already does this.

Mutation check:
Removing `other` from the list in the system prompt must fail test 2.

## PLAN-007 - Accepted suggestion

Source: SUG-004
Type: requirement-gap
Supersedes: the claim in Verification that `npm run typecheck` alone confirms the real SDK client fits `MessagesClient`

Decision:
Add a permanent type-level check that the real SDK client can be passed to `classifyTxn`.

Acceptance criteria:

- AC-7.1: `src/classify.ts` exports `MessagesClient` (it already does).
- AC-7.2: A type-only file in `tests/`, for example `tests/sdkClientFit.test-d.ts`, assigns `new Anthropic({ apiKey: "unused" })` to a `MessagesClient` variable and passes it to `classifyTxn` in a type position.
  It never runs and never calls the network.
- AC-7.3: `npm run typecheck` covers that file.
  `tsconfig.json` already includes `tests`, so no config change is needed.
  Vitest does not pick up `*.test-d.ts` by default, so the runtime suite count stays at 15.

Mutation check:
Changing `MessagesClient` so the real client no longer fits (for example requiring a method the SDK lacks) must make `npm run typecheck` fail.

Verification:
Milestone 1 is done only when both `npm test` and `npm run typecheck` pass.

## PLAN-008 - Milestone 1 closed

Type: status
Supersedes: nothing

Decision:
Milestone 1 is closed.
The user approved closing it on 2026-09-24.

Evidence, gathered by the planning agent on 2026-09-24:

- `npm test`: 15 of 15 tests pass (13 in `tests/classify.test.ts`, 2 in `tests/parse.test.ts`).
- `npm run typecheck`: clean, including `tests/sdkClientFit.test-d.ts` (PLAN-007).
- SUG-001 to SUG-004 are all approved and recorded in PLAN-004 to PLAN-007.

## PLAN-009 - Milestone 2 specification

Type: specification
Supersedes: nothing

### Context

Milestone 2 of [CHALLENGE.md](CHALLENGE.md) asks for `classifyAll(txns)` for a batch.
It also asks for a small script that runs the classifier against `data/golden.csv` and prints accuracy as correct / total.
`data/golden.csv` has 10 rows with the header `date,description,amount,category`.

### User decisions (2026-09-24)

- D-1: `classifyAll` never has more than 5 requests in flight.
  The offline tests prove the cap.
  The opt-in live tests make at most 5 real API calls in total, to keep cost down.
  The golden script still classifies all 10 rows, 5 at a time.
- D-2: One failed row never fails the batch.
  Results come back in input order.
- D-3: The model stays the `MODEL` constant (`claude-haiku-4-5`) in `src/classify.ts`.
  The unused `ANTHROPIC_MODEL` line is removed from `.env.example`.
- D-4: The API key comes from the environment (`ANTHROPIC_API_KEY`, loaded from `.env` with `dotenv`, which is already a dependency).
  It is never hardcoded.
- D-5: The script lists every row it got wrong.
- D-6: Tests that hit the real API stay out of `npm test`.
  The user runs them on demand with a separate command.

### Requirements

`classifyAll` (in `src/classify.ts`, next to `classifyTxn`):

- Signature follows the Milestone 1 pattern: `classifyAll({ txns, client }: ClassifyAllInput): Promise<ClassifiedTxn[]>`.
- Every transaction goes through `classifyTxn`, so validation and fallback stay in one place.
- A named constant `MAX_CONCURRENT_REQUESTS = 5` caps how many requests are in flight.
  Use a small hand-written worker pool, not a new dependency.
- The result array has one entry per input, at the same index, whatever order the requests finish in.
- It resolves, never rejects, when individual rows fall back.
  This relies on `classifyTxn` never rejecting on API errors, which Milestone 1 already guarantees.
- An empty input resolves to `[]` without calling the client.

Accuracy module (new `src/accuracy.ts`, pure functions, no I/O):

- `parseGoldenCsv(csv: string): GoldenRow[]`, where `GoldenRow` is `{ txn: Txn; expectedCategory: Category }`.
  It throws an `Error` naming the line number and the bad value when a row's category is not in `CATEGORIES`.
  A typo in the golden file must never be silently scored.
- `scoreAccuracy({ golden, results })` returns `{ correct, total, misses }`.
  A row is correct when `result.category === expectedCategory`.
  `misses` lists each wrong row in input order with the transaction, the expected category, the actual category, and the `fallbackReason`.
  A fallback to `other` counts as correct only if `other` was expected, the same as any other answer.
- `formatAccuracyReport(score)` returns the printed text:
  a first line like `Accuracy: 8/10 (80%)`, then one line per miss with the date, the description, the expected category, the actual category, and the fallback reason when there is one.
  With no misses, only the accuracy line is printed.

Script (new `scripts/accuracy.ts`, run with `npm run accuracy`, which runs `tsx scripts/accuracy.ts`):

- Loads `.env` with `dotenv`.
- If `ANTHROPIC_API_KEY` is missing or empty, prints a clear error that says to set it in `.env`, and exits with code 1 before any API call.
- Builds the real `Anthropic` client, reads `data/golden.csv`, and runs `parseGoldenCsv`, then `classifyAll`, then `scoreAccuracy`, then `formatAccuracyReport`.
  It prints the report and exits with code 0, whatever the accuracy is.
- The script stays thin glue: all logic worth testing lives in `src/`.
- Add `scripts` to the `include` list in `tsconfig.json` so `npm run typecheck` covers it.

Live tests (opt-in, D-6):

- They live in `tests/live/`.
  `npm test` must not run them.
  They run with `npm run test:live`.
- Suggested mechanism: a `vitest.config.ts` that adds `tests/live/**` to the default excludes, and a `vitest.live.config.ts` that includes only `tests/live/**/*.test.ts`.
  The implementation agent may choose another mechanism if it meets both requirements above.
- They load `.env` and fail right away with a clear message if `ANTHROPIC_API_KEY` is missing, because the user ran them on purpose.
- The whole live suite makes at most 5 real `messages.create` calls (D-1).

### Non-goals

- Retries, backoff, or rate-limit handling beyond the concurrency cap.
- Configurable model or concurrency.
- Prompt changes to improve accuracy (that is the Stretch goal).
- Changing `parseCsv` or the Milestone 1 behavior of `classifyTxn`.
- Running the golden script in CI or in `npm test`.

### Assumptions

- Golden rows contain no quoted commas, the same as `parseCsv` assumes today.
- Warnings from fallbacks during the script go to stderr through `console.warn`, which is fine next to the report on stdout.

## PLAN-010 - Milestone 2 test plan

Type: test-plan
Supersedes: nothing

### Offline tests (run by `npm test`, fake client, zero network)

`tests/classifyAll.test.ts`:

- C-1: An empty `txns` resolves to `[]` and sends no requests.
- C-2 (order): The fake answers later rows before earlier ones (for example, delay in reverse index order).
  The results are in input order, and each result carries its own transaction's date, description, and amount.
- C-3 (cap): 12 transactions, and a fake that holds each request open and records how many are in flight.
  The peak in-flight count is exactly 5: never above the cap, and not a sequential loop either.
  Every transaction is requested exactly once.
- C-4 (partial failure): In a batch of 6, one row's request throws and another gets an invalid label.
  The batch resolves.
  Only those two rows are `other` with a non-empty `fallbackReason`, and the other four keep their categories.
- C-5 (scenario): Parse the real `data/transactions.csv` with `parseCsv` and classify all 15 rows with `classifyAll`.
  Use the same realistic description-to-reply fake as the Milestone 1 scenario (`CONED ELECTRIC` gets `utilities`, and `APPLE.COM/BILL` throws).
  The results are in input order and only those two rows are flagged, with exactly 2 warnings.

`tests/accuracy.test.ts`:

- A-1: `parseGoldenCsv` on the real `data/golden.csv` returns 10 rows.
  The first is `GITHUB INC`, `84`, `2026-08-03`, expected `software`, and every expected category is in `CATEGORIES`.
- A-2: `parseGoldenCsv` throws on a row with category `utilities`, and the message names the line number and `utilities`.
- A-3: `scoreAccuracy` on 10 rows with 8 matches returns `correct: 8`, `total: 10`, and 2 misses in input order.
  Each miss has the expected category, the actual category, and the `fallbackReason` (null for a plain wrong answer, a string for a fallback).
- A-4: `formatAccuracyReport` includes `8/10` and one line per miss with the description, expected, and actual, plus the fallback reason when there is one.
  With no misses it prints only the accuracy line.
- A-5 (scenario, the script's pipeline without I/O): Take the text of `data/golden.csv` through `parseGoldenCsv`, `classifyAll` with a fake, `scoreAccuracy`, and `formatAccuracyReport`.
  The fake answers every row correctly except `SQ *CAFE GRUMPY` (replies `office`) and `LYFT RIDE LGA` (throws).
  The report says `8/10` and lists exactly those two rows in golden-file order.

After Milestone 2, `npm test` runs 25 tests: the 15 from Milestone 1 plus 10 new.

### Live tests (run only by `npm run test:live`, at most 5 real calls)

`tests/live/classify.test.ts`:

- L-1: `classifyAll` with the real client on 3 unambiguous golden rows (`GITHUB INC` software, `GUSTO PAYROLL 0826` payroll, `UNITED AIR 0012938475` travel).
  Each result matches its expected category, has `fallbackReason: null`, and is in input order.
  This costs 3 calls.
- L-2: `classifyTxn` with a real client built with an invalid API key resolves to `other`, and its `fallbackReason` contains the SDK's authentication error.
  This proves real SDK errors flow into the fallback.
  It costs 1 call, which is rejected and not billed.
- Budget guard: the live suite wraps the real clients to count `messages.create` calls, and it fails in `afterAll` if the total is over 5.

### Mutation checks (each must fail at least one offline test, then be reverted)

- Replace the worker pool with an uncapped `Promise.all`: C-3 fails.
- Set the cap to 1: C-3 fails.
- Push results in completion order instead of by index: C-2 fails.
- Drop the category check in `parseGoldenCsv`: A-2 fails.
- Count fallbacks as correct in `scoreAccuracy`: A-3 or A-5 fails.
- Omit the fallback reason from report lines: A-4 fails.

### Verification

Milestone 2 is done when all of these hold:

- `npm test` passes all 25 tests, with no network access, and does not run anything in `tests/live/`.
- `npm run typecheck` is clean, and it covers `scripts/`.
- Every mutation above fails at least one test.
- `.env.example` no longer has `ANTHROPIC_MODEL`.
- The user runs `npm run test:live` and `npm run accuracy` when they choose to.
  The accuracy output is recorded in a later PLAN entry as the baseline for the Stretch goal.

## PLAN-011 - Accepted suggestion

Source: SUG-005
Type: requirement-gap
Supersedes: nothing; makes the miss and error shapes in PLAN-009 exact

Decision:
The planning agent confirms the shapes the test agent chose.
They are now approved requirements, not test-agent assumptions.
The user approved this on 2026-09-24.

Acceptance criteria:

- AC-11.1: Each entry in `misses` from `scoreAccuracy` is exactly `{ txn, expectedCategory, actualCategory, fallbackReason }`.
  `txn` and `expectedCategory` keep the names from `GoldenRow`.
  `actualCategory` is the category `classifyAll` returned.
  `fallbackReason` is copied from the result: `null` for a plain wrong answer, a string for a fallback.
- AC-11.2: When a golden row has an unknown category, the `parseGoldenCsv` error message says `line N`, where N is the 1-based physical line number in the file, counting the header as line 1.
  The message also contains the bad value.
  For example, a bad category on the third data row is reported as `line 4`.

Reason:
Reusing the `GoldenRow` names keeps one vocabulary across the module.
A header-inclusive line number matches what the user sees when they open the CSV in an editor.

Tests:
A-2 and A-3 stay as written in `tests/accuracy.test.ts`.

## PLAN-012 - Accepted suggestion

Source: SUG-006
Type: edge-case
Supersedes: the offline test count (25) in PLAN-010 Verification

Decision:
Add two offline tests for Milestone 2 requirements that had no automated check.
The user approved this on 2026-09-24.

Acceptance criteria and tests:

- S-1 (missing key): The test spawns `tsx scripts/accuracy.ts` with `ANTHROPIC_API_KEY` set to an empty string in the child's environment.
  The child exits with code 1, and its output contains a message naming `.env`.
  No API request is made, because the check runs before the client is built.
- S-2 (live tests excluded): The test runs `vitest list` under the default config, the same one `npm test` uses.
  No listed path is under `tests/live/`.

Constraints on implementation:

- The script must load `.env` without dotenv's `override` option, so an environment variable that is already set (even to an empty string) wins over `.env`.
  Otherwise S-1 would pick up a real key from the user's `.env` and could make real calls.
- The script checks the key before it builds the `Anthropic` client or reads the golden file.

Mutation checks (each must fail the named test, then be reverted):

- Move the key check after building the client and calling `classifyAll`, or remove it: S-1 fails.
- Remove `tests/live/**` from the default config's excludes: S-2 fails.

Verification:
After Milestone 2, `npm test` runs 27 tests: the 25 from PLAN-010 plus S-1 and S-2.
Both new tests run offline.

## PLAN-013 - Accepted suggestion

Source: SUG-007
Type: edge-case
Supersedes: the `npm test` count (27) in PLAN-012 Verification

Process note:
The implementation agent added this guard before it was approved.
The user approved it after the fact on 2026-09-24.
From now on, changes proposed in `SUGGESTIONS.md` are not implemented until they have a PLAN entry.

Decision:
`scoreAccuracy` refuses to score when `golden` and `results` have different lengths.

Acceptance criterion:

- AC-13.1: When `golden.length !== results.length`, `scoreAccuracy` throws an `Error` whose message contains both lengths (for example `Expected 10 results, got 9`).
  It never returns a partial or misaligned score.

Reason:
Rows are paired by index, so a length mismatch would print a wrong accuracy number without any warning.
That is the same risk PLAN-009 guards against for typos in the golden file.
`classifyAll` always returns one result per input today, so this protects against future regressions, not current behavior.

Test:

- A-6: `scoreAccuracy` with 10 golden rows and 9 results throws, and the message contains `10` and `9`.
  Add it to `tests/accuracy.test.ts`.

Mutation check:
Remove the length guard: A-6 fails.

Verification:
After Milestone 2, `npm test` runs 28 tests: the 27 from PLAN-012 plus A-6.

## PLAN-014 - Accepted suggestion: Milestone 2 closed

Source: SUG-008
Type: status
Supersedes: nothing

Decision:
Milestone 2 is closed.
The user approved closing it on 2026-09-24.

Evidence:

- `npm test`: 28 of 28 pass across 6 files, rechecked by the planning agent on 2026-09-24.
  The test agent reported 10 more full runs, each 28 of 28, so there is no sign of flakiness.
- `tests/live/` is not collected by `npm test` (S-2).
- `npm run typecheck`: clean, and it covers `scripts/`, rechecked by the planning agent.
- All 9 mutation checks from PLAN-010, PLAN-012, and PLAN-013 each failed at least one test, as the test agent reported in SUG-008.
- `.env.example` no longer has `ANTHROPIC_MODEL` (D-3).
- User-run checks, as reported by the user:
  - `npm run test:live`: L-1 and L-2 pass, and the call-budget guard did not fail.
  - `npm run accuracy`: `Accuracy: 10/10 (100%)`, with no misses.

Stretch baseline:
`claude-haiku-4-5` with the Milestone 1 prompt scores 10/10 on `data/golden.csv` (10 rows).

Open question for Stretch planning:
A 10/10 baseline leaves no room to show a before/after improvement on the current golden set.
Before any prompt changes, the Stretch plan must decide how accuracy will be measured, for example with a larger or harder golden set.

## PLAN-015 - Stretch specification: harder golden set and a before/after prompt change

Type: specification
Supersedes: nothing; answers the open question in PLAN-014

### Context

The Stretch goal in [CHALLENGE.md](CHALLENGE.md) is to change the prompt to improve accuracy and show the before/after numbers.
The baseline is 10/10 on `data/golden.csv` (PLAN-014), which leaves no room to show an improvement.

### User decisions (2026-09-24)

- D-7: Add a separate, harder golden set in `data/golden-hard.csv`.
  `data/golden.csv` stays unchanged, so the Milestone 2 tests stay valid and the easy set keeps catching regressions.
- D-8: The 27 drafted rows are accepted with the planning agent's proposed categories, including the rows the draft marked for the user to decide.
- D-9: Some misclassifications are acceptable, as long as every answer is one of `CATEGORIES`.
  There is no target accuracy threshold.
  The deliverable is an honest before/after measurement.
- D-10: No extra metrics.
  Fallback counts, per-category accuracy, token cost, and consistency runs (M1 to M4) are all out of scope.
- D-11 (future, out of scope): Later, users may be able to override a transaction's category by hand.
  Nothing in the Stretch work builds or prepares for this.

### The harder golden set

`data/golden-hard.csv` has the same header as `data/golden.csv` and exactly these 27 rows, in this order:

```csv
date,description,amount,category
2026-08-17,AMZN MKTP US PRINTER PAPER,38.40,office
2026-08-18,AMAZON WEB SERVICES,1210.55,software
2026-08-19,UBER EATS PENDING,34.10,meals
2026-08-20,UBER *TRIP HELP.UBER.COM,27.80,travel
2026-08-21,GOOGLE *GSUITE_ACME,144.00,software
2026-08-24,FACEBK *ADS 7Z2K9,640.00,marketing
2026-08-25,ADP TX/FI TAX DEBIT,5230.18,payroll
2026-08-26,JUSTWORKS INV 9921,21400.00,payroll
2026-08-27,GUSTO FEE 0926,149.00,software
2026-08-28,AIRBNB HMFK2Q9,684.00,travel
2026-08-31,HILTON GARDEN INN BOS,212.30,travel
2026-09-01,SHELL OIL 57442,61.20,travel
2026-09-02,STARBUCKS 0231,4.85,meals
2026-09-03,TST* BLUE BOTTLE CATERING ALL HANDS,420.00,meals
2026-09-04,COSTCO WHSE 0112,318.75,office
2026-09-07,IRS USATAXPYMT,12500.00,other
2026-09-08,STRIPE FEE,88.40,other
2026-09-09,CHASE MONTHLY SERVICE FEE,15.00,other
2026-09-10,COMCAST BUSINESS,189.00,other
2026-09-11,VISTAPRINT BUSINESS CARDS,72.50,marketing
2026-09-14,EVENTBRITE SAASTR ANNUAL,1199.00,marketing
2026-09-15,LINKEDIN JOBS 44821,495.00,other
2026-09-16,ZOOM.US 888-799-9666,149.90,software
2026-09-17,GODADDY DNS RENEWAL,21.99,software
2026-09-18,APPLE.COM/BILL,9.99,software
2026-09-21,SLACK T0123ABC REFUND,-45.00,software
2026-09-22,DELTA AIR REFUND 00482,-412.60,travel
```

Labeling policies these rows encode (the answers to the rows the draft marked for the user to decide):

- A refund keeps the category of the original purchase, and its amount is negative.
- Utilities, taxes other than payroll taxes, bank fees, payment-processing fees, and recruiting are `other`.
- Payroll providers' invoices and payroll tax debits are `payroll`, but a payroll vendor's software fee is `software`.
- Fuel, lodging, and ground transport are `travel`.
- Printed promotional material and event tickets are `marketing`.
- Bulk warehouse purchases with no item detail are `office`.

### Script: optional golden file path

- `npm run accuracy` still scores `data/golden.csv`.
- `npm run accuracy -- <path>` scores the golden file at `<path>`, for example `npm run accuracy -- data/golden-hard.csv`.
- Order of checks: first the API key (unchanged, S-1), then reading the file, then building the client.
  If the file cannot be read, the script prints a clear error that names the path and exits with code 1 before any API call.
- The first line of the report names the file that was scored, for example `data/golden-hard.csv`, so before/after outputs cannot be confused.

### Prompt change

Process:

1. Before any prompt change, the user runs `npm run accuracy -- data/golden-hard.csv` and `npm run accuracy`.
   Both outputs are recorded in a PLAN entry as the "before" numbers.
2. The implementation agent then changes `SYSTEM_PROMPT` in `src/classify.ts`.
3. The user runs both commands again, and the outputs are recorded as the "after" numbers, with the misses from each run.

Constraints:

- The prompt keeps the full category list as `CATEGORIES.join(", ")` (PLAN-006) and still tells Claude to reply with exactly one category and nothing else.
- The change adds a short definition for each category, plus general labeling rules like the policies above (for example, refunds keep the original category).
- No overfitting: the prompt must not name any merchant, or quote any description, from either golden file.
  Otherwise the "after" number measures memorization, not a better prompt.
  The planning agent checks this by reviewing the prompt diff before the "after" run.
- The model, `max_tokens`, `temperature`, validation, and fallback behavior do not change.

Keep or revert:
The new prompt is kept if golden-hard accuracy goes up and `data/golden.csv` stays at 10/10.
Otherwise the old prompt is restored, and the attempt and its numbers are still recorded.
Either result is an acceptable Stretch outcome (D-9).

### Non-goals

- Changing the model, validation, or `classifyAll`.
- New metrics (D-10).
- Manual category overrides (D-11).
- Running any golden set inside `npm test`.

## PLAN-016 - Stretch test plan

Type: test-plan
Supersedes: the `npm test` count (28) in PLAN-013 Verification

### Offline tests (run by `npm test`)

- G-1 (`tests/accuracy.test.ts`): `parseGoldenCsv` on the real `data/golden-hard.csv` returns exactly the 27 rows listed in PLAN-015, in order, with their dates, descriptions, amounts, and expected categories.
  The test writes the expected rows out by hand, not by reading the file.
  This catches typos in the data file and proves negative refund amounts parse as negative numbers.
- S-3 (with S-1 and S-2): Spawn `tsx scripts/accuracy.ts data/does-not-exist.csv` with `ANTHROPIC_API_KEY` set to a placeholder, not a real key.
  The child exits with code 1, and its output names `data/does-not-exist.csv`.
  No API request is made, because the file check comes before the client is built.

The existing 28 tests must keep passing after the prompt change, including test 2 (the category list in the system prompt).
After the Stretch work, `npm test` runs 30 tests.

### Mutation checks (each must fail the named test, then be reverted)

- Change one category in `data/golden-hard.csv` (for example H16 `other` to `payroll`): G-1 fails.
- Make the script ignore its path argument and always read `data/golden.csv`: S-3 fails.
  Under this mutation the child may send requests with the placeholder key, which are rejected and not billed.
- Remove `other` from the category list in the new prompt: Milestone 1 test 2 fails (PLAN-006).

### User-run checks

- `npm run accuracy -- data/golden-hard.csv` and `npm run accuracy`, before and after the prompt change.
  Each run of the hard set makes 27 calls, and each run of the easy set makes 10.
- `npm run test:live` once after the prompt change, to confirm L-1 still passes with the new prompt.

### Verification

The Stretch goal is done when all of these hold:

- `npm test` passes all 30 tests, and `npm run typecheck` is clean.
- Every mutation above fails its named test.
- The planning agent has reviewed the prompt diff for overfitting.
- The before/after numbers for both golden files, and the keep-or-revert decision, are recorded in a PLAN entry.

## PLAN-017 - Accepted suggestion

Source: SUG-009
Type: requirement-gap
Supersedes: nothing; makes the report-header requirement in PLAN-015 exact and testable

Decision:
The golden file path enters the report through `formatAccuracyReport`, not through a line the script adds.
The user approved this on 2026-09-24.

`formatAccuracyReport` takes an object, following the `{ txn, client }` and `{ golden, results }` pattern:
`formatAccuracyReport({ score, goldenPath })`.
The script passes the same path it read.

Acceptance criterion:

- AC-17.1: The first line of the report contains `goldenPath` and the accuracy, for example `Accuracy on data/golden-hard.csv: 8/10 (80%)`.
  With no misses, the report is still exactly that one line.
  The miss lines are unchanged.

Reason:
A pure function is tested offline in one line, with no child process and no stand-in API.
It keeps the script as thin glue, as PLAN-009 requires.

Test:
Extend A-4 so it passes a `goldenPath` and asserts that the first line contains it.
It also asserts that the path is included in the no-misses case.
A-5 passes a path too.
There is no new test, so `npm test` stays at 30 (PLAN-016).

Mutation check:
Leave the path out of the first line: A-4 fails.

Known gap, accepted:
A script that read one path but passed a different one to the formatter would not be caught.
The script builds both from the same variable, and S-3 already proves the script uses its path argument.

## PLAN-018 - Accepted suggestion

Source: SUG-010
Type: correctness
Supersedes: the `parseGoldenCsv(csv: string)` signature in PLAN-009; extends AC-11.2

Decision:
`parseGoldenCsv` takes the path of the file it parses, and its error message names that path instead of a hard-coded `golden.csv`.
The user approved passing the path into `parseGoldenCsv` on 2026-09-24.

The signature follows the object pattern and uses the same `goldenPath` name as `formatAccuracyReport` (PLAN-017):
`parseGoldenCsv({ csv, goldenPath }): GoldenRow[]`.
The script passes the same path variable it reads the file from and gives to the report.

Acceptance criterion:

- AC-18.1: When a row has an unknown category, the error message contains `goldenPath`, `line N` (1-based, counting the header, as in AC-11.2), and the bad value.
  For example: `data/golden-hard.csv line 4: unknown category "utilities"`.

Reason:
Now that the script accepts any golden file (PLAN-015), a hard-coded `golden.csv` would send the user to the wrong file to fix a typo.
Passing the path in keeps the message complete wherever the parser is called, with no extra wrapping in the script.

Tests:

- Extend A-2 to pass a `goldenPath` that does not contain `golden.csv` (for example `data/example.csv`), and assert that the message contains that path, along with the existing `line 4` and `utilities` checks.
- Update A-1, G-1, and A-5 to the new signature, each passing the path of the file it reads.
- There is no new test, so `npm test` stays at 30.

Mutation check:
Put the hard-coded `golden.csv` prefix back: A-2 fails.

## PLAN-019 - Stretch "before" numbers recorded

Type: status
Supersedes: nothing; completes step 1 of the prompt-change process in PLAN-015

Evidence:
The user ran both accuracy commands and reported the results on 2026-09-24.
The prompt was the Milestone 1 `SYSTEM_PROMPT`, unchanged, which the planning agent confirmed in `src/classify.ts`.

Before numbers (`claude-haiku-4-5`, Milestone 1 prompt):

- `data/golden.csv`: 10/10 (100%).
- `data/golden-hard.csv`: 21/27 (78%).

Misses on `data/golden-hard.csv` (expected, then actual):

| Row | Expected | Actual |
|---|---|---|
| GUSTO FEE 0926 | software | payroll |
| IRS USATAXPYMT | other | payroll |
| CHASE MONTHLY SERVICE FEE | other | office |
| COMCAST BUSINESS | other | office |
| EVENTBRITE SAASTR ANNUAL | marketing | travel |
| LINKEDIN JOBS 44821 | other | marketing |

What the misses show:
All six are rows that depend on a labeling policy from PLAN-015, not on recognizing the merchant.
Four of them expected `other`, so the current prompt gives Claude no idea of what belongs in `other`.
The model fills that gap with the nearest named category (bank fee as `office`, tax as `payroll`).

Guidance for the prompt change (step 2 of PLAN-015):

- Write the labeling policies from PLAN-015 as general rules and category definitions.
  In particular, say what `other` covers: utilities, taxes other than payroll taxes, bank and payment-processing fees, and recruiting.
  Also say that a payroll vendor's software fee is `software`, and that event tickets are `marketing`.
- The no-overfitting rule in PLAN-015 still applies.
  The prompt must not name Gusto, the IRS, Chase, Comcast, Eventbrite, LinkedIn, or any other merchant or description from either golden file.
  General terms like "bank fees" or "payroll processing" are allowed.
- The planning agent reviews the prompt diff for this before the user runs the "after" numbers.

Suite state at recording time:
`npm test` shows 26 of 30 passing.
The 4 failures are in `tests/accuracy.test.ts`: A-1, G-1, A-2, and A-5.
All four fail because the tests already use the PLAN-018 `parseGoldenCsv({ csv, goldenPath })` signature and the implementation does not yet.
This is the expected red state before the PLAN-018 implementation, not a regression.

Next steps:

1. The implementation agent implements PLAN-018 and changes `SYSTEM_PROMPT` following the guidance above.
2. `npm test` passes 30 of 30.
3. The planning agent reviews the prompt diff for overfitting.
4. The user runs both accuracy commands again, and the "after" numbers and the keep-or-revert decision are recorded.

## PLAN-020 - Stretch "after" numbers, prompt review, and keep decision

Type: status
Supersedes: nothing; completes steps 3 and 4 of the prompt-change process in PLAN-015 and PLAN-019

Process note:
The user ran the "after" numbers before the planning agent reviewed the prompt diff, which is the reverse of the order in PLAN-019.
The review below found nothing that affects the numbers, so they stand.

After numbers (`claude-haiku-4-5`, new prompt), reported by the user on 2026-09-24:

- `data/golden.csv`: 10/10 (100%), unchanged.
- `data/golden-hard.csv`: 24/27 (89%), up from 21/27 (78%).

Remaining misses on `data/golden-hard.csv` (expected, then actual):

| Row | Expected | Actual |
|---|---|---|
| GUSTO FEE 0926 | software | payroll |
| IRS USATAXPYMT | other | payroll |
| LINKEDIN JOBS 44821 | other | marketing |

Fixed by the new prompt: CHASE MONTHLY SERVICE FEE, COMCAST BUSINESS, and EVENTBRITE SAASTR ANNUAL.
There were no fallbacks in either run.

`npm run test:live`: L-1 and L-2 pass with the new prompt, reported by the user.

Prompt review (planning agent, 2026-09-24):

- The category list is still `CATEGORIES.join(", ")` in `CATEGORIES` order, and the "exactly one of these categories and nothing else" instruction is kept (PLAN-006).
- `MODEL`, `MAX_REPLY_TOKENS` (16), `temperature: 0`, validation, and fallback are unchanged.
- The new text is `CATEGORY_DEFINITIONS` (one per category, typed as `Record<Category, string>` so none can be missing) and four general `LABELING_RULES`.
- No overfitting: a scan of the new prompt text for the first word of every description in both golden files found no match.
  A manual read found no merchant names or quoted descriptions.
- Caveat: the definitions put the PLAN-015 labeling policies into words, and those policies were written from the hard set's rows.
  So 89% is an in-sample number.
  It shows the prompt now carries the finance team's policies, not how well it generalizes to unseen merchants.
  A held-out set would be needed to measure that, which is out of scope (D-9, D-10).

Decision:
Keep the new prompt.
It meets the keep rule in PLAN-015: golden-hard accuracy went up (21 to 24), and `data/golden.csv` stayed at 10/10.
The three remaining misses are accepted under D-9.

Suite state at recording time:
`npm test` passes 30 of 30, and `npm run typecheck` is clean, both rechecked by the planning agent.

Remaining for Stretch verification (PLAN-016, PLAN-017, PLAN-018):

- Run each mutation check and confirm it fails its named test:
  a changed category in `data/golden-hard.csv` fails G-1;
  a script that ignores its path argument fails S-3;
  removing `other` from the prompt's category list fails Milestone 1 test 2;
  leaving the path out of the report's first line fails A-4;
  a hard-coded `golden.csv` in the parse error fails A-2.
- Then append a PLAN entry that closes the Stretch goal.

## PLAN-021 - Accepted suggestion: Stretch closed

Source: SUG-011
Type: status
Supersedes: nothing

Decision:
The Stretch goal is closed.
With it, every milestone in [CHALLENGE.md](CHALLENGE.md) is complete.
The user approved closing it on 2026-09-24.

Evidence:

- `npm test`: 30 of 30 pass across 6 files, rechecked by the planning agent on 2026-09-24.
- `npm run typecheck`: clean, rechecked by the planning agent.
- All 5 mutation checks listed in PLAN-020 failed their named tests, as the test agent reported in SUG-011.
  Leaving the path out of the report's first line also failed A-5, in addition to A-4.
  The restored code passed 30 of 30.
- The test agent's independent scan of `CATEGORY_DEFINITIONS` and `LABELING_RULES` found no merchant words from either golden file, which agrees with the PLAN-020 review.
- The script checks the API key, then reads the golden file, then builds the client (PLAN-015).
- User-reported results (PLAN-019, PLAN-020), not rerun by any agent:
  - `data/golden.csv`: 10/10 before, 10/10 after.
  - `data/golden-hard.csv`: 21/27 (78%) before, 24/27 (89%) after.
  - `npm run test:live`: L-1 and L-2 pass with the new prompt.

Caveat carried forward from PLAN-020:
89% is an in-sample number.
The prompt's definitions encode the labeling policies that were written from the hard set, so the number shows that the policies are followed, not how well the prompt generalizes to unseen merchants.

Known open items (out of scope, recorded for later):

- Three accepted misses on the hard set: GUSTO FEE 0926, IRS USATAXPYMT, and LINKEDIN JOBS 44821 (D-9).
- A held-out golden set to measure how well the prompt generalizes.
- Manual category overrides by users (D-11).

## PLAN-022 - Review fixes: specification

Type: specification
Source: `review.md` (adversarial review, 2026-09-24), findings REV-001 to REV-005 and the Test Coverage Gaps section
Supersedes: the scoring sentence in PLAN-009 ("A fallback to `other` counts as correct only if `other` was expected"), and the percentage rounding in PLAN-017's example

### Context

The review found 0 blocker, 0 high, 1 medium, and 4 low findings, plus 4 mutations that survive the full suite.
The user asked for every finding and every coverage gap to be addressed, whatever its severity.

### Independent reproduction (planning agent, 2026-09-24)

The planning agent ran read-only probes against the current `src/` and changed no project file.
Every finding reproduced:

- REV-001: `scoreAccuracy` on a row that expects `other` and fell back with `fallbackReason: "401"` returned `{ correct: 1, total: 1, misses: [] }`.
- REV-002: `classifyAll` on 3 rows, where one reply is `{}`, rejected with `Cannot read properties of undefined (reading 'find')`.
- REV-003: an empty amount parsed as `0`, `12x` parsed as `NaN`, a file without a header lost its first row, and a header-only file and an empty file each returned `[]`.
  A row with 5 fields was only rejected by accident, as `unknown category "1"`.
- REV-004: `{ correct: 199, total: 200 }` printed `199/200 (100%)`.
- REV-005: `git status --ignored` shows `PLAN.md`, `SUGGESTIONS.md`, and `review.md` untracked and not ignored.

### User decisions (2026-09-24)

- D-12: Address every review finding and every test coverage gap, whatever its severity.
- D-13: `PLAN.md`, `SUGGESTIONS.md`, and `review.md` are agent artifacts and go in `.gitignore`.
- D-14: The review's feature and product suggestions become a new stretch goal (PLAN-024), after the fixes.

### REV-001: a fallback is always a miss

Decision (planning agent, under D-12):
A row is correct only when `result.category === expectedCategory` and `result.fallbackReason === null`.
A fallback is never counted as correct, even on a row that expects `other`.
A fallback row appears in `misses` with its `fallbackReason`, so the existing miss line already shows `(fallback: ...)`.

Reason:
A fallback means Claude's answer was not used, so scoring it as correct measures luck, not the classifier.
Without this, an outage or an expired key prints a plausible `5/27 (19%)` on the hard set, and the report on stdout cannot show it.
This does not reverse D-10: no new metric or fallback count is added, only the definition of a correct row changes.

Effect on the recorded numbers:
Only the 5 hard-set rows that expect `other` (IRS, STRIPE, CHASE, COMCAST, LINKEDIN) could have hidden a fallback.
`data/golden.csv` has no `other` rows, so its 10/10 results are unaffected.
In the "before" run, only STRIPE FEE could have been a hidden fallback, so the true "before" number is 21/27 or 20/27.
It is not rerun, because that would mean restoring the old prompt; this caveat is recorded instead.
In the "after" run, STRIPE, CHASE, and COMCAST could have been hidden fallbacks.
After the fix, the user reruns `npm run accuracy -- data/golden-hard.csv` and `npm run accuracy` with the current prompt.
If the results still show 24/27 and 10/10, PLAN-020's numbers are confirmed from stdout alone; if not, the corrected numbers are recorded.

### REV-002: a malformed reply falls back instead of rejecting

`classifyTxn` validates the reply's shape at runtime before reading it.
Each of these falls back to `other` with a non-empty `fallbackReason` and one warning, and never rejects:

- the reply is not an object (for example `null`);
- `content` is missing or is not an array (for example `{}` or `{ content: null }`);
- no block has `type: "text"` with a string `text` (for example `{ type: "text", text: 42 }`).

It still reads the first block with `type: "text"`, as the Milestone 1 plan says.
`classifyAll` does not need its own catch: validation and fallback stay in `classifyTxn` (PLAN-009).

### REV-003: `parseGoldenCsv` rejects malformed golden files

Line 1 must be exactly `date,description,amount,category`, after trimming (so CRLF files still parse).
Blank lines are still skipped.
Each data row is checked in this order, and the first failure throws:

1. It has exactly 4 fields.
2. The amount is non-empty and `Number(amount)` is finite.
   Negative amounts stay valid, because refunds depend on them.
3. The category is in `CATEGORIES` (unchanged).

A file with no data rows (empty, or header only) throws.

Every error message contains `goldenPath`, and every row or header error also contains `line N` (1-based, counting the header as line 1, as in AC-11.2) and the bad value.
Examples: `data/x.csv line 1: expected header "date,description,amount,category"`, `data/x.csv line 3: amount "12x" is not a number`, `data/x.csv: no data rows`.

Script:
When `parseGoldenCsv` throws, `scripts/accuracy.ts` prints the error message (no stack trace) to stderr and exits with code 1, before building the client.
The order stays: key check, then read the file, then parse it, then build the client.

### REV-004: the percentage never rounds up to 100%

`formatAccuracyReport` rounds the percentage down to a whole number: `Math.floor((correct / total) * 100)`.
So `199/200` prints `(99%)`, `2/3` prints `(66%)`, `8/10` prints `(80%)`, and `100%` appears only when every row is correct.
The `total === 0` guard stays, even though the parser now never returns an empty set.

### REV-005: agent artifacts are ignored

Add `PLAN.md`, `SUGGESTIONS.md`, and `review.md` to `.gitignore` (D-13), and end the file with a newline.
The current working-tree change to `.gitignore` removes the final newline, which is an accidental change.

### Test coverage gaps

- The percentage is asserted (REV-004 tests, and A-4 asserts `(80%)`).
- The request parameters are asserted: Milestone 1 test 2 also checks `model: "claude-haiku-4-5"`, `temperature: 0`, and `max_tokens: 16` on the recorded request.
  This replaces the manual-only check in PLAN-020 for the before/after runs.
- The script's successful run is covered by an offline test against the localhost stand-in.
- Reading the first text block is covered, including a text block that comes after a non-text block.
- The malformed-reply (REV-002) and malformed-golden-file (REV-003) cases are covered.

### Non-goals

- New metrics, and any change to the prompt, the model, or `classifyAll`'s concurrency.
- Restoring the old prompt to re-measure the "before" number.
- The feature suggestions (see PLAN-024).

## PLAN-023 - Review fixes: test plan

Type: test-plan
Supersedes: the `npm test` count (30) in PLAN-016

All tests are offline.
Script tests use the existing localhost stand-in in `tests/accuracyScript.test.ts` and never reach the network.
`it.each` cases count as separate tests, as in earlier entries.

`tests/accuracy.test.ts`:

- A-7 (REV-001): `scoreAccuracy` on one row that expects `other`, whose result is `other` with a `fallbackReason`, returns `correct: 0` and one miss with that reason.
  A row that expects `other` and got `other` with `fallbackReason: null` still counts as correct.
  (1 test)
- A-8 (REV-003, `it.each`, 7 cases): `parseGoldenCsv` throws for an empty amount, amount `12x`, a row with 3 fields, a row with 5 fields, a file whose first line is a data row (missing header), a header-only file, and an empty file.
  Each message contains the given `goldenPath`.
  Each row or header error also contains the right `line N` and the bad value.
  (7 tests)
- A-9 (REV-004, `it.each`, 4 cases): the first report line shows `8/10 (80%)`, `199/200 (99%)`, `2/3 (66%)`, and `10/10 (100%)`.
  A-4 also asserts `(80%)`.
  (4 tests)

`tests/classify.test.ts`:

- Test 2 is extended to assert `model`, `temperature`, and `max_tokens` (no new test).
- M-1 (REV-002, `it.each`, 4 cases): the replies `null`, `{}`, `{ content: null }`, and `{ content: [{ type: "text", text: 42 }] }` each resolve to `other` with a non-empty `fallbackReason` and exactly one warning.
  (4 tests)
- M-2 (first text block, `it.each`, 2 cases): `[text "travel", text "software"]` returns `travel`, and `[a non-text block, text "meals"]` returns `meals`.
  Both are unflagged.
  (2 tests)

`tests/classifyAll.test.ts`:

- C-6 (REV-002): in a batch of 5, one reply is `{}`.
  The batch resolves, results stay in input order, only that row is `other` with a `fallbackReason`, and the other four keep their categories.
  (1 test)

`tests/accuracyScript.test.ts`:

- S-4 (REV-001, end to end): the stand-in rejects every request with 401.
  `tsx scripts/accuracy.ts data/golden-hard.csv` exits 0, the first stdout line is `Accuracy on data/golden-hard.csv: 0/27 (0%)`, and stdout has 27 miss lines, each with `(fallback:`.
  (1 test)
- S-5 (REV-003 script path): a golden file written to a temporary directory has amount `12x` on its first data row.
  The script exits 1, stderr contains the file's path and `line 2`, stderr has no stack trace (no `    at ` lines), and the stand-in receives no request.
  (1 test)
- S-6 (successful run): the stand-in answers each request with the correct category for `data/golden.csv`, looked up by the description in the user message.
  The script exits 0, and stdout is exactly `Accuracy on data/golden.csv: 10/10 (100%)` and nothing else.
  (1 test)

After these fixes, `npm test` runs 52 tests: the 30 from PLAN-016 plus 22 new.

### Mutation checks (each must fail the named tests, then be reverted)

- Score by category only, ignoring `fallbackReason`: A-7 and S-4 fail.
- Remove the runtime reply-shape check: M-1 and C-6 fail.
- Read the last text block instead of the first: M-2 fails.
- Remove the amount check, the field-count check, the header check, or the empty-file check: the matching A-8 cases fail.
- Let the script's parse error escape uncaught: S-5 fails.
- Use `Math.round` instead of `Math.floor`: the `199/200` case of A-9 fails.
- Change `Math.floor((correct / total) * 100)` to `Math.floor(correct / total)`: A-4 and A-9 fail.
- Change the model, set `temperature` to 1, or set `max_tokens` to 4096: test 2 fails.
- Pass a hard-coded `goldenPath` to the report in the script: S-6 fails.

### Verification

- `npm test` passes 52 of 52, and `npm run typecheck` is clean.
- Every mutation above fails its named tests.
- `git status --ignored` lists `PLAN.md`, `SUGGESTIONS.md`, and `review.md` as ignored, and `.gitignore` ends with a newline.
- The user reruns both accuracy commands with the current prompt (37 real calls), and the results are recorded in a PLAN entry that confirms or corrects PLAN-020 (REV-001).
- The planning agent rechecks that `review.md`'s findings are each closed by an entry in this plan.

## PLAN-024 - Stretch 2 (proposed): product suggestions from the review

Type: stretch-goal
Source: `review.md`, Feature / Product Suggestions
Status: proposed.
Nothing here starts until PLAN-022 and PLAN-023 are verified and the user approves the scope of each item.

Candidates:

- F-1: Exit with a non-zero code when every row fell back.
  Benefit: an expired key or a full outage cannot produce a run that exits 0.
  Tradeoff: adds a rule on top of "exits 0 whatever the accuracy is" (PLAN-009).
  Open decisions: the exit code, and whether the threshold is "every row" or "any row".
  After REV-001, such a run already shows 0% on stdout, so this only matters for automation that checks the exit code.
- F-2: A held-out golden set to measure how well the prompt generalizes (also an open item in PLAN-021).
  Benefit: replaces the in-sample 89% with a number the prompt was not written from.
  The review notes that several definitions closely restate hard-set rows, for example "a payroll provider's own software fee" (GUSTO FEE) and "bulk warehouse purchases with no item detail" (COSTCO).
  Tradeoff: needs new labeled rows, labeled by the user or the finance team without looking at the prompt, and never used to tune it.
  Open decisions: who labels the rows, and how many.
- Fallback visibility in the report: covered by the REV-001 fix in PLAN-022, so it is not a separate item.

Carried over from PLAN-021, not from the review:
Manual category overrides by users (D-11) stay a future idea and are not part of Stretch 2 unless the user adds them.
