// Create a login. Usage:
//   node scripts/create-user.mjs mom@example.com "Linda" 'a-good-password' [--remote]
// Prints and runs the wrangler D1 command that inserts the user.
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';

const [email, name, password, flag] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error('Usage: node scripts/create-user.mjs <email> <name> <password> [--remote]');
  process.exit(1);
}
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const hash = `${hex(salt)}:${hex(bits)}`;
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const sql = `INSERT INTO users (email, name, password_hash) VALUES (${q(email.toLowerCase())}, ${q(name)}, ${q(hash)}) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name;`;
const args = ['wrangler', 'd1', 'execute', 'next-chapter-db', flag === '--remote' ? '--remote' : '--local', '--command', sql];
execFileSync('npx', args, { stdio: 'inherit' });
console.log(`User ${email} ready.`);
