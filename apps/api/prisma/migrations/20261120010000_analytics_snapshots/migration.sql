ALTER TABLE "Team" ADD COLUMN "analyticsVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RecalculationRequest" ADD COLUMN "processedVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "TeamAnalysis" (
 "teamId" UUID NOT NULL PRIMARY KEY,
 "sourceVersion" INTEGER NOT NULL DEFAULT 0,
 "requestedVersion" INTEGER NOT NULL DEFAULT 0,
 "engineVersion" TEXT, "result" JSONB, "computedAt" TIMESTAMP(3),
 "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "manualAt" TIMESTAMP(3), "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3),
 "failures" INTEGER NOT NULL DEFAULT 0, "error" TEXT,
 CONSTRAINT "TeamAnalysis_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TeamAnalysis_nextAt_idx" ON "TeamAnalysis"("nextAt");
CREATE TABLE "WeeklySnapshot" (
 "id" UUID NOT NULL PRIMARY KEY, "teamId" UUID NOT NULL, "weekStartsOn" DATE NOT NULL,
 "sourceVersion" INTEGER NOT NULL, "engineVersion" TEXT NOT NULL,
 "result" JSONB NOT NULL, "summary" JSONB NOT NULL,
 "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WeeklySnapshot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WeeklySnapshot_teamId_weekStartsOn_key" ON "WeeklySnapshot"("teamId", "weekStartsOn");
