import type { Prisma, ProjectAction } from '@prisma/client'

// Deliberate allow-list: never accept arbitrary request bodies, invitation tokens or credentials.
export async function recordAudit(tx: Prisma.TransactionClient, entry: {
  projectId: string; actorId: string; action: ProjectAction; teamId?: string; targetId?: string
  subject?: string; beforeRole?: string; afterRole?: string
}) {
  const actor = await tx.user.findUnique({ where: { id: entry.actorId }, select: { githubLogin: true } })
  await tx.projectAudit.create({ data: { ...entry, actorLogin: actor?.githubLogin } })
}
