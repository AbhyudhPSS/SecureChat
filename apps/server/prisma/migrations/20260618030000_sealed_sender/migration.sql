-- Sealed-sender support: per-device delivery token + opaque sealed message store.

-- Device delivery token (backfill existing rows with a random value, then enforce).
ALTER TABLE "Device" ADD COLUMN "deliveryToken" TEXT;
UPDATE "Device" SET "deliveryToken" = md5(random()::text || id || clock_timestamp()::text)
  WHERE "deliveryToken" IS NULL;
ALTER TABLE "Device" ALTER COLUMN "deliveryToken" SET NOT NULL;
CREATE UNIQUE INDEX "Device_deliveryToken_key" ON "Device"("deliveryToken");

-- Sealed messages: addressed only to a recipient device; no sender, no conversation.
CREATE TABLE "SealedMessage" (
    "id" TEXT NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "sealed" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SealedMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SealedMessage_recipientDeviceId_deliveredAt_createdAt_idx"
    ON "SealedMessage"("recipientDeviceId", "deliveredAt", "createdAt");
ALTER TABLE "SealedMessage" ADD CONSTRAINT "SealedMessage_recipientDeviceId_fkey"
    FOREIGN KEY ("recipientDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
