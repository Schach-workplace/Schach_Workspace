import { isIntelligenceRawExpiry } from '../../../shared/intelligence/rawExpiry';
import { businessAttemptGeneration } from '../../../shared/business/attempts';
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
  const capturedGeneration = businessAttemptGeneration();
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
    if (
      capturedGeneration === businessAttemptGeneration() &&
      !isIntelligenceRawExpiry(path, method, response.status, code) &&
      (response.status === 401 || (response.status === 403 && path.startsWith('/companies/')))
    )
      window.dispatchEvent(
        new CustomEvent('schach-api-hard-denial', { detail: { status: response.status, path } }),
      );
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

export async function fetchReportCSV(path: string): Promise<Blob> {
  const response = await fetch(`${base}/api${path}`, {
    credentials: 'include',
    headers: { Accept: 'text/csv' },
  });
  if (!response.ok) {
    let message = 'Report export is unavailable. Refresh the report and retry.';
    try {
      message = (await response.json()).error?.message || message;
    } catch {
      /* proxy response */
    }
    throw new ApiError(message, response.status, 'report_export_failed');
  }
  return response.blob();
}

// A private report has an exact length. Abort, revocation or a truncated stream
// discards the partial body before a cooperative client creates a download URL.
export async function fetchHistoricalCSV(
  path: string,
  signal: AbortSignal,
  expectedLength: number,
): Promise<Blob> {
  const response = await fetch(`${base}/api${path}`, {
    credentials: 'include',
    headers: { Accept: 'text/csv' },
    signal,
  });
  if (!response.ok)
    throw new ApiError(
      'Report access changed or the export expired. Recheck the report.',
      response.status,
      'report_download_failed',
    );
  const blob = await response.blob();
  if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
  if (blob.size !== expectedLength || expectedLength > 16 * 1024 * 1024)
    throw new ApiError(
      'The report download was incomplete. Retry after checking access.',
      0,
      'incomplete_download',
    );
  return blob;
}
