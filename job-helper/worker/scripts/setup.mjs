#!/usr/bin/env node
// One-command setup / update for Next Chapter. Run from job-helper/worker:  npm run setup
// Safe to run again: it keeps what's already configured and only asks for what's missing.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(here, '..');
const frontendDir = path.resolve(workerDir, '../frontend');
const tomlPath = path.join(workerDir, 'wrangler.toml');
const win = process.platform === 'win32';

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const step = (n, s) => console.log(`\n${bold(`${n}.`)} ${bold(s)}`);

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: workerDir, encoding: 'utf8', shell: win, stdio: opts.stdio ?? ['pipe', 'pipe', 'pipe'], input: opts.input, env: { ...process.env, ...opts.env } });
}
function wrangler(args, opts = {}) {
  return run('npx', ['wrangler', ...args], opts);
}
function live(cmd, args, cwd = workerDir) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
rl._writeToOutput = (s) => { if (!muted || s.includes('\n')) rl.output.write(muted ? '\n' : s); };
function ask(question, { hidden = false, fallback = '' } = {}) {
  return new Promise((resolve) => {
    rl.question(`   ${question}${fallback ? dim(` [${fallback}]`) : ''}: `, (a) => {
      muted = false;
      resolve(a.trim() || fallback);
    });
    muted = hidden;
  });
}
async function yes(question, def = true) {
  const a = (await ask(`${question} (${def ? 'Y/n' : 'y/N'})`)).toLowerCase();
  return a ? a.startsWith('y') : def;
}

