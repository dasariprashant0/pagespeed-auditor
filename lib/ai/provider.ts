import Anthropic from '@anthropic-ai/sdk';
import { getEnv } from '../env.ts';
import { SYSTEM_PROMPT } from './prompt.ts';

/**
 * Where recommendations come from: the Anthropic API, with the organisation's
 * own key from Settings → Site. No key, no AI -- every AI surface is hidden
 * (see aiKeyForOrg). The env-key and Claude-CLI fallbacks this used to have
 * were removed 11 Nov 2026: AI is now opt-in per organisation.
 */
export interface RecommendationProvider {
  model: string;
  generate(prompt: string): Promise<string>;
}

export function anthropicProvider(apiKey: string): RecommendationProvider {
  const model = getEnv().ANTHROPIC_MODEL;
  return {
    model,
    async generate(prompt: string) {
      const res = await new Anthropic({ apiKey }).messages.create({
        model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });
      if (res.stop_reason === 'refusal') throw new Error('The model declined to answer this one. Try regenerating.');
      // content is a discriminated union; narrow before reading .text.
      return res.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
    },
  };
}

/**
 * Checks a key before it is saved, the same reason the PSI key is probed:
 * a wrong key should fail in Settings, not on someone's first "Generate".
 * Listing models costs no tokens.
 */
export async function verifyAnthropicKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 }).models.list({ limit: 1 });
    return { ok: true };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, message: 'Anthropic rejected that key.' };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, message: 'That key does not have API access.' };
    if (e instanceof Anthropic.APIError) return { ok: false, message: `Anthropic returned ${e.status}: ${e.message}` };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
