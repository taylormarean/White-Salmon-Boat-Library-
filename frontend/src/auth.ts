// Token storage — mirrors fleet-app frontend/src/auth.ts.

const TOKEN_KEY = 'wsbl_auth_token';
const USER_KEY = 'wsbl_auth_user';

export interface AuthUser {
  username: string;
  name: string;
  role: string;
  member_id: string | null;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAuthUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setAuth(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export const STAFF_ROLES = ['admin', 'librarian'];
export function isStaff(user: AuthUser | null): boolean {
  return !!user && STAFF_ROLES.includes(user.role);
}
