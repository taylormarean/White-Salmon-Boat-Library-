#!/usr/bin/env node
// Bootstrap the first admin account. Generates the same PBKDF2 "salt:hash" the
// Worker verifies, and prints the SQL to run against D1.
//
// Usage: node scripts/create-admin.mjs admin@example.com "Admin Name" "password"
//   then: wrangler d1 execute wsbl-db --remote --command "<printed SQL>"

import { webcrypto as crypto } from 'node:crypto';

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error('Usage: node scripts/create-admin.mjs <email> <display name> <password>');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Password must be at least 6 characters');
  process.exit(1);
}

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, 256);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const stored = `${hex(salt.buffer)}:${hex(bits)}`;

const username = email.trim().toLowerCase();
const sql = `INSERT INTO users (username, password_hash, display_name, role) VALUES ('${username.replace(/'/g, "''")}', '${stored}', '${name.replace(/'/g, "''")}', 'admin') ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin';`;

console.log('\nRun this against your D1 database:\n');
console.log(`wrangler d1 execute wsbl-db --remote --command "${sql.replace(/"/g, '\\"')}"`);
console.log('\n(drop --remote to target local dev)');
