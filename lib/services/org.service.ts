import { centralPrisma } from '../db/central.ts';
import { decryptSecret } from '../crypto/secretBox.ts';
import { NotFoundError } from '../errors.ts';
import type { D1Credentials } from '../blob.ts';

/**
 * The provisioning half of Organization -- see docs/DECISIONS.md §19.
 * Deliberately its own file rather than added to tenant.service.ts: this is
 * central-database data (an org's OWN connection details), not the tenant
 * data tenant.service.ts resolves access to. tenant.service.ts's
 * emailConfigForOrg/orgEmailRef stay where they are for now -- moving them
 * here too is the Phase 5 cutover's job, not this one's.
 */

export type ProvisionStatus = 'unprovisioned' | 'provisioning' | 'ready' | 'failed';

function isProvisionStatus(v: unknown): v is ProvisionStatus {
  return v === 'unprovisioned' || v === 'provisioning' || v === 'ready' || v === 'failed';
}

/** What the Settings → Database form needs to render -- presence only, never a secret. */
export interface ProvisionRef {
  status: ProvisionStatus;
  error: string | null;
  provisionedAt: string | null;
  hasNeonUrl: boolean;
  hasD1Credentials: boolean;
}

export async function provisionRefFor(organizationId: string): Promise<ProvisionRef> {
  const org = await centralPrisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      provisionStatus: true,
      provisionError: true,
      provisionedAt: true,
      tenantDbUrlEnc: true,
      d1AccountIdEnc: true,
      d1DatabaseIdEnc: true,
      d1ApiTokenEnc: true,
    },
  });
  if (!org) throw new NotFoundError('Organization');

  return {
    status: isProvisionStatus(org.provisionStatus) ? org.provisionStatus : 'unprovisioned',
    error: org.provisionError,
    provisionedAt: org.provisionedAt?.toISOString() ?? null,
    hasNeonUrl: Boolean(org.tenantDbUrlEnc),
    hasD1Credentials: Boolean(org.d1AccountIdEnc && org.d1DatabaseIdEnc && org.d1ApiTokenEnc),
  };
}

/**
 * This organisation's own D1 credentials, decrypted -- server-side only,
 * for lib/blob.ts's callers once they're threaded through (a later phase).
 * Null when not yet set, the same "fall back to the shared default" shape
 * psiKeyForSite/emailConfigForOrg already use -- lib/blob.ts's own optional
 * `creds` parameter is what actually applies that fallback.
 */
export async function d1CredentialsForOrg(organizationId: string): Promise<D1Credentials | null> {
  const org = await centralPrisma.organization.findUnique({
    where: { id: organizationId },
    select: { d1AccountIdEnc: true, d1DatabaseIdEnc: true, d1ApiTokenEnc: true },
  });
  if (!org?.d1AccountIdEnc || !org.d1DatabaseIdEnc || !org.d1ApiTokenEnc) return null;

  return {
    accountId: decryptSecret(org.d1AccountIdEnc, `${organizationId}:d1AccountId`),
    databaseId: decryptSecret(org.d1DatabaseIdEnc, `${organizationId}:d1DatabaseId`),
    apiToken: decryptSecret(org.d1ApiTokenEnc, `${organizationId}:d1ApiToken`),
  };
}
