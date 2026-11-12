// Next Chapter — job search helper API (Cloudflare Worker).
import type { Env } from './env';
import { currentUser } from './lib/auth';
import { error, HttpError } from './lib/http';
import { AIError } from './lib/ai';
import { privateRoutes, publicRoutes } from './routes';
import { runHourly } from './pipeline';
import { allowedEmails } from './lib/gmail';
import { migrate } from './lib/migrate';

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
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
    const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';
    if (!path.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    try {
      await migrate(env);
      const pub = await publicRoutes(request, env, path);
      if (pub) return pub.status === 302 ? pub : withHeaders(pub, origin);
      const user = await currentUser(request, env);
      if (!user) return withHeaders(error('Please sign in', 401), origin);
      // Removing someone from ALLOWED_EMAILS signs them out immediately.
      const allowed = allowedEmails(env);
      if (!(allowed.includes(user.email) || (env.DEV_LOGIN === '1' && !allowed.length))) return withHeaders(error('Please sign in', 401), origin);
      const res = await privateRoutes(request, env, path, user);
      return withHeaders(res ?? error('Not found', 404), origin);
    } catch (e) {
      if (e instanceof HttpError) return withHeaders(error(e.message, e.status), origin);
      const msg = e instanceof Error ? e.message : String(e);
      console.error(e);
      // AI and Gmail problems are shown to her in plain words; anything else is a generic 500.
      const status = e instanceof AIError || /Gmail|Google|employer|recipient|draft|email/i.test(msg) ? 422 : 500;
      return withHeaders(error(status === 500 ? `Something went wrong: ${msg}` : msg, status), origin);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(migrate(env).then(() => runHourly(env)));
  },
};
