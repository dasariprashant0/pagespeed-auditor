/*
  Warnings:

  - Added the required column `pageId` to the `RunLogEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `strategy` to the `RunLogEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `url` to the `RunLogEvent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "RunLogEvent" ADD COLUMN     "pageId" TEXT NOT NULL,
ADD COLUMN     "strategy" TEXT NOT NULL,
ADD COLUMN     "url" TEXT NOT NULL,
ALTER COLUMN "message" DROP NOT NULL;
