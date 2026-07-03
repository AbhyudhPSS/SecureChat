-- CreateTable
CREATE TABLE "PendingUpload" (
    "blobKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("blobKey")
);

-- CreateIndex
CREATE INDEX "PendingUpload_userId_idx" ON "PendingUpload"("userId");

-- CreateIndex
CREATE INDEX "PendingUpload_createdAt_idx" ON "PendingUpload"("createdAt");

-- AddForeignKey
ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
