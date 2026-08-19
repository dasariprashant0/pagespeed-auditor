/**
 * Reads and writes .env without needing to find it.
 *
 * .env is a dotfile AND gitignored -- deliberately, so the API key is never
 * committed -- which means it is invisible in Finder and in any git-backed file
 * browser. Nobody should have to go hunting for a hidden file to finish setup.
 *
 *   npm run env                        # show everything, secrets masked
 *   npm run env -- SMTP_PASS abcd1234  # set one value
 *   npm run env -- SLACK_WEBHOOK_URL https://hooks.slack.com/...
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILE = '.env';

/** Values never printed in full, even to the person who set them. */
const SECRETS = [/PASS/i, /SECRET/i, /_KEY$/i, /TOKEN/i, /WEBHOOK/i];

function isSecret(key: string): boolean {
  return SECRETS.some((re) => re.test(key));
}

function mask(key: string, value: string): string {
  if (!value) return '(empty)';
  if (!isSecret(key)) return value;
  return value.length <= 8 ? '••••••••' : `${value.slice(0, 4)}${'•'.repeat(8)}${value.slice(-4)}`;
}

function main() {
  if (!existsSync(FILE)) {
    console.error(`\n  No ${FILE} here. Copy it from the template:  cp .env.example .env\n`);
    process.exit(1);
  }

  const [key, ...rest] = process.argv.slice(2);
  const raw = readFileSync(FILE, 'utf8');

  if (!key) {
    console.log(`\n  ${FILE} (secrets masked)\n`);
    for (const line of raw.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const val = m[2].replace(/^['"]|['"]$/g, '');
      console.log(`    ${m[1].padEnd(24)} ${mask(m[1], val)}`);
    }
    console.log(`\n  Set one:  npm run env -- KEY value`);
    console.log(`  Open it:  open -e ${FILE}\n`);
    return;
  }

  const value = rest.join(' ').trim();
  if (!value) {
    console.error(`\n  Usage: npm run env -- ${key} <value>\n`);
    process.exit(1);
  }

  // Escaped so dotenv-expand cannot eat a '$' -- the bug that silently
  // truncated the bcrypt hash and broke login.
  const escaped = value.replace(/\$/g, '\\$');
  const needsQuotes = /\s/.test(value);
  const line = `${key}=${needsQuotes ? `"${escaped}"` : escaped}`;

  const next = new RegExp(`^${key}=.*$`, 'm').test(raw)
    ? raw.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : `${raw.trimEnd()}\n${line}\n`;

  writeFileSync(FILE, next);
  console.log(`\n  ${key} set to ${mask(key, value)}`);
  console.log('  Restart the dev server and worker for it to take effect.\n');
}

main();
