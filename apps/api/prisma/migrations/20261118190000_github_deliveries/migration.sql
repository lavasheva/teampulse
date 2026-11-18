ALTER TABLE "WebhookDelivery" ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "payload" JSONB, ADD COLUMN "lastError" TEXT;
