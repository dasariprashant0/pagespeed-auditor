/*
  Warnings:

  - You are about to drop the column `roleTourSeenAt` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "checklistDismissedAt" TIMESTAMP(3),
ADD COLUMN     "tourStepsSeen" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" DROP COLUMN "roleTourSeenAt";
