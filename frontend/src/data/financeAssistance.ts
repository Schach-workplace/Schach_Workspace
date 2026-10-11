export * from '../../../shared/finance/assistanceIntent';
export { formatExactMoney, parseExactMoney } from '../../../shared/finance/money';
import { request, ApiError } from './api';
import type { FinanceIntake } from '../../../shared/finance/assistanceIntent';
export async function financeFileHash(file: File) {
  const data = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
}
export async function uploadFinanceFile(
  company: string,
  intake: FinanceIntake,
  file: File,
  signal?: AbortSignal,
) {
  const path = `/companies/${encodeURIComponent(company)}/finance/intakes/${encodeURIComponent(intake.id)}`;
  await request(path, { signal });
  const origin = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  const response = await fetch(origin + '/api' + path + '/upload', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
    signal,
  });
  if (!response.ok) {
    const b = await response.json().catch(() => ({}));
    throw new ApiError(
      b.error?.message ?? 'Unable to stage the file. Retry this same intake.',
      response.status,
      b.error?.code ?? 'upload_failed',
    );
  }
  const metadata = (await response.json()) as FinanceIntake;
  await request(path, { signal });
  return metadata;
}
