-- CreateTable
CREATE TABLE "TradingMarket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "betfairMarketId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "courseId" TEXT,
    "totalMatched" REAL NOT NULL DEFAULT 0,
    "numRunners" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'scanning',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradingMarket_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradingRunner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "selectionId" INTEGER NOT NULL,
    "horseName" TEXT NOT NULL,
    "bestBack" REAL,
    "bestLay" REAL,
    "traded" REAL NOT NULL DEFAULT 0,
    "volatilityScore" REAL,
    "bookBalance" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradingRunner_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "TradingMarket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT,
    "marketId" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "entryBackPrice" REAL NOT NULL,
    "entryLayPrice" REAL NOT NULL,
    "stake" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "profitLoss" REAL NOT NULL DEFAULT 0,
    "exitReason" TEXT,
    "mode" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "Trade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradingSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Trade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "TradingMarket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trade_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "TradingRunner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'entry',
    "price" REAL NOT NULL,
    "size" REAL NOT NULL,
    "matchedSize" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'unmatched',
    "betAngelBetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeOrder_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StrategyConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "scalpStake" REAL NOT NULL DEFAULT 50,
    "stopLossTicks" INTEGER NOT NULL DEFAULT 2,
    "preRaceExitSeconds" INTEGER NOT NULL DEFAULT 10,
    "preRaceWarningSeconds" INTEGER NOT NULL DEFAULT 60,
    "minMarketVolume" REAL NOT NULL DEFAULT 50000,
    "maxConcurrentTrades" INTEGER NOT NULL DEFAULT 5,
    "dailyLossLimit" REAL NOT NULL DEFAULT 200,
    "maxStakePerTrade" REAL NOT NULL DEFAULT 200,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TradingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "mode" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "dailyPnL" REAL NOT NULL DEFAULT 0,
    "tradesOpened" INTEGER NOT NULL DEFAULT 0,
    "tradesClosed" INTEGER NOT NULL DEFAULT 0,
    "suspendedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "TradingMarket_betfairMarketId_key" ON "TradingMarket"("betfairMarketId");

-- CreateIndex
CREATE UNIQUE INDEX "TradingRunner_marketId_selectionId_key" ON "TradingRunner"("marketId", "selectionId");

-- CreateIndex
CREATE INDEX "Trade_sessionId_idx" ON "Trade"("sessionId");

-- CreateIndex
CREATE INDEX "Trade_marketId_idx" ON "Trade"("marketId");

-- CreateIndex
CREATE INDEX "Trade_runnerId_idx" ON "Trade"("runnerId");

-- CreateIndex
CREATE INDEX "Trade_status_idx" ON "Trade"("status");

-- CreateIndex
CREATE INDEX "TradeOrder_tradeId_idx" ON "TradeOrder"("tradeId");

-- CreateIndex
CREATE INDEX "TradeOrder_status_idx" ON "TradeOrder"("status");

-- CreateIndex
CREATE INDEX "TradingSession_date_idx" ON "TradingSession"("date");

-- CreateIndex
CREATE INDEX "TradingSession_mode_idx" ON "TradingSession"("mode");
