// api.ts — the single typed API client (fleet-app rule: no sibling clients).
// VITE_DEMO=1 builds swap in the in-browser demo backend (src/demo/demoApi.ts).

import { getAuthToken, clearAuth } from './auth';
import { demoApi } from './demo/demoApi';

export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string>) };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401) {
      clearAuth();
      throw new Error('Session expired. Please sign in again.');
    }
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as any).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

const post = (data: unknown, method = 'POST') =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

const realApi = {
  // Auth
  login: (username: string, password: string) => req<{ token: string; user: any }>('/auth/login', post({ username, password })),
  verify: () => req<{ user: any }>('/auth/verify'),
  changePassword: (current_password: string, new_password: string) =>
    req<{ success: boolean }>('/auth/change-password', post({ current_password, new_password })),

  // Public
  publicInfo: () => req<{ app_name: string; orientation_info: string; library_address: string; waiver_version: number }>('/public/info'),
  join: (data: any) => req<{ success: boolean; member_id: string }>('/public/join', post(data)),
  getGear: (params?: { category?: string; all?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.all) qs.set('all', '1');
    const s = qs.toString();
    return req<any[]>(`/gear${s ? `?${s}` : ''}`);
  },
  getCategories: () => req<any[]>('/gear/categories'),

  // Member self-service
  me: () => req<{ member: any; active_checkouts: any[] }>('/me/member'),
  selfCheckout: (data: any) => req<{ success: boolean; checkout_id: string; access_code: string; code_mode: string; due_at: string; items: any[] }>('/checkouts/self', post(data)),
  selfReturn: (checkoutId: string, data: any) => req<{ success: boolean; complete: boolean }>(`/checkouts/${checkoutId}/return`, post(data)),

  // Shifts
  getShifts: (all?: boolean) => req<any[]>(`/shifts${all ? '?all=1' : ''}`),
  createShift: (data: any) => req<{ success: boolean; id: string }>('/shifts', post(data)),
  updateShift: (id: string, data: any) => req<{ success: boolean }>(`/shifts/${id}`, post(data, 'PUT')),
  cancelShift: (id: string) => req<{ success: boolean }>(`/shifts/${id}`, { method: 'DELETE' }),
  signupShift: (id: string) => req<{ success: boolean }>(`/shifts/${id}/signup`, { method: 'POST' }),
  unsignupShift: (id: string) => req<{ success: boolean }>(`/shifts/${id}/signup`, { method: 'DELETE' }),

  // Staff
  getDashboard: () => req<any>('/dashboard'),
  createGear: (data: any) => req<{ success: boolean; id: string }>('/gear', post(data)),
  updateGear: (id: string, data: any) => req<{ success: boolean }>(`/gear/${id}`, post(data, 'PUT')),
  setGearStatus: (id: string, status: string, reason?: string) =>
    req<{ success: boolean }>(`/gear/${id}/status`, post({ status, reason }, 'PUT')),
  getMaintenance: (status?: string) => req<any[]>(`/gear/maintenance${status ? `?status=${status}` : ''}`),
  createMaintenance: (gearId: string, data: any) => req<{ success: boolean }>(`/gear/${gearId}/maintenance`, post(data)),
  updateMaintenance: (id: string, data: any) => req<{ success: boolean }>(`/gear/maintenance/${id}`, post(data, 'PUT')),

  getMembers: () => req<any[]>('/members'),
  getMember: (id: string) => req<{ member: any; checkouts: any[]; incidents: any[] }>(`/members/${id}`),
  updateMember: (id: string, data: any) => req<{ success: boolean }>(`/members/${id}`, post(data, 'PUT')),
  setMemberStatus: (id: string, status: string, reason?: string) =>
    req<{ success: boolean }>(`/members/${id}/status`, post({ status, reason }, 'PUT')),

  getCheckouts: (status?: string) => req<any[]>(`/checkouts${status ? `?status=${status}` : ''}`),
  extendCheckout: (id: string, due_at: string) => req<{ success: boolean }>(`/checkouts/${id}/extend`, post({ due_at }, 'PUT')),
  forceReturn: (id: string, data: any) => req<{ success: boolean }>(`/checkouts/${id}/force-return`, post(data)),
  getAccessCodeLog: () => req<any[]>('/checkouts/access-codes'),
  getTodayDoorCode: () => req<{ date: string; code: string; mode: string }>('/checkouts/door-code/today'),

  getIncidents: (status?: string) => req<any[]>(`/incidents${status ? `?status=${status}` : ''}`),
  createIncident: (data: any) => req<{ success: boolean; id: string }>('/incidents', post(data)),
  updateIncident: (id: string, data: any) => req<{ success: boolean }>(`/incidents/${id}`, post(data, 'PUT')),

  getSettings: () => req<Record<string, string>>('/settings'),
  updateSettings: (data: Record<string, string>) => req<{ success: boolean }>('/admin/settings', post(data, 'PUT')),
  getUsers: () => req<any[]>('/admin/users'),
  createUser: (data: any) => req<{ success: boolean }>('/admin/users', post(data)),
  updateUser: (username: string, data: any) => req<{ success: boolean }>(`/admin/users/${encodeURIComponent(username)}`, post(data, 'PUT')),
  getAuditLog: () => req<any[]>('/admin/audit'),
  getNotificationLog: () => req<any[]>('/notifications/log'),
};

export const api: typeof realApi = IS_DEMO ? (demoApi as typeof realApi) : realApi;
