-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StrategyConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "scalpStake" REAL NOT NULL DEFAULT 50,
    "stopLossTicks" INTEGER NOT NULL DEFAULT 2,
    "preRaceExitSeconds" INTEGER NOT NULL DEFAULT 10,
    "preRaceWarningSeconds" INTEGER NOT NULL DEFAULT 60,
    "minMarketVolume" REAL NOT NULL DEFAULT 50000,
    "maxConcurrentTrades" INTEGER NOT NULL DEFAULT 5,
    "dailyLossLimit" REAL NOT NULL DEFAULT 200,
    "maxStakePerTrade" REAL NOT NULL DEFAULT 200,
    "maxLayLiability" REAL NOT NULL DEFAULT 500,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_StrategyConfig" ("dailyLossLimit", "id", "maxConcurrentTrades", "maxStakePerTrade", "minMarketVolume", "preRaceExitSeconds", "preRaceWarningSeconds", "scalpStake", "stopLossTicks", "updatedAt") SELECT "dailyLossLimit", "id", "maxConcurrentTrades", "maxStakePerTrade", "minMarketVolume", "preRaceExitSeconds", "preRaceWarningSeconds", "scalpStake", "stopLossTicks", "updatedAt" FROM "StrategyConfig";
DROP TABLE "StrategyConfig";
ALTER TABLE "new_StrategyConfig" RENAME TO "StrategyConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
