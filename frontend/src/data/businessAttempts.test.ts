import { beforeEach, expect, it } from 'vitest';
import {
  beginAttempt,
  readAttempt,
  markAttemptCommitted,
  retireAttempt,
  clearAttemptsForPrincipal,
  clearAttemptScope,
  clearAttemptsForSource,
} from '../../../shared/business/attempts';
const scope = {
  serverOrigin: 'https://example.test',
  companyId: 'c',
  userId: 'u',
  formId: 'create',
};
beforeEach(() => clearAttemptScope(scope));
it('freezes one concrete intent and keeps the same key across remount and midnight', () => {
  const payload = { dueDate: '2026-10-11', rows: [{ title: 'One' }] };
  const a = beginAttempt(scope, payload, 'one');
  payload.rows[0].title = 'Two';
  expect(readAttempt(scope)).toBe(a);
  expect(a.payload.rows[0].title).toBe('One');
  expect(() => beginAttempt(scope, { dueDate: '2026-10-12', rows: [] }, 'two')).toThrow();
  expect(
    beginAttempt(scope, { rows: [{ title: 'One' }], dueDate: '2026-10-11' }, 'another').retryKey,
  ).toBe('one');
});
it('commits before refresh and only retires the matching submitted attempt', () => {
  beginAttempt(scope, { title: 'One' }, 'one');
  markAttemptCommitted(scope, 'one', { ids: ['task-one'] });
  expect(readAttempt(scope)?.state).toBe('committed');
  expect(retireAttempt(scope, 'other')).toBe(false);
  expect(readAttempt(scope)?.result?.ids).toEqual(['task-one']);
  expect(retireAttempt(scope, 'one')).toBe(true);
  expect(beginAttempt(scope, { title: 'Two' }, 'two').retryKey).toBe('two');
});
it('purges a principal without touching a different company', () => {
  beginAttempt(scope, {}, 'one');
  const other = { ...scope, companyId: 'other' };
  beginAttempt(other, {}, 'two');
  clearAttemptsForPrincipal(scope.serverOrigin, scope.companyId, scope.userId);
  expect(readAttempt(scope)).toBeUndefined();
  expect(readAttempt(other)?.retryKey).toBe('two');
  clearAttemptScope(other);
});
it('binds a frozen attempt to its target and HTTP method as well as concrete payload', () => {
  beginAttempt(scope, { version: 1 }, 'one', { path: '/task-templates/t', method: 'PATCH' });
  expect(() =>
    beginAttempt(scope, { version: 1 }, 'two', { path: '/task-templates', method: 'POST' }),
  ).toThrow();
});
it('purges only attempts bound to a denied source in the current principal', () => {
  const bound = { ...scope, formId: 'milestone-form:p' };
  const other = { ...bound, companyId: 'other' };
  beginAttempt(bound, { projectId: 'p' }, 'bound', {
    path: '/projects/p/milestones',
    method: 'POST',
  });
  beginAttempt(other, { projectId: 'p' }, 'other', {
    path: '/projects/p/milestones',
    method: 'POST',
  });
  beginAttempt(scope, {}, 'unrelated', { path: '/task-templates/t', method: 'PATCH' });
  clearAttemptsForSource(scope.serverOrigin, scope.companyId, scope.userId, '/projects/p');
  expect(readAttempt(bound)).toBeUndefined();
  expect(readAttempt(other)?.retryKey).toBe('other');
  expect(readAttempt(scope)?.retryKey).toBe('unrelated');
  clearAttemptScope(other);
});
it('purges a milestone decision when its parent project source is denied', () => {
  beginAttempt(scope, { version: 2 }, 'decision', {
    path: '/project-milestones/m/transition',
    method: 'POST',
    sources: ['/projects/p'],
  });
  clearAttemptsForSource(scope.serverOrigin, scope.companyId, scope.userId, '/projects/p');
  expect(readAttempt(scope)).toBeUndefined();
});
