-- Group conversation title (groups only; DIRECT conversations derive the name from the peer).
ALTER TABLE "Conversation" ADD COLUMN "title" TEXT;
