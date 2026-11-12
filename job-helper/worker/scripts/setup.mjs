#!/usr/bin/env node
// One-command setup / update for Next Chapter. Run from job-helper/worker:  npm run setup
// Safe to run again: it keeps what's already configured and only asks for what's missing.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(here, '..');
const frontendDir = path.resolve(workerDir, '../frontend');
const tomlPath = path.join(workerDir, 'wrangler.toml');
const win = process.platform === 'win32';
const DB = 'next-chapter-db';

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const step = (n, s) => console.log(`\n${bold(`${n}.`)} ${bold(s)}`);
const ok = (s) => console.log(`   ${green('✓')} ${s}`);

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

const appUrl = (readFileSync(tomlPath, 'utf8').match(/APP_URL\s*=\s*"([^"]+)"/)?.[1] ?? '').replace(/\/$/, '');
const domain = appUrl ? new URL(appUrl).host : '';

async function main() {
  console.log(bold('\n🌱 Next Chapter setup\n'));
  console.log(`This puts the app on your Cloudflare account${domain ? ` at ${bold(appUrl)}` : ''} and stores your keys as encrypted Cloudflare secrets.`);

  // ---------------------------------------------------------------- 1. Cloudflare login
  step(1, 'Cloudflare account');
  let who = '';
  try { who = wrangler(['whoami']); } catch { /* not logged in */ }
  if (!/associated with the email|You are logged in/i.test(who)) {
    console.log('   A browser window will open — log in to Cloudflare (or create a free account).');
    live('npx', ['wrangler', 'login']);
  } else ok('already logged in');

  // ---------------------------------------------------------------- 2. database
  step(2, 'Database');
  let toml = readFileSync(tomlPath, 'utf8');
  if (toml.includes('PASTE_YOUR_D1_ID_HERE')) {
    let id = null;
    try {
      const out = wrangler(['d1', 'create', DB]);
      id = out.match(/database_id"?\s*[=:]\s*"([0-9a-f-]{36})"/)?.[1] ?? null;
    } catch { /* probably exists already */ }
    if (!id) id = JSON.parse(wrangler(['d1', 'list', '--json'])).find((d) => d.name === DB)?.uuid ?? null;
    if (!id) throw new Error(`Could not create or find the D1 database "${DB}".`);
    toml = toml.replace('PASTE_YOUR_D1_ID_HERE', id);
    writeFileSync(tomlPath, toml);
    ok(`created database ${dim(id)}`);
  } else ok('database already configured');

  // The single-user version (v1) stored data differently. Upgrading means starting the database fresh.
  let cols = [];
  try {
    const out = JSON.parse(wrangler(['d1', 'execute', DB, '--remote', '--json', '--command', "SELECT name FROM pragma_table_info('settings')"]));
    cols = (out[0]?.results ?? []).map((r) => r.name);
  } catch { /* table doesn't exist yet */ }
  if (cols.length && !cols.includes('user_id')) {
    console.log(yellow('\n   This database is from the single-user version of Next Chapter.'));
    console.log('   The business version gives every person their own private account, so the database has to start fresh.');
    console.log('   Her documents, jobs, and applications in the old version will be removed (she just signs in and sets up again).');
    if (!(await yes('Start the database fresh now?', false))) throw new Error('Stopped — nothing was changed. Run again when you’re ready to upgrade.');
    const tables = ['inbox_seen', 'outbox', 'app_events', 'applications', 'jobs', 'documents', 'voice_examples', 'feedback', 'activity_log', 'settings', 'users'];
    wrangler(['d1', 'execute', DB, '--remote', '--yes', '--command', tables.map((t) => `DROP TABLE IF EXISTS ${t};`).join(' ')]);
    ok('old tables removed');
  }
  wrangler(['d1', 'execute', DB, '--remote', '--file=schema.sql', '--yes']);
  ok('tables ready');

  // ---------------------------------------------------------------- 3. build + deploy
  step(3, 'Building and publishing the app');
  live('npm', ['install', '--no-audit', '--no-fund'], frontendDir);
  live('npm', ['run', 'build'], frontendDir);
  const findWorkersDev = (out) => out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
  let deployOut = '';
  let onDomain = false;
  const deploy = (args = []) => { try { return { ok: true, out: wrangler(['deploy', ...args]) } } catch (e) { return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; } };
  let r = deploy();
  if (!r.ok && /workers\.dev subdomain|register/i.test(r.out)) {
    console.log('   Cloudflare needs one answer from you (your workers.dev name):');
    try { live('npx', ['wrangler', 'deploy']); } catch { /* the domain may not be ready yet — handled below */ }
    r = deploy();
  }
  if (r.ok) {
    deployOut = r.out;
    onDomain = !!domain && deployOut.includes(domain);
  } else if (domain && /zone|custom domain|could not find|not found|DNS/i.test(r.out)) {
    // The domain isn't on this Cloudflare account yet — publish on workers.dev for now.
    console.log(yellow(`\n   ${domain} isn’t connected to your Cloudflare account yet.`));
    console.log(`   To connect it (one time, ~10 minutes + waiting for DNS):
     a. Open https://dash.cloudflare.com → ${bold('Add a domain')} → type ${bold(domain)} → Free plan.
     b. Cloudflare shows two ${bold('nameservers')}. At the company where you bought the domain, replace its nameservers with those two.
        (If you bought it at Cloudflare, it's already done — skip this.)
     c. Wait until Cloudflare says the domain is ${bold('Active')} (often minutes, up to a day), then run ${bold('npm run setup')} again.
   Meanwhile I'll publish the app at your workers.dev address so you can try it.`);
    const tmp = path.join(workerDir, 'wrangler.nodomain.toml');
    writeFileSync(tmp, readFileSync(tomlPath, 'utf8').replace(/routes = \[[\s\S]*?\]\n/, ''));
    try {
      deployOut = wrangler(['deploy', '-c', tmp]);
    } finally {
      unlinkSync(tmp);
    }
  } else {
    console.log(r.out);
    throw new Error('Publishing failed — see the message above.');
  }
  const url = onDomain ? appUrl : findWorkersDev(deployOut);
  if (!url) {
    console.log(deployOut);
    throw new Error('Published, but could not find the app address in the output above.');
  }
  ok(`live at ${bold(url)}${onDomain ? '' : dim('  (temporary address until the domain is connected)')}`);
  const publicUrl = onDomain ? appUrl : url;

  // ---------------------------------------------------------------- 4. keys
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
  } else ok('Claude API key already saved');

  if ((!has('ADMIN_EMAILS') && !has('ALLOWED_EMAILS')) || await yes('Change who is the owner (admin) / who has a free account?', false)) {
    console.log(dim('   Anyone can sign up and pay. These lists just mark special accounts.'));
    secrets.ADMIN_EMAILS = (await ask('Your Google email (you’ll see the Admin dashboard)')).toLowerCase();
    secrets.FREE_EMAILS = (await ask('Free accounts — your mom’s Gmail (comma-separate to add more)')).toLowerCase();
  } else ok('owner and free accounts already set');

  if (!has('GOOGLE_CLIENT_ID') || await yes('Replace the Google sign-in keys?', false)) {
    console.log(`
   ${bold('Google sign-in')} — one-time, about 15 minutes, in your browser (https://console.cloud.google.com):
     a. Create a project named "Next Chapter".
     b. ${bold('APIs & Services → Library')}: enable the ${bold('Gmail API')} and the ${bold('Google Calendar API')}.
     c. ${bold('Google Auth Platform → Branding')}: app name "Next Chapter", support email, logo optional,
        App home page: ${bold(`${publicUrl}/`)}
        Privacy policy: ${bold(`${publicUrl}/privacy.html`)}
        Terms of service: ${bold(`${publicUrl}/terms.html`)}
        Authorized domain: ${bold(domain || new URL(publicUrl).host)}
     d. ${bold('Audience')}: External.  ${bold('Data access')}: add scopes gmail.send, gmail.readonly, calendar.events, calendar.freebusy.
     e. ${bold('Clients → Create client → Web application')}. Authorized redirect URIs — add exactly:
          ${bold(`${publicUrl}/api/google/callback`)}${!onDomain && domain ? `\n          ${bold(`${appUrl}/api/google/callback`)}   ${dim('(add this now too, for when the domain is live)')}` : ''}
     f. ${bold('Audience → Publish app')} ("In production"). Up to 100 people can use it right away; they'll see a
        "Google hasn’t verified this app" screen (Advanced → Go to Next Chapter). To remove that screen and open it to
        everyone, click ${bold('Prepare for verification')} — Google reviews the app, and because it reads Gmail it also
        requires an annual third-party security assessment (CASA). The app keeps new sign-ups on a waitlist past 100.
   Then copy the client's ID and secret here:`);
    secrets.GOOGLE_CLIENT_ID = await ask('Client ID (ends in .apps.googleusercontent.com)');
    secrets.GOOGLE_CLIENT_SECRET = await ask('Client secret', { hidden: true });
  } else ok('Google sign-in keys already saved');

  if (!has('STRIPE_SECRET_KEY') ? await yes('Set up payments (Stripe) now? You can skip and add later', true) : await yes('Replace the Stripe keys?', false)) {
    console.log(`
   ${bold('Stripe')} (https://dashboard.stripe.com):
     a. Activate your account (business details; website ${bold(publicUrl)}).
     b. ${bold('Connect')} → Get started → choose ${bold('Express')} accounts (this pays referral earnings to people's banks).
     c. ${bold('Developers → API keys')}: copy the ${bold('Secret key')} (sk_live_… — or sk_test_… to try it first).
     d. ${bold('Developers → Webhooks → Add endpoint')}: URL ${bold(`${publicUrl}/api/webhook/stripe`)}
        Events: checkout.session.completed, charge.refunded, transfer.reversed — and under "Connected accounts": account.updated.
        Copy the ${bold('Signing secret')} (whsec_…).`);
    secrets.STRIPE_SECRET_KEY = await ask('Stripe secret key', { hidden: true });
    secrets.STRIPE_WEBHOOK_SECRET = await ask('Webhook signing secret', { hidden: true });
  }

  if (!has('RESEND_API_KEY') && await yes('Set up system email (alerts, helper invites, weekly summaries) with Resend?', true)) {
    console.log(`   Create a free account at https://resend.com → ${bold('Domains')} → add ${bold(domain || 'your domain')} and add the DNS records it shows
   in Cloudflare (DNS tab). Then ${bold('API Keys')} → Create.`);
    secrets.RESEND_API_KEY = await ask('Resend API key', { hidden: true });
    secrets.ALERT_FROM_EMAIL = await ask('Send alerts from', { fallback: `alerts@${domain || 'example.com'}` });
  }

  if (!has('TWILIO_ACCOUNT_SID') && await yes('Set up optional daily text messages (Twilio)?', false)) {
    console.log(dim('   Note: US business texting requires registering your brand and campaign (A2P 10DLC) in Twilio first.'));
    secrets.TWILIO_ACCOUNT_SID = await ask('Twilio Account SID');
    secrets.TWILIO_AUTH_TOKEN = await ask('Twilio Auth Token', { hidden: true });
    secrets.TWILIO_FROM = await ask('Twilio phone number (e.g. +15095550100)');
  }

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

  if (!has('JOOBLE_API_KEY') && await yes('Add Jooble (free — local listings gathered from many job sites)?', false)) {
    console.log(dim('   Request a key at https://jooble.org/api/about (it arrives by email).'));
    const jk = await ask('Jooble API key', { hidden: true });
    if (jk) secrets.JOOBLE_API_KEY = jk;
  }

  if (!has('SERPAPI_KEY') && await yes('Add Google Jobs (covers LinkedIn, Indeed, ZipRecruiter, Monster, Glassdoor — paid)?', false)) {
    console.log(dim('   Sign up at https://serpapi.com (from $75/month for 5,000 searches; 100 free searches to try it).'));
    console.log(dim('   Each customer uses about 4 searches a day; that cost is charged to their credit like AI use.'));
    console.log(dim('   Copy "Your Private API Key" from https://serpapi.com/manage-api-key'));
    const sk = await ask('SerpApi key', { hidden: true });
    if (sk) secrets.SERPAPI_KEY = sk;
  }

  for (const k of Object.keys(secrets)) if (!secrets[k]) delete secrets[k];
  if (Object.keys(secrets).length) {
    // Piped through stdin — the values never touch the disk.
    wrangler(['secret', 'bulk'], { input: JSON.stringify(secrets) });
    ok(`saved ${Object.keys(secrets).length} secret${Object.keys(secrets).length === 1 ? '' : 's'}: ${Object.keys(secrets).join(', ')}`);
  }

  // ---------------------------------------------------------------- done
  console.log(`
${green(bold('All set!'))}

  Your app: ${bold(publicUrl)}${onDomain ? '' : yellow(`   (will move to ${appUrl} once the domain is connected — run setup again then)`)}
  Send your mom the link. She taps ${bold('Get started with Google')}, allows Gmail, answers a few questions, and the app does the rest.
  You'll see the ${bold('Admin')} page in the menu once you sign in with your own Google account.

  To update the app later: pull the new code and run ${bold('npm run setup')} again (it skips what's done).
  To watch it work:         ${bold('npx wrangler tail')}
`);
}

main().then(() => rl.close()).catch((e) => {
  console.error(`\n❌ ${e.message}`);
  rl.close();
  process.exit(1);
});
