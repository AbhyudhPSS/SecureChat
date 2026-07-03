-- Soft-revoke support for devices (revoked devices are excluded from prekey bundles).
ALTER TABLE "Device" ADD COLUMN "revokedAt" TIMESTAMP(3);
