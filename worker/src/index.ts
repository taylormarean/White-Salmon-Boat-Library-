// White Salmon Boat Library — Worker API
// Router structure, auth gating, CORS/security headers, and cron dispatch all
// follow the Gorge rides fleet platform (fleet-app/worker/src/index.ts):
// explicit public-route whitelist, requireStaff/requireAdmin helpers, JWT
// checked on everything else.

import { handleLogin, handleVerify, handleChangePassword, checkJWTAuth, hasRoleRequest, isAdminRequest, getRequestJwtPayload } from './lib/auth';
import { handleJoin, handleMe, handleMembers } from './routes/members';
import { handleGear } from './routes/gear';
import { handleCheckouts } from './routes/checkouts';
import { handleShifts } from './routes/shifts';
import { handleIncidents } from './routes/incidents';
import { handleAdmin, handlePublicInfo } from './routes/admin';
import { handleDashboard } from './routes/dashboard';
import { sendGearReminders } from './routes/reminders';
import { handleDonate, handleStripeWebhook, handleDonationsList } from './routes/donations';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  FRONTEND_URL: string;
  SITE_URL?: string;             // marketing site (donation success/cancel URLs)
  RESEND_API_KEY?: string;       // wrangler secret put RESEND_API_KEY
  FROM_EMAIL?: string;           // verified Resend sender
  JWT_SECRET?: string;           // wrangler secret put JWT_SECRET
  DOOR_CODE_SECRET?: string;     // wrangler secret put DOOR_CODE_SECRET (daily-code derivation)
  STRIPE_SECRET_KEY?: string;    // wrangler secret put STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET?: string; // wrangler secret put STRIPE_WEBHOOK_SECRET (whsec_...)
}

// Staff tier — canonical check (mirrors fleet-app STAFF_ROLES).
const STAFF_ROLES = ['admin', 'librarian'];

const ALLOWED_ORIGINS = [
  'https://whitesalmonboatlibrary.org',
  'https://www.whitesalmonboatlibrary.org',
  'https://wsbl.pages.dev',
  'https://wsbl-demo.pages.dev',
  'https://wsbl-site.pages.dev',
  'http://localhost:3000',
  'http://localhost:5173',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function getCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin') ?? '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function secure(response: Response, corsOrigin: string): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', corsOrigin);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

async function requireStaff(request: Request, env: Env): Promise<Response | null> {
  if (await hasRoleRequest(request, env, STAFF_ROLES)) return null;
  return jsonError('Staff only', 403);
}

async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  if (await isAdminRequest(request, env)) return null;
  return jsonError('Admin only', 403);
}

