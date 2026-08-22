-- Per-organisation MCP tokens.
--
-- A single MCP_BEARER_TOKEN in the environment cannot be tenant-safe: whoever
-- held it would reach whichever organisation a query happened to resolve to.
CREATE TABLE "McpToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "McpToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "McpToken_tokenHash_key" ON "McpToken"("tokenHash");
CREATE INDEX "McpToken_organizationId_idx" ON "McpToken"("organizationId");
ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
