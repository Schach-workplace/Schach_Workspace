import { request } from '../data/api';
import { useWorkspace } from '../store';

// One registration per signed-in user per browser. The backend upserts when a
// deviceId is supplied (rebinding it to the current session) and returns 404
// for an unknown or foreign id, in which case we register a fresh device.
const key = (userId: string) => `schach.web-device.${userId}`;
const registration = { platform: 'web', name: 'Web call device' };

export function storedWebDevice(userId: string): string {
  if (!userId) return '';
  try {
    return localStorage.getItem(key(userId)) ?? '';
  } catch {
    return '';
  }
}

function remember(userId: string, id: string | undefined) {
  if (!userId) return;
  try {
    if (id) localStorage.setItem(key(userId), id);
    else localStorage.removeItem(key(userId));
  } catch {
    /* Storage may be unavailable; the device simply is not reused. */
  }
}

export async function registerWebDevice(userId: string): Promise<string> {
  const known = storedWebDevice(userId);
  if (known) {
    try {
      const reused = await request<{ id: string }>('/devices', {
        method: 'POST',
        body: { ...registration, deviceId: known },
      });
      remember(userId, reused.id);
      return reused.id;
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
      remember(userId, undefined);
    }
  }
  const created = await request<{ id: string }>('/devices', { method: 'POST', body: registration });
  remember(userId, created.id);
  return created.id;
}

// The signed-in user's id, or '' when rendered outside the workspace provider.
export function useSignedInUserId(): string {
  try {
    return useWorkspace().session?.user.id ?? '';
  } catch {
    return '';
  }
}
