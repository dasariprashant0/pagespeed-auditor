import { spawn } from 'node:child_process';
import { logger } from '../logger.ts';
import { getEnv } from '../env.ts';
import { SYSTEM_PROMPT } from './prompt.ts';

/**
 * Where recommendations come from.
 *
 * Two adapters because this deployment has no ANTHROPIC_API_KEY but does have
 * Claude Code signed in, and the user asked whether the subscription could be
 * used the way Ship Studio does. Both are real; the tradeoffs differ.
 */
export type ProviderName = 'anthropic-sdk' | 'claude-cli' | 'none';

export interface RecommendationProvider {
  name: ProviderName;
  model: string;
  generate(prompt: string): Promise<string>;
}

/**
 * Picks whatever this machine can actually do.
 *
 * An explicit RECOMMENDATION_PROVIDER always wins, so the choice is
 * configuration rather than a surprise that changes when a key appears.
 */
export function resolveProvider(): RecommendationProvider {
  const forced = process.env.RECOMMENDATION_PROVIDER as ProviderName | undefined;

  if (forced === 'claude-cli') return claudeCliProvider();
  if (forced === 'anthropic-sdk') return anthropicProvider();
  if (forced === 'none') return noneProvider();

  // The SDK also picks up an `ant auth login` profile with no env var set, but
  // that cannot be detected without constructing a client, so an explicit key
  // is the only thing auto-detection trusts.
  if (getEnv().ANTHROPIC_API_KEY) return anthropicProvider();
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.RECOMMENDATION_ALLOW_CLI === '1') return claudeCliProvider();
  return claudeCliProvider();
}

function noneProvider(): RecommendationProvider {
  return {
    name: 'none',
    model: 'none',
    async generate() {
      throw new Error('Recommendations are disabled (RECOMMENDATION_PROVIDER=none).');
    },
  };
}

/** The plain API path: one request, one response, billed per token. */
function anthropicProvider(): RecommendationProvider {
  const model = getEnv().ANTHROPIC_MODEL;
  return {
    name: 'anthropic-sdk',
    model,
    async generate(prompt: string) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      // Zero-arg: resolves ANTHROPIC_API_KEY, then an `ant auth login` profile.
      const client = new Anthropic();
      const res = await client.messages.create({
        model,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });
      // content is a discriminated union; narrow before reading .text.
      return res.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
    },
  };
}

/**
 * Runs the locally signed-in Claude Code CLI in headless mode.
 *
 * Uses the Claude subscription rather than per-token API billing, which is what
 * makes it work here at all. Two honest costs: it shares the same usage limits
 * as interactive Claude Code, so a burst of generations can lock the operator
 * out of their own editor; and it spawns a process per request, which is far
 * heavier than an HTTP call. Fine for on-demand, cached generation; it is not
 * something to run per page during a sweep.
 */
function claudeCliProvider(): RecommendationProvider {
  const bin = process.env.CLAUDE_CLI_PATH ?? 'claude';
  return {
    name: 'claude-cli',
    model: 'claude-code-cli',
    generate(prompt: string) {
      return new Promise<string>((resolve, reject) => {
        const child = spawn(bin, ['-p', '--append-system-prompt', SYSTEM_PROMPT], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: process.env,
        });

        let out = '';
        let err = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('claude CLI timed out after 120s'));
        }, 120_000);

        child.stdout.on('data', (d) => (out += String(d)));
        child.stderr.on('data', (d) => (err += String(d)));
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(new Error(`could not run "${bin}": ${e.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            logger.error({ code, err: err.slice(0, 400) }, 'claude CLI failed');
            reject(new Error(err.trim().slice(0, 300) || `claude CLI exited ${code}`));
            return;
          }
          resolve(out.trim());
        });

        child.stdin.write(prompt);
        child.stdin.end();
      });
    },
  };
}
