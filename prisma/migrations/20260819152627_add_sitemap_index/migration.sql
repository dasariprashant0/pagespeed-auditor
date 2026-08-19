-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "sitemapIndex" INTEGER;

-- CreateIndex
CREATE INDEX "Page_siteId_sitemapIndex_idx" ON "Page"("siteId", "sitemapIndex");
