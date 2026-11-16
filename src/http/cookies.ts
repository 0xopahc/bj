export const PLAYER_COOKIE = 'fbj_session';
export const ADMIN_COOKIE = 'fbj_admin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function cookieOptions(secure: boolean, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
    secure,
  };
}
