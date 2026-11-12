// Next Chapter — job search helper API (Cloudflare Worker).
import type { Env } from './env';
import { currentUser } from './lib/auth';
import { error, HttpError } from './lib/http';
import { AIError } from './lib/ai';
import { privateRoutes, publicRoutes } from './routes';
import { runCron } from './pipeline';
import { runMonthly } from './admin';
import { migrate } from './lib/migrate';
import { canActIn, getUser } from './accounts';
import { BillingError } from './billing';
import { extRoutes } from './ext';
import { AI_DOWN_MESSAGE, alertFromError, isAiServiceDown } from './alerts';
import { publicHelpRoute } from './support';

export type { Env };

// In production the web app is served by this same Worker (same origin, no CORS needed).
// FRONTEND_URL is only for local development with the Vite dev server.
function corsOrigin(request: Request, env: Env): string {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = [env.FRONTEND_URL?.replace(/\/$/, ''), new URL(request.url).origin].filter(Boolean) as string[];
  return allowed.includes(origin) ? origin : allowed[0];
}

function withHeaders(res: Response, origin: string): Response {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
  h.set('Access-Control-Expose-Headers', 'Content-Disposition');
  h.set('Vary', 'Origin');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = corsOrigin(request, env);
    if (request.method === 'OPTIONS') return withHeaders(new Response(null, { status: 204 }), origin);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    // One address for everything: www and *.workers.dev redirect to the domain (webhooks excepted).
    const canonical = env.APP_URL ? new URL(env.APP_URL) : null;
    // Skipped in local dev, where `wrangler dev` reports the production host on every request.
    const dev = env.DEV_LOGIN === '1' || env.MOCK_AI === '1' || /^(localhost|127\.0\.0\.1)(:|$)/.test(canonical?.host ?? '');
    if (canonical && !dev && url.host !== canonical.host && !/^(localhost|127\.0\.0\.1)(:|$)/.test(url.host) && !path.startsWith('/api/webhook/') && request.method === 'GET') {
      return Response.redirect(`${canonical.origin}${url.pathname}${url.search}`, 301);
    }
    if (!path.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    const help = publicHelpRoute(path, request.method);
    if (help) return withHeaders(help, origin);
    let ws: number | null = null;
    try {
      await migrate(env);
      const pub = await publicRoutes(request, env, path);
      if (pub) return pub.status === 302 ? pub : withHeaders(pub, origin);
      // Browser helper (extension) — authenticates with its own key.
      if (path.startsWith('/api/ext/')) return withHeaders(await extRoutes(request, env, path), origin);
      const session = await currentUser(request, env);
      const user = session ? await getUser(env, session.sub) : null;
      if (!session || !user || user.status === 'suspended') return withHeaders(error('Please sign in', 401), origin);
      if (user.status === 'waitlist') return withHeaders(error('You’re on the waitlist — we’ll email you when there’s room.', 403), origin);
      // Which workspace: their own, or one they were invited to help with (re-checked every request).
      ws = session.ws ?? user.id;
      if (!(await canActIn(env, user, ws))) return withHeaders(error('Please sign in', 401), origin);
      const res = await privateRoutes(request, { ...env, uid: ws }, path, user);
      return withHeaders(res ?? error('Not found', 404), origin);
    } catch (e) {
      if (e instanceof HttpError) return withHeaders(error(e.message, e.status), origin);
      if (e instanceof BillingError) return withHeaders(new Response(JSON.stringify({ error: e.message, billing: e.code }), { status: 402, headers: { 'Content-Type': 'application/json' } }), origin);
      const msg = e instanceof Error ? e.message : String(e);
      console.error(e);
      // A bad Claude key or an empty Anthropic account: tell the customer plainly, alert the owner.
      if (isAiServiceDown(e)) {
        if (ws != null) await alertFromError({ ...env, uid: ws }, 'request', e).catch(() => {});
        return withHeaders(error(AI_DOWN_MESSAGE, 503), origin);
      }
      // AI and Gmail problems are shown to her in plain words; anything else is a generic 500.
      const status = e instanceof AIError || /Gmail|Google|employer|recipient|draft|email/i.test(msg) ? 422 : 500;
      return withHeaders(error(status === 500 ? `Something went wrong: ${msg}` : msg, status), origin);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(migrate(env).then(() => runCron(env)).then(() => runMonthly(env)));
  },
};
