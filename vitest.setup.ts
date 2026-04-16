// Vitest setup file — runs before any test module is imported.
// Loads .env so tests that touch Prisma have DATABASE_URL available.

import "dotenv/config";
