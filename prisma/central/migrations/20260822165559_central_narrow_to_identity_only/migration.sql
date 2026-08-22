-- Narrows the central database to identity data only, per the Phase 5
-- per-tenant cutover (docs/PER_TENANT_ARCHITECTURE.md, docs/DECISIONS.md
-- §19). These tables are the pre-cutover shared-database shape: real
-- tenant data (sites, pages, audit results, schedules) that now belongs
-- exclusively in each organisation's own tenant database
-- (prisma/tenant/schema.prisma), never in the shared central one.
--
-- Confirmed dead here before writing this migration: zero references to
-- centralPrisma.site/.page/.group/.auditRun/.auditResult/.auditIssue/
-- .recommendation/.schedule/.notificationSetting/.runLogEvent/.groupAlias/
-- .keyValue anywhere in the live application code. RateLimitBucket is the
-- one exception kept in the central schema -- see its own doc comment.
--
-- CASCADE handles the foreign-key ordering between these tables
-- automatically (AuditIssue/Recommendation -> AuditResult -> Page/AuditRun
-- -> Site, etc.), so this does not need to drop them in dependency order
-- by hand.
DROP TABLE IF EXISTS "AuditIssue" CASCADE;
DROP TABLE IF EXISTS "Recommendation" CASCADE;
DROP TABLE IF EXISTS "AuditResult" CASCADE;
DROP TABLE IF EXISTS "AuditRun" CASCADE;
DROP TABLE IF EXISTS "NotificationSetting" CASCADE;
DROP TABLE IF EXISTS "Schedule" CASCADE;
DROP TABLE IF EXISTS "GroupAlias" CASCADE;
DROP TABLE IF EXISTS "Page" CASCADE;
DROP TABLE IF EXISTS "Group" CASCADE;
DROP TABLE IF EXISTS "Site" CASCADE;
DROP TABLE IF EXISTS "RunLogEvent" CASCADE;
DROP TABLE IF EXISTS "KeyValue" CASCADE;
