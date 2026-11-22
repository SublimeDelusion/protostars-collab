export const BOARD_COOKIE = "__Host-ftc-board";
export const NAME_COOKIE = "__Host-ftc-name";
const YEAR = 365 * 24 * 60 * 60;

export function readCookie(request: Request, name: string) {
  const prefix = name + "=";
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) {
      try { return decodeURIComponent(value.slice(prefix.length)); } catch { return ""; }
    }
  }
  return "";
}

export function boardCookie(name: string, value: string) {
  return name + "=" + encodeURIComponent(value) + "; Path=/; Max-Age=" + YEAR + "; HttpOnly; Secure; SameSite=Lax";
}

export function displayName(request: Request) {
  const value = readCookie(request, NAME_COOKIE).trim();
  return value.length <= 50 ? value : "";
}

export function normalizeDisplayName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function displayNameKey(value: string) {
  return normalizeDisplayName(value).toLowerCase();
}
