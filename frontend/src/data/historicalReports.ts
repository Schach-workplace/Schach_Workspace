export * from '../../../shared/reports/types';
export const historyPath = (id: string) => `/reports/history/snapshots/${encodeURIComponent(id)}`;
