CREATE TYPE "ProjectAction" AS ENUM ('manager_added','manager_removed','member_role_changed','member_removed','member_joined','invitation_created','invitation_revoked','repository_connected','repository_reconnected','repository_disconnected','settings_updated','identity_claimed');
CREATE TABLE "ProjectAudit" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "actorId" UUID,
  "actorLogin" TEXT,
  "action" "ProjectAction" NOT NULL,
  "teamId" UUID,
  "targetId" TEXT,
  "subject" TEXT,
  "beforeRole" TEXT,
  "afterRole" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectAudit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ProjectAudit_projectId_createdAt_id_idx" ON "ProjectAudit"("projectId", "createdAt", "id");
CREATE INDEX "Event_repositoryId_occurredAt_id_idx" ON "Event"("repositoryId", "occurredAt", "id");
