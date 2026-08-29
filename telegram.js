import crypto from "crypto";

// ===== Telegram WebApp identity verification =====
//
// When the game runs as a Telegram Mini App, Telegram gives the frontend
// a signed `initData` string containing the user's Telegram id, name, and
// an auth timestamp — signed with YOUR bot's token, so it can't be forged
// by the client. This verifies that signature server-side per Telegram's
// documented algorithm:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// This is identity/anti-multi-accounting infrastructure ONLY — it proves
// "this request really comes from Telegram user #12345", nothing more. It
// does not touch balance, stakes, or payments.

export class TelegramAuthError extends Error {}

/**
 * Verify a Telegram Mini App `initData` string and return the identity it
 * carries. Throws TelegramAuthError on any failure (bad signature, stale
 * timestamp, missing fields) — callers should treat any thrown error as
 * "not authenticated" and fall back to anonymous/guest behavior rather
 * than crash the request.
 */
export function verifyTelegramInitData(initData, botToken, { maxAgeSeconds = 86400 } = {}) {
  if (!botToken) throw new TelegramAuthError("SERVER_NOT_CONFIGURED");
  if (!initData || typeof initData !== "string") throw new TelegramAuthError("MISSING_INIT_DATA");

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new TelegramAuthError("MISSING_HASH");
  params.delete("hash");

  // Data-check-string: every remaining field as "key=value", sorted
  // alphabetically by key, joined with "\n" — this exact recipe is what
  // Telegram signs, so any deviation (wrong order, wrong join, decoded
  // vs raw values) produces a hash that will never match.
  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!safeHexEqual(computedHash, hash)) throw new TelegramAuthError("INVALID_SIGNATURE");

  const authDate = Number(params.get("auth_date"));
  if (!authDate) throw new TelegramAuthError("MISSING_AUTH_DATE");
  if (Date.now() / 1000 - authDate > maxAgeSeconds) throw new TelegramAuthError("STALE_INIT_DATA");

  const userRaw = params.get("user");
  if (!userRaw) throw new TelegramAuthError("MISSING_USER");
  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new TelegramAuthError("MALFORMED_USER");
  }
  if (!user?.id) throw new TelegramAuthError("MISSING_USER_ID");

  return {
    telegramId: String(user.id),
    username: user.username || user.first_name || "Player",
    firstName: user.first_name || null,
    lastName: user.last_name || null,
    photoUrl: user.photo_url || null,
    authDate,
  };
}

function safeHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false; // malformed hex — definitely not equal
  }
}

/**
 * Convenience wrapper for route handlers: pull `initData` out of an
 * `Authorization: tma <initData>` header (Telegram's own recommended
 * scheme) and verify it. Returns null instead of throwing when there's no
 * such header at all, so callers can cleanly fall back to guest/anonymous
 * behavior — but a header that IS present and invalid still throws, so a
 * forged/tampered header is never silently treated as "no auth provided".
 */
export function verifyFromAuthHeader(authorizationHeader, botToken) {
  if (!authorizationHeader) return null;
  const match = /^tma\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match) return null;
  return verifyTelegramInitData(match[1], botToken);
}
