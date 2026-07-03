-- Opaque, client-encrypted chat backup (one per user; the server cannot read it).
CREATE TABLE "Backup" (
    "userId" TEXT NOT NULL,
    "blob" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Backup_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
