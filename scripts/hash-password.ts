/**
 * Prints a bcrypt hash for AUTH_PASSWORD_HASH.
 *
 *   npm run hash-password -- 'your-password'
 *
 * Cost 12 is deliberate. argon2id is the stronger algorithm but needs node-gyp
 * or platform binaries, which is real Docker/CI friction for a credential this
 * team checks a handful of times a day. Don't "upgrade" it without reading
 * docs/DECISIONS.md first.
 */
import bcrypt from 'bcryptjs';

const COST = 12;

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: npm run hash-password -- 'your-password'");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error(`Refusing: ${password.length} chars. Use at least 12 — this is the only credential on the tool.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, COST);
  console.log('\nAdd this to .env (note the single quotes — the hash contains $):\n');
  console.log(`AUTH_PASSWORD_HASH='${hash}'\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
