import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts", "src/**/*.test.ts"],
    // Load .env (DATABASE_URL etc.) before any test imports the prisma client.
    setupFiles: ["./vitest.setup.ts"],
    // Multiple test files write to the same SQLite `dev.db`; running them in
    // parallel races deleteMany/insert operations across connections and
    // produces transient FK-violation / locked errors. Serializing files is
    // cheap for this suite's size and gives deterministic runs.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // Match tsconfig paths so tests can use the same "@/…" imports as
      // production code.
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
