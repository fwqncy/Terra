import { Injectable, computed, signal } from '@angular/core';

export type ApiStatus = 'checking' | 'online' | 'offline';

export interface Health {
  status: string;
  version: string;
  sql: boolean;
  nosql: boolean;
  time: string;
}

export interface LeaderRow {
  rank: number;
  name: string;
  lifetime: number;
  deliveries: number;
  tokens: number;
}

export interface CmsPost {
  id: number | string;
  title: string;
  excerpt: string;
  date: string;
  link: string;
  issue: number;
}

const BASE_KEY = 'terra.api.base';
const PLAYER_KEY = 'terra.player';

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Thin fetch client for the .NET API. Every call is optional: the app runs fully
 * offline, and this service just reports whether the backend is reachable.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  /** A saved override wins; otherwise the deployment's runtime config (public/config.js). */
  readonly base = signal(this.read(BASE_KEY) ?? ((globalThis as { TERRA_API_BASE?: string }).TERRA_API_BASE || '/api'));
  readonly status = signal<ApiStatus>('checking');
  readonly health = signal<Health | null>(null);
  readonly online = computed(() => this.status() === 'online');
  readonly playerId: string;
  readonly playerName = signal(this.read('terra.player.name') ?? `Courier ${Math.floor(1000 + Math.random() * 9000)}`);

  constructor() {
    let id = this.read(PLAYER_KEY);
    if (!id) {
      id = uuid();
      this.write(PLAYER_KEY, id);
    }
    this.playerId = id;
    this.write('terra.player.name', this.playerName());
    void this.watch();
  }

  /** Health-check loop: every 30 s when healthy, backing off 2 s → 4 s → 8 s… after a failure. */
  private failures = 0;
  private async watch(): Promise<void> {
    const ok = await this.ping();
    this.failures = ok ? 0 : this.failures + 1;
    const delay = ok ? 30_000 : Math.min(30_000, 1000 * 2 ** this.failures);
    setTimeout(() => void this.watch(), delay);
  }

  setBase(url: string): void {
    const clean = url.trim().replace(/\/+$/, '') || '/api';
    this.base.set(clean);
    this.write(BASE_KEY, clean);
    void this.ping();
  }

  setPlayerName(name: string): void {
    const n = name.trim().slice(0, 32) || this.playerName();
    this.playerName.set(n);
    this.write('terra.player.name', n);
    if (this.online()) void this.put(`/players/${this.playerId}`, { name: n }).catch(() => undefined);
  }

  async ping(): Promise<boolean> {
    try {
      const h = await this.get<Health>('/health', 4000);
      this.health.set(h);
      this.status.set('online');
      return true;
    } catch {
      this.health.set(null);
      this.status.set('offline');
      return false;
    }
  }

  get<T>(path: string, timeoutMs = 6000): Promise<T> {
    return this.request<T>('GET', path, undefined, timeoutMs);
  }

  post<T>(path: string, body: unknown, timeoutMs = 6000): Promise<T> {
    return this.request<T>('POST', path, body, timeoutMs);
  }

  put<T>(path: string, body: unknown, timeoutMs = 6000): Promise<T> {
    return this.request<T>('PUT', path, body, timeoutMs);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 6000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json', 'X-Terra-Player': this.playerId };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      // Idempotency keys make retried writes safe on the server.
      if (method !== 'GET') headers['Idempotency-Key'] = uuid();
      const res = await fetch(`${this.base()}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`${method} ${path} failed with ${res.status}`);
      if (res.status === 204 || res.status === 202) return undefined as T;
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('json')) throw new Error(`${path} did not return JSON`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }
}
