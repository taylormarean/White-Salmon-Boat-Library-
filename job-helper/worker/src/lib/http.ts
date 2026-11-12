export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function body<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

/** Match "/api/jobs/:id/score" style patterns. Returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const a = path.split('/');
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

export type Handler = (request: Request, params: Record<string, string>) => Promise<Response>;
export type Route = [method: string, pattern: string, handler: Handler];

export async function dispatch(routes: Route[], request: Request, path: string): Promise<Response | null> {
  for (const [method, pattern, handler] of routes) {
    if (request.method !== method) continue;
    const params = match(pattern, path);
    if (params) return handler(request, params);
  }
  return null;
}
