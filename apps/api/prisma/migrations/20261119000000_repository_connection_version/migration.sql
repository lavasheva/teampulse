ALTER TABLE "Repository" ADD COLUMN "connectionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WebhookDelivery" ADD COLUMN "repositoryVersion" INTEGER;
