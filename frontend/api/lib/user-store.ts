import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ftFetch } from "./fundtrader-client";

type StoredUser = {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  lastLoginAt?: string;
};

export type PublicUser = {
  id: string;
  name: string;
  username: string;
  email?: string;
  role: "user";
  avatar: null;
};

export type UserState = {
  watchlistCodes: string[];
  backtestRecords: unknown[];
  recommendationRecords: unknown[];
  preferences: Record<string, unknown>;
  recentFunds: string[];
};

type StoredSession = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
};

type StoreData = {
  users: StoredUser[];
  sessions: StoredSession[];
  states: Record<string, UserState>;
};

const STORE_PATH = process.env.FUNDTRADER_USER_STORE ||
  path.resolve(process.cwd(), "..", "data", "user-store.json");

const defaultState = (): UserState => ({
  watchlistCodes: [],
  backtestRecords: [],
  recommendationRecords: [],
  preferences: {},
  recentFunds: [],
});

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
      states: parsed.states && typeof parsed.states === "object" ? parsed.states : {},
    };
  } catch {
    return { users: [], sessions: [], states: {} };
  }
}

function writeStore(data: StoreData) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    name: user.displayName || user.username,
    username: user.username,
    email: user.email,
    role: "user",
    avatar: null,
  };
}

export function createSession(userId: string, maxAgeMs: number) {
  const data = readStore();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();
  data.sessions = data.sessions
    .filter((session) => new Date(session.expiresAt).getTime() > Date.now())
    .concat({ tokenHash: hashToken(token), userId, expiresAt });
  writeStore(data);
  return token;
}

export function deleteSession(token: string) {
  const data = readStore();
  const tokenHash = hashToken(token);
  data.sessions = data.sessions.filter((session) => session.tokenHash !== tokenHash);
  writeStore(data);
}

export async function getUserBySession(token?: string): Promise<PublicUser | null> {
  if (!token) return null;
  try {
    const res = await ftFetch<{ user: any }>("/auth/me", {
      headers: { Cookie: `kimi_sid=${token}` },
    });
    return {
      id: res.user.id, name: res.user.displayName, username: res.user.username,
      role: res.user.role, avatar: null,
    };
  } catch {
    return null;
  }
}

export function registerUser(input: { username: string; password: string; displayName?: string; email?: string }) {
  const username = input.username.trim().toLowerCase();
  const data = readStore();
  if (data.users.some((user) => user.username === username)) {
    throw new Error("用户名已存在");
  }
  const { salt, hash } = hashPassword(input.password);
  const user: StoredUser = {
    id: crypto.randomUUID(),
    username,
    displayName: input.displayName?.trim() || username,
    email: input.email?.trim() || undefined,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  data.users.push(user);
  data.states[user.id] = defaultState();
  writeStore(data);
  return toPublicUser(user);
}

export function loginUser(usernameInput: string, password: string) {
  const username = usernameInput.trim().toLowerCase();
  const data = readStore();
  const user = data.users.find((item) => item.username === username);
  if (!user) throw new Error("用户名或密码错误");
  const { hash } = hashPassword(password, user.passwordSalt);
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(hash, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error("用户名或密码错误");
  }
  user.lastLoginAt = new Date().toISOString();
  writeStore(data);
  return toPublicUser(user);
}

export function getUserState(userId: string): UserState {
  const data = readStore();
  return { ...defaultState(), ...(data.states[userId] || {}) };
}

export function updateUserState(userId: string, patch: Partial<UserState>) {
  const data = readStore();
  const current = { ...defaultState(), ...(data.states[userId] || {}) };
  data.states[userId] = {
    ...current,
    ...patch,
    watchlistCodes: patch.watchlistCodes || current.watchlistCodes,
    backtestRecords: patch.backtestRecords || current.backtestRecords,
    recommendationRecords: patch.recommendationRecords || current.recommendationRecords,
    preferences: { ...current.preferences, ...(patch.preferences || {}) },
    recentFunds: patch.recentFunds || current.recentFunds,
  };
  writeStore(data);
  return data.states[userId];
}
