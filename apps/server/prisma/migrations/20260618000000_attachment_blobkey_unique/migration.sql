-- Make attachment blob keys unique (enables lookup-by-blobKey for download authorization).
CREATE UNIQUE INDEX "Attachment_blobKey_key" ON "Attachment"("blobKey");
