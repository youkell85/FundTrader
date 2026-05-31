import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ftFetch } from "./fundtrader-client";

type StoredUser = {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  role: "user" | "admin";
  createdAt: string;
};

export type PublicUser = {
  id: string;
  name: string;
  username: string;
  email?: string;
  role: "user" | "admin";
  avatar: null;
};

type StoredSession = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
};

type StoreData = {
  users: StoredUser[];
  sessions: StoredSession[];
};

const STORE_PATH = process.env.FUNDTRADER_USER_STORE ||
  path.resolve(process.cwd(), "..", "data", "user-store.json");

function ensureDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function readStore(): StoreData {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { users: [], sessions: [] };
  }
}

function writeStore(data: StoreData) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── Sync: Python backend → local JSON (for sync context reads) ───────────

export function syncUserFromBackend(user: { id: string; username: string; displayName?: string; role?: string }) {
  const data = readStore();
  const existing = data.users.find(u => u.id === user.id);
  if (!existing) {
    data.users.push({
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      role: (user.role as "user" | "admin") || "user",
      createdAt: new Date().toISOString(),
    });
    writeStore(data);
  }
}

export function syncSession(token: string, userId: string, maxAgeMs: number) {
  const data = readStore();
  data.sessions = data.sessions
    .filter(s => new Date(s.expiresAt).getTime() > Date.now())
    .concat({ tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + maxAgeMs).toISOString() });
  writeStore(data);
}

// ─── Synchronous session read (used by tRPC context) ─────────────────────

export function getUserBySession(token?: string): PublicUser | null {
  if (!token) return null;
  const data = readStore();
  const tokenHash = hashToken(token);
  const session = data.sessions.find(s => s.tokenHash === tokenHash);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const user = data.users.find(u => u.id === session.userId);
  if (!user) return null;
  return { id: user.id, name: user.displayName, username: user.username, role: user.role, avatar: null };
}

export function deleteSession(token: string) {
  const data = readStore();
  const tokenHash = hashToken(token);
  data.sessions = data.sessions.filter(s => s.tokenHash !== tokenHash);
  writeStore(data);
}

// ─── Auth via Python backend ──────────────────────────────────────────────

export async function loginViaBackend(username: string, password: string) {
  const res = await ftFetch<{ user: any; token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  syncUserFromBackend(res.user);
  return res;
}

export async function registerViaBackend(input: { username: string; password: string; displayName?: string }) {
  const res = await ftFetch<{ user: any; token: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  syncUserFromBackend(res.user);
  return res;
}


type UserState = { watchlistCodes: string[]; backtestRecords: unknown[]; recommendationRecords: unknown[]; preferences: Record<string, unknown>; recentFunds: string[] };

export function getUserState(userId: string): UserState {
  const data = readStore();
  const key = 'state_' + userId;
  try {
    const raw = fs.readFileSync(STORE_PATH.replace('.json', '_states.json'), 'utf-8');
    const states = JSON.parse(raw);
    return { watchlistCodes: [], backtestRecords: [], recommendationRecords: [], preferences: {}, recentFunds: [], ...(states[key] || {}) };
  } catch {
    return { watchlistCodes: [], backtestRecords: [], recommendationRecords: [], preferences: {}, recentFunds: [] };
  }
}

export function updateUserState(userId: string, patch: Partial<UserState>) {
  const statesPath = STORE_PATH.replace('.json', '_states.json');
  let states: Record<string, UserState> = {};
  try { states = JSON.parse(fs.readFileSync(statesPath, 'utf-8')); } catch {}
  states['state_' + userId] = { ...getUserState(userId), ...patch };
  fs.writeFileSync(statesPath, JSON.stringify(states, null, 2), 'utf-8');
  return states['state_' + userId];
}
