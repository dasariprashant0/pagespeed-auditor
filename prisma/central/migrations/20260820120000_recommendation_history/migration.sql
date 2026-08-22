-- DropIndex
DROP INDEX "Recommendation_auditResultId_key";

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "Recommendation_auditResultId_version_idx" ON "Recommendation"("auditResultId", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_auditResultId_version_key" ON "Recommendation"("auditResultId", "version");

