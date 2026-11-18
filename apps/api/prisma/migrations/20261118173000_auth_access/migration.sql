ALTER TABLE "User" ADD COLUMN "verifiedEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "OAuthAttempt" (
  "stateHash" TEXT NOT NULL,
  "browserHash" TEXT NOT NULL,
  "verifier" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "OAuthAttempt_expiresAt_idx" ON "OAuthAttempt"("expiresAt");

-- Backfill existing memberships without discarding data.
ALTER TABLE "TeamMembership" ADD COLUMN "projectId" UUID;
UPDATE "TeamMembership" m SET "projectId" = t."projectId" FROM "Team" t WHERE t.id = m."teamId";
ALTER TABLE "TeamMembership" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "TeamMembership" DROP CONSTRAINT "TeamMembership_teamId_fkey";
CREATE UNIQUE INDEX "Team_id_projectId_key" ON "Team"("id", "projectId");
CREATE UNIQUE INDEX "TeamMembership_projectId_userId_key" ON "TeamMembership"("projectId", "userId");
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_projectId_fkey"
  FOREIGN KEY ("teamId", "projectId") REFERENCES "Team"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;
