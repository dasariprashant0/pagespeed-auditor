import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/http/auth-guard';
import { centralPrisma } from '@/lib/db/central';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { McpTokenManager } from '@/components/settings/McpTokenManager';
import { can } from '@/lib/auth/roles';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function AgentAccessPage() {
  const ctx = await requireSession();
  const tokens = await centralPrisma.mcpToken.findMany({
    where: { organizationId: ctx.organizationId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  });

  return (
    <>
      <PageHeader crumbs={[{ label: 'Overview', href: '/' }, { label: 'Settings' }]} title="Agent access" subtitle="Tokens for AI agents using the MCP server" />
      <SettingsNav active="/settings/agents" />
      <div className="max-w-2xl">
        <McpTokenManager
          endpoint={`${getEnv().APP_URL}/api/mcp`}
          tokens={tokens.map((t) => ({
            id: t.id,
            label: t.label,
            createdAt: t.createdAt.toISOString(),
            lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
          }))}
          canEdit={can(ctx.role, 'developer:access')}
        />
      </div>
    </>
  );
}
