ALTER TABLE "Repository" ADD COLUMN "syncProcessed" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "syncFailures" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "syncRetryAt" TIMESTAMP(3), ADD COLUMN "syncLeaseUntil" TIMESTAMP(3),
 ADD COLUMN "syncLeaseToken" TEXT, ADD COLUMN "syncError" TEXT, ADD COLUMN "nextReconcileAt" TIMESTAMP(3);
ALTER TABLE "GitIdentity" ADD COLUMN "githubId" TEXT, ADD COLUMN "resolution" TEXT NOT NULL DEFAULT 'unresolved';
UPDATE "GitIdentity" SET "resolution" = 'github' WHERE "userId" IS NOT NULL AND "authorKey" LIKE 'github:%';
UPDATE "GitIdentity" SET "githubId" = substring("authorKey" from 8) WHERE "authorKey" LIKE 'github:%';
ALTER TABLE "Event" ADD COLUMN "details" JSONB;
CREATE TABLE "IdentityResolution" (
 "id" UUID NOT NULL, "identityId" UUID NOT NULL, "actorId" UUID, "fromUserId" UUID, "toUserId" UUID,
 "reason" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "IdentityResolution_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IdentityResolution_identityId_createdAt_idx" ON "IdentityResolution"("identityId", "createdAt");
ALTER TABLE "IdentityResolution" ADD CONSTRAINT "IdentityResolution_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "GitIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdentityResolution" ADD CONSTRAINT "IdentityResolution_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "RecalculationRequest" (
 "id" UUID NOT NULL, "teamId" UUID NOT NULL, "weekStartsOn" DATE NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1, "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RecalculationRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecalculationRequest_teamId_weekStartsOn_key" ON "RecalculationRequest"("teamId", "weekStartsOn");
ALTER TABLE "RecalculationRequest" ADD CONSTRAINT "RecalculationRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