async function main() {
  console.log(bold('\n🌱 Next Chapter setup\n'));
  console.log('This puts the app on your Cloudflare account (free tier is fine) and stores your keys as encrypted Cloudflare secrets.');

  // ---------------------------------------------------------------- 1. Cloudflare login
  step(1, 'Cloudflare account');
  let who = '';
  try { who = wrangler(['whoami']); } catch { /* not logged in */ }
  if (!/associated with the email|You are logged in/i.test(who)) {
    console.log('   A browser window will open — log in to Cloudflare (or create a free account).');
    live('npx', ['wrangler', 'login']);
  } else {
    console.log(`   ${green('✓')} already logged in`);
  }

  // ---------------------------------------------------------------- 2. database
  step(2, 'Database');
  let toml = readFileSync(tomlPath, 'utf8');
  if (toml.includes('PASTE_YOUR_D1_ID_HERE')) {
    let id = null;
    try {
      const out = wrangler(['d1', 'create', 'next-chapter-db']);
      id = out.match(/database_id"?\s*[=:]\s*"([0-9a-f-]{36})"/)?.[1] ?? null;
    } catch { /* probably exists already */ }
    if (!id) {
      const list = JSON.parse(wrangler(['d1', 'list', '--json']));
      id = list.find((d) => d.name === 'next-chapter-db')?.uuid ?? null;
    }
    if (!id) throw new Error('Could not create or find the D1 database "next-chapter-db".');
    toml = toml.replace('PASTE_YOUR_D1_ID_HERE', id);
    writeFileSync(tomlPath, toml);
    console.log(`   ${green('✓')} created database ${dim(id)}`);
  } else {
    console.log(`   ${green('✓')} database already configured`);
  }
  wrangler(['d1', 'execute', 'next-chapter-db', '--remote', '--file=schema.sql', '--yes']);
  console.log(`   ${green('✓')} tables ready`);

  // ---------------------------------------------------------------- 3. build + deploy
  step(3, 'Building and publishing the app');
  live('npm', ['install', '--no-audit', '--no-fund'], frontendDir);
  live('npm', ['run', 'build'], frontendDir);
  const findUrl = (out) => out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
  let deployOut = '';
  try { deployOut = wrangler(['deploy']); } catch (e) { deployOut = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
  if (!findUrl(deployOut)) {
    // First deploy on a new account: Wrangler needs to ask a question (e.g. pick a workers.dev name).
    console.log('   Cloudflare needs one answer from you:');
    live('npx', ['wrangler', 'deploy']);
    deployOut = wrangler(['deploy']);
  }
  const url = findUrl(deployOut);
  if (!url) {
    console.log(deployOut);
    throw new Error('Deployed, but could not find the app address in the output above.');
  }
  console.log(`   ${green('✓')} live at ${bold(url)}`);

  // ---------------------------------------------------------------- 4. secrets
  step(4, 'Keys and settings');
  let existing = [];
  try { existing = JSON.parse(wrangler(['secret', 'list', '--format', 'json'])).map((s) => s.name); } catch { /* none yet */ }
  const has = (n) => existing.includes(n);
  const secrets = {};

  if (!has('JWT_SECRET')) secrets.JWT_SECRET = randomBytes(32).toString('hex');
  if (!has('TOKEN_ENC_KEY')) secrets.TOKEN_ENC_KEY = randomBytes(32).toString('hex');

  if (!has('ANTHROPIC_API_KEY') || await yes('Replace the saved Claude API key?', false)) {
    console.log(dim('   Get one at https://console.anthropic.com/settings/keys — it won’t be shown as you paste it.'));
    let key = '';
    while (!key.startsWith('sk-ant-')) {
      key = await ask('Claude API key', { hidden: true });
      if (!key.startsWith('sk-ant-')) console.log('   That doesn’t look like a Claude key (they start with sk-ant-). Try again.');
    }
    secrets.ANTHROPIC_API_KEY = key;
  } else console.log(`   ${green('✓')} Claude API key already saved`);

  if (!has('ALLOWED_EMAILS') || await yes('Change who can sign in?', false)) {
    console.log(dim('   Only these Google accounts can sign in. Put your mom’s Gmail FIRST — that’s the account applications are sent from.'));
    const mom = (await ask('Your mom’s Gmail address')).toLowerCase();
    const extra = (await ask('Anyone else who helps (your email, comma-separated, or Enter to skip)')).toLowerCase();
    secrets.ALLOWED_EMAILS = [mom, ...extra.split(/[\s,;]+/)].filter(Boolean).join(',');
  } else console.log(`   ${green('✓')} sign-in list already saved`);

  if (!has('GOOGLE_CLIENT_ID') || await yes('Replace the Google sign-in keys?', false)) {
    console.log(`
   ${bold('Google sign-in')} — one-time, about 10 minutes, in your browser:
     a. Open https://console.cloud.google.com/projectcreate and create a project (any name, e.g. "Next Chapter").
     b. Open https://console.cloud.google.com/apis/library/gmail.googleapis.com and click ${bold('Enable')}.
     c. Open https://console.cloud.google.com/auth/branding — app name "Next Chapter", your email as support + developer contact.
        Audience: ${bold('External')}.
     d. Open https://console.cloud.google.com/auth/clients → ${bold('Create client')} → type ${bold('Web application')}.
        Under "Authorized redirect URIs" add exactly:
          ${bold(`${url}/api/google/callback`)}
     e. Open https://console.cloud.google.com/auth/audience and click ${bold('Publish app')} (→ "In production").
        ${dim('Skip this and Google disconnects her Gmail every 7 days. No Google review is needed for family use;')}
        ${dim('she’ll see a "Google hasn’t verified this app" screen once — click Advanced → Go to Next Chapter.')}
   Then copy the client's ID and secret here:`);
    secrets.GOOGLE_CLIENT_ID = await ask('Client ID (ends in .apps.googleusercontent.com)');
    secrets.GOOGLE_CLIENT_SECRET = await ask('Client secret', { hidden: true });
  } else console.log(`   ${green('✓')} Google sign-in keys already saved`);

  if (!has('ADZUNA_APP_ID') && await yes('Add optional extra local job sources (Adzuna / USAJobs, both free)?', false)) {
    console.log(dim('   Adzuna keys: https://developer.adzuna.com/ — press Enter to skip any.'));
    const aid = await ask('Adzuna app ID');
    const akey = aid ? await ask('Adzuna app key', { hidden: true }) : '';
    if (aid && akey) Object.assign(secrets, { ADZUNA_APP_ID: aid, ADZUNA_APP_KEY: akey });
    console.log(dim('   USAJobs key: https://developer.usajobs.gov/apikey-request/'));
    const ukey = await ask('USAJobs API key', { hidden: true });
    const uemail = ukey ? await ask('Email you registered the USAJobs key with') : '';
    if (ukey && uemail) Object.assign(secrets, { USAJOBS_API_KEY: ukey, USAJOBS_EMAIL: uemail });
  }

  if (Object.keys(secrets).length) {
    // Piped through stdin — the values never touch the disk.
    wrangler(['secret', 'bulk'], { input: JSON.stringify(secrets) });
    console.log(`   ${green('✓')} saved ${Object.keys(secrets).length} secret${Object.keys(secrets).length === 1 ? '' : 's'}: ${Object.keys(secrets).join(', ')}`);
  }

  // ---------------------------------------------------------------- done
  console.log(`
${green(bold('All set!'))}

  Send your mom this link:  ${bold(url)}
  She taps ${bold('Sign in with Google')}, allows access to her Gmail, and the app sets itself up:
  it reads her sent emails and any resumes she’s emailed before, learns her voice, and runs the first job search.

  To update the app later: pull the new code and run ${bold('npm run setup')} again (it skips what's done).
  To watch it work:         ${bold('npx wrangler tail')}
`);
}

main().then(() => rl.close()).catch((e) => {
  console.error(`\n❌ ${e.message}`);
  rl.close();
  process.exit(1);
});
