-- CreateTable
CREATE TABLE "Horse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "age" INTEGER,
    "sex" TEXT,
    "sire" TEXT,
    "dam" TEXT,
    "trainerId" TEXT,
    "owner" TEXT,
    "flatRating" INTEGER,
    "hurdlesRating" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Horse_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Trainer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Race" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "date" DATETIME NOT NULL,
    "courseId" TEXT NOT NULL,
    "raceName" TEXT NOT NULL,
    "raceType" TEXT NOT NULL,
    "class" INTEGER,
    "distanceFurlongs" REAL NOT NULL,
    "going" TEXT,
    "prizeMoney" INTEGER,
    "numRunners" INTEGER,
    "weatherForecast" TEXT,
    "replayUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Race_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Runner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raceId" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "jockeyId" TEXT,
    "trainerId" TEXT,
    "drawPosition" INTEGER,
    "weightCarried" TEXT,
    "officialRating" INTEGER,
    "oddsSp" REAL,
    "oddsBest" REAL,
    "marketRank" INTEGER,
    "gamblekingScore" REAL,
    "confidenceLevel" TEXT,
    "finishPosition" INTEGER,
    "beatenDistance" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Runner_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Runner_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Runner_jockeyId_fkey" FOREIGN KEY ("jockeyId") REFERENCES "Jockey" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Runner_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Trainer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "surface" TEXT,
    "direction" TEXT,
    "courseType" TEXT,
    "drawBiasData" TEXT
);

-- CreateTable
CREATE TABLE "Jockey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "flatWins" INTEGER NOT NULL DEFAULT 0,
    "hurdleWins" INTEGER NOT NULL DEFAULT 0,
    "strikeRate14d" REAL,
    "strikeRate30d" REAL
);

-- CreateTable
CREATE TABLE "Trainer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "flatWins" INTEGER NOT NULL DEFAULT 0,
    "hurdleWins" INTEGER NOT NULL DEFAULT 0,
    "strikeRate14d" REAL,
    "strikeRate30d" REAL
);

-- CreateTable
CREATE TABLE "Bet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runnerId" TEXT NOT NULL,
    "stake" REAL NOT NULL,
    "oddsTaken" REAL NOT NULL,
    "betType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "profitLoss" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bet_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoingPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "horseId" TEXT NOT NULL,
    "going" TEXT NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "places" INTEGER NOT NULL DEFAULT 0,
    "winPct" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "GoingPreference_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DistancePreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "horseId" TEXT NOT NULL,
    "distanceBand" TEXT NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "places" INTEGER NOT NULL DEFAULT 0,
    "winPct" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "DistancePreference_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseForm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "horseId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "places" INTEGER NOT NULL DEFAULT 0,
    "winPct" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "CourseForm_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourseForm_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RaceComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "horseId" TEXT NOT NULL,
    "raceDate" DATETIME NOT NULL,
    "course" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "source" TEXT,
    CONSTRAINT "RaceComment_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Race_externalId_key" ON "Race"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Runner_raceId_horseId_key" ON "Runner"("raceId", "horseId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_name_key" ON "Course"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Jockey_name_key" ON "Jockey"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Trainer_name_key" ON "Trainer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "GoingPreference_horseId_going_key" ON "GoingPreference"("horseId", "going");

-- CreateIndex
CREATE UNIQUE INDEX "DistancePreference_horseId_distanceBand_key" ON "DistancePreference"("horseId", "distanceBand");

-- CreateIndex
CREATE UNIQUE INDEX "CourseForm_horseId_courseId_key" ON "CourseForm"("horseId", "courseId");
