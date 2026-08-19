/**
 * Sets the login password: hashes it and writes AUTH_PASSWORD_HASH straight
 * into .env, so there is nothing to copy by hand.
 *
 *   npm run set-password -- 'your-password'
 *
 * The password itself is never printed or stored -- only the bcrypt hash.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';

const COST = 12;
const ENV_FILE = '.env';

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("\n  Usage: npm run set-password -- 'your-password'\n");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error(`\n  Refusing: ${password.length} characters. Use at least 12 —\n  this is the only credential protecting the tool.\n`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, COST);

  let env = readFileSync(ENV_FILE, 'utf8');
  // The $ signs must be escaped. Next loads .env through dotenv-expand, which
  // would otherwise read `$2b` and `$12` as variable references and silently
  // shorten the hash. lib/env.ts unescapes for the loaders that don't.
  const line = `AUTH_PASSWORD_HASH='${hash.replace(/\$/g, '\\$')}'`;
  env = /^AUTH_PASSWORD_HASH=.*$/m.test(env)
    ? env.replace(/^AUTH_PASSWORD_HASH=.*$/m, line)
    : `${env.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_FILE, env);

  const username = /^AUTH_USERNAME=(.*)$/m.exec(env)?.[1]?.trim() || 'admin';
  console.log(`\n  Password set for user "${username}".`);
  console.log('  Restart the dev server for it to take effect.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