async function actorOf(request: Request, env: Env): Promise<string> {
  const payload = await getRequestJwtPayload(request, env);
  return payload?.sub ?? 'unknown';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsOrigin = getCorsOrigin(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': corsOrigin, ...CORS_HEADERS, ...SECURITY_HEADERS } });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method;

    // --- Public routes (no token required) — explicit whitelist, fleet-app style ---
    if (path === '/auth/login' && method === 'POST') return secure(await handleLogin(request, env), corsOrigin);
    if (path === '/auth/verify' && method === 'GET') return secure(await handleVerify(request, env), corsOrigin);
    if (path === '/public/join' && method === 'POST') {
      // Rate-limit signups per IP: 5/hour (blocks member-spam + welcome-email abuse)
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const joinKey = `join:${ip}`;
      const joinCount = parseInt((await env.KV.get(joinKey)) ?? '0');
      if (joinCount >= 5) {
        return secure(jsonError('Too many signups from this connection — try again in an hour.', 429), corsOrigin);
      }
      const response = await handleJoin(request, env);
      if (response.status === 200) await env.KV.put(joinKey, String(joinCount + 1), { expirationTtl: 3600 });
      return secure(response, corsOrigin);
    }
    if (path === '/public/info' && method === 'GET') return secure(await handlePublicInfo(env), corsOrigin);
    if (path === '/public/donate' && method === 'POST') return secure(await handleDonate(request, env), corsOrigin);
    if (path === '/webhook/stripe' && method === 'POST') return secure(await handleStripeWebhook(request, env), corsOrigin);
    if (path === '/gear' && method === 'GET') {
      // Public availability browse. Staff callers additionally get inactive
      // gear (all=1) and raw OOS reasons/notes, which can quote member damage
      // reports — everyone else gets a sanitized view.
      const staffCaller = await hasRoleRequest(request, env, STAFF_ROLES);
      if (!staffCaller) url.searchParams.delete('all');
      return secure(await handleGear.list(env, url, staffCaller), corsOrigin);
    }
    if (path === '/gear/categories' && method === 'GET') return secure(await handleGear.categories(env), corsOrigin);

    // Everything else requires a valid JWT.
    if (!(await checkJWTAuth(request, env))) {
      return secure(jsonError('Unauthorized', 401), corsOrigin);
    }

    try {
      let response: Response;
      const actor = () => actorOf(request, env);

      // --- Auth ---
      if (path === '/auth/change-password' && method === 'POST') {
        response = await handleChangePassword(request, env);

      // --- Member self-service ---
      } else if (path === '/me/member' && method === 'GET') {
        response = await handleMe(request, env);
      } else if (path === '/checkouts/self' && method === 'POST') {
        response = await handleCheckouts.selfCheckout(request, env);
      } else if (path.match(/^\/checkouts\/[^/]+\/return$/) && method === 'POST') {
        response = await handleCheckouts.selfReturn(request, env, path.split('/')[2]);

      // --- Shifts (any authed user can view + sign up; staff manage) ---
      } else if (path === '/shifts' && method === 'GET') {
        response = await handleShifts.list(request, env, url);
      } else if (path === '/shifts' && method === 'POST') {
        response = (await requireStaff(request, env)) ?? await handleShifts.create(request, env, await actor());
      } else if (path.match(/^\/shifts\/[^/]+\/signup$/) && method === 'POST') {
        response = await handleShifts.signup(request, env, path.split('/')[2]);
      } else if (path.match(/^\/shifts\/[^/]+\/signup$/) && method === 'DELETE') {
        response = await handleShifts.unsignup(request, env, path.split('/')[2]);
      } else if (path.match(/^\/shifts\/[^/]+$/) && method === 'PUT') {
        response = (await requireStaff(request, env)) ?? await handleShifts.update(request, env, path.split('/')[2], await actor());
      } else if (path.match(/^\/shifts\/[^/]+$/) && method === 'DELETE') {
        response = (await requireStaff(request, env)) ?? await handleShifts.cancel(request, env, path.split('/')[2], await actor());

      // --- Dashboard (staff) ---
      } else if (path === '/dashboard' && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleDashboard(env);

      // --- Gear management (staff; public GET handled above) ---
      } else if (path === '/gear' && method === 'POST') {
        response = (await requireStaff(request, env)) ?? await handleGear.create(request, env, await actor());
      } else if (path === '/gear/maintenance' && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleGear.maintenanceList(env, url);
      } else if (path.match(/^\/gear\/maintenance\/[^/]+$/) && method === 'PUT') {
        response = (await requireStaff(request, env)) ?? await handleGear.maintenanceUpdate(request, env, path.split('/')[3], await actor());
      } else if (path.match(/^\/gear\/[^/]+\/maintenance$/) && method === 'POST') {
        response = (await requireStaff(request, env)) ?? await handleGear.maintenanceCreate(request, env, path.split('/')[2], await actor());
      } else if (path.match(/^\/gear\/[^/]+\/status$/) && method === 'PUT') {
        response = (await requireStaff(request, env)) ?? await handleGear.setStatus(request, env, path.split('/')[2], await actor());
      } else if (path.match(/^\/gear\/[^/]+$/) && method === 'PUT') {
        response = (await requireStaff(request, env)) ?? await handleGear.update(request, env, path.split('/')[2], await actor());

      // --- Members (staff) ---
      } else if (path === '/members' && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleMembers.list(env);
      } else if (path.match(/^\/members\/[^/]+\/status$/) && method === 'PUT') {
        response = (await requireStaff(request, env)) ?? await handleMembers.setStatus(request, env, path.split('/')[2], await actor());
      } else if (path.match(/^\/members\/[^/]+$/) && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleMembers.detail(env, path.split('/')[2]);
      } else if (path.match(/^\/members\/[^/]+$/) && method === 'PUT') {
        response = (await requireStaff(request, env)) ?? await handleMembers.update(request, env, path.split('/')[2], await actor());

      // --- Checkouts (staff ops) ---
      } else if (path === '/checkouts' && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleCheckouts.list(env, url);
      } else if (path === '/checkouts/access-codes' && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleCheckouts.accessCodeLog(env);
      } else if (path === '/checkouts/door-code/today' && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleCheckouts.todayDoorCode(env);
      } else if (path.match(/^\/checkouts\/[^/]+\/extend$/) && method === 'PUT') {
        response = (await requireStaff(request, env)) ?? await handleCheckouts.extend(request, env, path.split('/')[2], await actor());
      } else if (path.match(/^\/checkouts\/[^/]+\/force-return$/) && method === 'POST') {
        response = (await requireStaff(request, env)) ?? await handleCheckouts.forceReturn(request, env, path.split('/')[2], await actor());

      // --- Incidents (staff) ---
      } else if (path === '/incidents' && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleIncidents.list(env, url);
      } else if (path === '/incidents' && method === 'POST') {
        response = (await requireStaff(request, env)) ?? await handleIncidents.create(request, env, await actor());
      } else if (path.match(/^\/incidents\/[^/]+$/) && method === 'PUT') {
        response = (await requireStaff(request, env)) ?? await handleIncidents.update(request, env, path.split('/')[2], await actor());

      // --- Settings + admin ---
      } else if (path === '/settings' && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleAdmin.getSettings(env);
      } else if (path === '/admin/settings' && method === 'PUT') {
        response = (await requireAdmin(request, env)) ?? await handleAdmin.updateSettings(request, env, await actor());
      } else if (path === '/admin/users' && method === 'GET') {
        response = (await requireAdmin(request, env)) ?? await handleAdmin.listUsers(env);
      } else if (path === '/admin/users' && method === 'POST') {
        response = (await requireAdmin(request, env)) ?? await handleAdmin.createUser(request, env, await actor());
      } else if (path.match(/^\/admin\/users\/[^/]+$/) && method === 'PUT') {
        response = (await requireAdmin(request, env)) ?? await handleAdmin.updateUser(request, env, decodeURIComponent(path.split('/')[3]), await actor());
      } else if (path === '/admin/audit' && method === 'GET') {
        response = (await requireAdmin(request, env)) ?? await handleAdmin.auditLog(env, url);
      } else if (path === '/notifications/log' && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleAdmin.notificationLog(env, url);
      } else if (path === '/donations' && method === 'GET') {
        response = (await requireStaff(request, env)) ?? await handleDonationsList(env);

      } else {
        response = jsonError('Not found', 404);
      }

      return secure(response, corsOrigin);
    } catch (e) {
      console.error('Unhandled error:', e);
      return secure(jsonError('Internal server error', 500), corsOrigin);
    }
  },

  // Hourly cron: due-soon + overdue reminder waves (deduped via reminder_log).
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sendGearReminders(env));
  },
};
