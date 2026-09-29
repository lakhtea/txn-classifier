## SUG-001

- Agent: test
- Type: requirement-gap
- Priority: P1
- Status: ACCEPTED
- Observation: The PLAN.md section "2026-09-24 update: flag is `fallbackReason`, not `needsReview`" was written by the test agent, not the planning agent. The user chose `fallbackReason`; the details about what the reason text must contain were the test agent's own additions.
- Why it matters: Four assertions rest on requirements nobody approved: the invalid-label reason contains `groceries`, the sentence reason contains the sentence, the API-failure reason contains `overloaded_error`, and the scenario logs exactly 2 warnings.
- Evidence: `tests/classify.test.ts`, the "falls back to \"other\" with a reason and a warning" tests and the September bank export scenario. `src/classify.ts` currently satisfies all four.
- Proposed change: The planning agent should confirm, rewrite, or supersede that section with a numbered entry. The test agent will then remove any assertion it does not approve.
- Affected area: PLAN.md, tests/classify.test.ts

## SUG-002

- Agent: test
- Type: edge-case
- Priority: P3
- Status: ACCEPTED
- Observation: Two tests go beyond the planned test list. Test 2 also asserts that the date and amount are sent (the plan's Request section requires this, but planned test 2 lists only the description and the category names). Item 7 has an extra third case, a reply with an empty `content` array.
- Why it matters: This is scope beyond the approved tests, even though both follow from the spec.
- Evidence: `tests/classify.test.ts`: "sends the transaction and every category name to Claude" and "when Claude sends 'a reply with no content'". Mutation check: leaving the description out of the prompt fails 2 tests.
- Proposed change: Approve both into the test list, or have the test agent remove them.
- Affected area: tests/classify.test.ts

## SUG-003

- Agent: test
- Type: correctness
- Priority: P3
- Status: ACCEPTED
- Observation: The "every category name" assertion searches the whole serialized request for each word. The word "other" can also match ordinary prompt text, and each category is only checked as a substring.
- Why it matters: A prompt that dropped `other` from the list could still pass if the word appeared anywhere else in the request.
- Evidence: `tests/classify.test.ts`, "sends the transaction and every category name to Claude".
- Proposed change: Plan a more specific test, for example asserting that `system` contains the comma-separated category list, or that each category appears as a whole word.
- Affected area: tests/classify.test.ts

## SUG-004

- Agent: test
- Type: requirement-gap
- Priority: P3
- Status: ACCEPTED
- Observation: The plan's Verification section says `npm run typecheck` confirms that the real SDK client fits `MessagesClient`. Nothing in the repo passes a real `Anthropic` client to `classifyTxn` yet, so the typecheck alone proves nothing about it.
- Why it matters: An SDK upgrade or an interface change could break compatibility with the real client, and nothing would catch it until the Milestone 2 script is written.
- Evidence: A temporary type-only file assigning `new Anthropic({ apiKey: "unused" })` to `MessagesClient` compiled cleanly (tsc exit 0) and was then deleted. It is not part of the suite.
- Proposed change: Add a permanent type-level test, such as `tests/sdkClientFit.test-d.ts` or an `expectTypeOf` assertion, or accept that the Milestone 2 script will cover this.
- Affected area: tests/, src/classify.ts

## SUG-005

- Agent: test
- Type: requirement-gap
- Priority: P2
- Status: ACCEPTED
- Observation: PLAN-009 describes the contents of a miss and of the golden parse error, but not their exact shape. The Milestone 2 tests had to choose one.
- Why it matters: The implementation agent must match these choices, so they should be approved requirements, not test-agent assumptions (as with SUG-001).
- Evidence: `tests/accuracy.test.ts` A-3 expects each miss to be exactly `{ txn, expectedCategory, actualCategory, fallbackReason }`, reusing the `txn` and `expectedCategory` names from `GoldenRow`. A-2 expects the error message to match `/line 4\b/i` for the fourth physical line of the file, counting the header as line 1. The shapes are recorded in `tests/support/loadAccuracy.ts`.
- Proposed change: Confirm the field name `actualCategory` and the 1-based, header-inclusive `line N` wording in PLAN-009, or name alternatives and the tests will follow.
- Affected area: tests/accuracy.test.ts, tests/support/loadAccuracy.ts, src/accuracy.ts

## SUG-006

- Agent: test
- Type: edge-case
- Priority: P3
- Status: ACCEPTED
- Observation: Two Milestone 2 requirements have no automated test: the script exits with code 1 and a clear message when `ANTHROPIC_API_KEY` is missing, and `npm test` does not run `tests/live/`.
- Why it matters: A regression in either one is costly. A missing-key check that runs after the client is built could fire real requests, and a broken exclusion makes `npm test` hit the network (the live file makes a real call with an invalid key in L-2).
- Evidence: PLAN-010 lists only offline tests C-1 to C-5 and A-1 to A-5, plus the live tests. Neither requirement is covered. Until the implementation adds the exclusion, `npm test` picks up `tests/live/classify.test.ts`.
- Proposed change: Add an offline test that spawns `tsx scripts/accuracy.ts` with `ANTHROPIC_API_KEY` empty and asserts exit code 1 and a message naming `.env`. Also add one that runs `vitest list` under the default config and asserts that no path under `tests/live/` appears.
- Affected area: tests/, scripts/accuracy.ts, vitest config

## SUG-007

- Agent: implementation
- Type: edge-case
- Priority: P4
- Status: ACCEPTED
- Observation: `scoreAccuracy` pairs golden rows and results by index. PLAN-009 does not say what happens when the two arrays have different lengths. The implementation throws an `Error` naming both lengths rather than scoring a partial or misaligned set.
- Why it matters: A silent mismatch would print a wrong accuracy number, the same risk PLAN-009 calls out for golden-file typos.
- Evidence: `src/accuracy.ts`, `scoreAccuracy`. No test covers it; `classifyAll` always returns one result per input, so the script cannot hit it today.
- Proposed change: Approve the guard (and optionally add a test), or have it removed.
- Affected area: src/accuracy.ts, tests/accuracy.test.ts

## SUG-008

- Agent: test
- Type: nice-to-have
- Priority: P2
- Status: ACCEPTED
- Observation: Independent verification on 2026-09-24 found Milestone 2 meets every offline completion criterion in PLAN-010, PLAN-012, and PLAN-013. The only open items are the user-run checks those entries leave to the user.
- Why it matters: Closing the milestone on evidence lets the Stretch goal (prompt changes with before/after accuracy) start from a verified base.
- Evidence: `npm test` passed 28 of 28 (6 files), and 10 more full runs each passed 28 of 28. `tests/live/` was not collected; S-2 confirms this, and `vitest list --config vitest.live.config.ts` lists only `tests/live/classify.test.ts`. `npm run typecheck` exits 0 with `scripts` in `tsconfig.json` `include`. All 9 planned mutations each failed at least one test on a scratch copy of the current implementation, and the restored copy passed 28 of 28. Uncapped `Promise.all` failed C-3. Cap 1 failed C-3. Completion order failed C-2 and 4 others. No golden category check failed A-2. Fallbacks counted as correct failed A-3, A-4, and A-5. Fallback reason left out of the report failed A-4 and A-5. Key check removed failed S-1. Live tests no longer excluded failed S-2. Length guard removed failed A-6. `.env.example` no longer has `ANTHROPIC_MODEL`. Runtime check: `npm run accuracy` with an empty key prints "ANTHROPIC_API_KEY is not set: add it to .env (see .env.example)" and exits 1. The test files still contain their key assertions, so none were weakened.
- Proposed change: Add a PLAN entry that closes Milestone 2. Before or alongside it, the user runs `npm run test:live` (at most 5 real calls) and `npm run accuracy`, and the accuracy output is recorded as the Stretch baseline, as PLAN-010 Verification requires. Then plan the Stretch milestone.
- Affected area: PLAN.md
- Update (2026-09-24): The user ran the checks that were left to them and reported the results. The test agent did not run them.
  - `npm run test:live`: both live tests pass (L-1 `classifyAll` on 3 golden rows, and L-2 invalid-key fallback). The budget guard did not fail.
  - `npm run accuracy`: `Accuracy: 10/10 (100%)`, no misses. This is the Stretch baseline.
  - With these results, every Milestone 2 completion criterion in PLAN-010, PLAN-012, and PLAN-013 is met. The proposed change reduces to recording the 10/10 baseline and closing Milestone 2 in a PLAN entry.
  - Note for Stretch planning: at a 10/10 baseline, the 10-row golden set cannot show a before/after improvement. The Stretch plan may need a larger or harder golden set to measure prompt changes.

## SUG-009

- Agent: test
- Type: requirement-gap
- Priority: P3
- Status: ACCEPTED
- Observation: PLAN-015 requires the report's first line to name the golden file that was scored. PLAN-016 has no test for it.
- Why it matters: The before/after comparison depends on telling the two runs apart. If this regresses, a hard-set output could be pasted as an easy-set number and nothing would catch it.
- Evidence: PLAN-016 lists only G-1 and S-3. S-3 covers a path that cannot be read, not the report header of a successful run. `formatAccuracyReport(score)` takes no path today, so the header is either a signature change or a line the script adds, and the planning agent should say which.
- Proposed change: Decide where the file name enters the report, then add one offline test. If `formatAccuracyReport` takes the path, extend A-4 to assert that the first line contains the given path. If the script adds it, add a script test that runs `tsx scripts/accuracy.ts data/golden.csv` against the local stand-in API from S-1 and S-3 and asserts that the first stdout line contains `data/golden.csv`. That run makes 10 requests to the stand-in and none to the network.
- Affected area: tests/accuracy.test.ts or tests/accuracyScript.test.ts, src/accuracy.ts, scripts/accuracy.ts

## SUG-010

- Agent: implementation
- Type: correctness
- Priority: P3
- Status: ACCEPTED
- Observation: The `parseGoldenCsv` error message always says `golden.csv line N`, whichever file was parsed. Now that the script accepts a path (PLAN-015), a bad category in `data/golden-hard.csv` would be reported as being in `golden.csv`.
- Why it matters: The message would send the user to the wrong file to fix the typo, and PLAN-009 asks for this error to pinpoint the bad row.
- Evidence: `src/accuracy.ts`, `parseRow` inside `parseGoldenCsv`. A-2 matches only `/line 4\b/i` and `/utilities/`, so it passes either way. Not changed, per the process note in PLAN-013.
- Proposed change: Drop the hard-coded `golden.csv` prefix so the message reads `line N: unknown category "..."`, and have the script add the path when it reports the error. Alternatively, pass the path into `parseGoldenCsv`. Needs a PLAN entry first.
- Affected area: src/accuracy.ts, scripts/accuracy.ts, tests/accuracy.test.ts (A-2)

## SUG-011

- Agent: test
- Type: nice-to-have
- Priority: P2
- Status: ACCEPTED
- Observation: Independent verification on 2026-09-24 found the Stretch goal meets every completion criterion in PLAN-016, PLAN-017, PLAN-018, and PLAN-020.
- Why it matters: Closing the Stretch goal on evidence completes CHALLENGE.md with a verified suite and recorded before/after numbers.
- Evidence: `npm test` passed 30 of 30 across 6 files, and `npm run typecheck` exited 0. Each of the 5 mutation checks in PLAN-020, run on a scratch copy of the current code, failed its named test (1 failure out of 30 unless noted):
  - `IRS USATAXPYMT` changed from `other` to `payroll` in `data/golden-hard.csv`: G-1 failed.
  - Script ignores its path argument: S-3 failed. Its requests went to the local stand-in API, not the network.
  - `other` removed from the prompt's category list: Milestone 1 test 2 failed.
  - Path left out of the report's first line: A-4 failed, and A-5 also failed (2 failures).
  - Hard-coded `golden.csv` put back in the parse error: A-2 failed.
    The restored copy passed 30 of 30, and every file was byte-identical to the original. The project's `src/`, `scripts/`, and `data/` were not modified. A separate scan of `CATEGORY_DEFINITIONS` and `LABELING_RULES` for the distinctive merchant words in both golden files found no match, which agrees with the PLAN-020 overfitting review. The script checks the API key, then reads the file, then builds the client, as PLAN-015 requires. The test files have not changed since the test agent's last edits. The before/after numbers (hard set 21/27 to 24/27, easy set 10/10 to 10/10) and the live-test results were reported by the user and recorded in PLAN-019 and PLAN-020. The test agent did not rerun them.
- Proposed change: Append a PLAN entry that closes the Stretch goal, keeping the PLAN-020 caveat that 89% is an in-sample number.
- Affected area: PLAN.md
