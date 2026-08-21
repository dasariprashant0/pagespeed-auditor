-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "d1AccountIdEnc" TEXT,
ADD COLUMN     "d1ApiTokenEnc" TEXT,
ADD COLUMN     "d1DatabaseIdEnc" TEXT,
ADD COLUMN     "provisionError" TEXT,
ADD COLUMN     "provisionStatus" TEXT NOT NULL DEFAULT 'unprovisioned',
ADD COLUMN     "provisionedAt" TIMESTAMP(3),
ADD COLUMN     "tenantDbUrlEnc" TEXT;
