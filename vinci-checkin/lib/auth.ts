import crypto from "crypto";

// 和 SCAA 问卷一样：密码放在环境变量 ADMIN_PASSWORD，登录后发一个签名 cookie，12 小时有效
const COOKIE_NAME = "vinci_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function secret() {
  return process.env.ADMIN_PASSWORD ?? "vinci-dev-secret";
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

export function createSessionToken(): string {
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const valid = expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  if (!valid) return false;
  const expires = Number(payload);
  return Number.isFinite(expires) && Date.now() <= expires;
}

export function checkPassword(input: string): boolean {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(real);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
export const SESSION_MAX_AGE = SESSION_TTL_MS / 1000;
