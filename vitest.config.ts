import { configDefaults, defineConfig } from "vitest/config";

// Live tests call the real Anthropic API, so `npm test` never runs them; see vitest.live.config.ts.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "tests/live/**"],
  },
});
