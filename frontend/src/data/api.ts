const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined && !(body instanceof FormData))
    headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${base}/api${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(
      'Cannot reach the server. Check the connection and keep your changes open before retrying.',
      0,
      'network',
    );
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    let code = 'request_failed';
    try {
      const error = await response.json();
      message = error.error?.message || error.message || message;
      code = error.error?.code || error.code || code;
    } catch {
      /* A proxy may return a non-JSON error. */
    }
    throw new ApiError(message, response.status, code);
  }
  if (response.status === 204) return { ok: true } as T;
  return response.json() as Promise<T>;
}
export async function fetchAttachment(companyId: string, attachmentId: string): Promise<Blob> {
  const r = await fetch(
    `${base}/api/companies/${encodeURIComponent(companyId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { credentials: 'include' },
  );
  if (!r.ok)
    throw new ApiError(
      'This file could not be downloaded. Refresh your workspace and check your access.',
      r.status,
      'download_failed',
    );
  return r.blob();
}

export async function fetchExpenseReceipt(companyId: string, receiptId: string): Promise<Blob> {
  const response = await fetch(
    `${base}/api/companies/${encodeURIComponent(companyId)}/expense-receipts/${encodeURIComponent(receiptId)}`,
    { credentials: 'include' },
  );
  if (!response.ok)
    throw new ApiError(
      'This receipt could not be downloaded. Refresh your workspace and check your access.',
      response.status,
      'download_failed',
    );
  return response.blob();
}
