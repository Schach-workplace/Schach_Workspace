#!/usr/bin/env python3
"""Targeted civil-date Calendar TCP gate; exclusively caller-owned seeded loopback."""
import argparse, json, urllib.error, urllib.request
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--url', required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--allow-demo-mutations', action='store_true')
a = p.parse_args()
assert a.allow_demo_mutations
assert a.url.startswith(('http://127.0.0.1:', 'http://localhost:'))
cookie = ''

def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {'Cookie': cookie}
    if data:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(a.url + '/api' + path, data=data, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.loads(response.read() or '{}'), response.headers

status, login, headers = call('POST', '/auth/login', {'email': 'founder@schach.demo', 'password': 'SchachDemo!2026'})
assert status == 200, (status, login)
cookie = headers.get('Set-Cookie').split(';')[0]
root = '/companies/' + login['companies'][0]['id']
results = []
groups = [
    ('America/Havana', [
        '2026-03-08T04:30:00.123456Z', '2026-03-08T04:59:59.999999Z',
        '2026-03-08T05:00:00Z', '2026-03-09T03:30:00.654321Z',
        '2026-03-09T03:59:59.999999Z', '2026-03-09T04:00:00Z',
        '2026-11-01T04:30:00.123456Z', '2026-11-01T05:30:00.654321Z',
        '2040-12-31T05:00:00Z', '2041-01-01T04:59:59.999999Z',
    ], [
        ('2026-03-07', '2026-03-07', [0, 1]),
        ('2026-03-08', '2026-03-08', [2, 3, 4]),
        ('2026-03-02', '2026-03-08', [0, 1, 2, 3, 4]),
        ('2026-11-01', '2026-11-01', [6, 7]),
        ('2040-12-31', '2040-12-31', [8, 9]),
    ]),
    ('Pacific/Apia', ['2011-12-30T09:59:59.999999Z', '2011-12-30T10:00:00Z'], [
        ('2011-12-29', '2011-12-29', [0]),
        ('2011-12-30', '2011-12-30', []),
        ('2011-12-29', '2011-12-31', [0, 1]),
    ]),
    ('America/St_Johns', [
        '1988-10-30T01:29:59.999999Z', '1988-10-30T01:30:30.123456Z',
        '1988-10-30T01:31:30.654321Z', '1988-10-30T03:29:59.999999Z',
        '1988-10-30T03:30:00Z',
    ], [('1988-10-29', '1988-10-29', [0, 2, 3])]),
]
for number, (zone, instants, ranges) in enumerate(groups):
    status, body, _ = call('PATCH', root, {'timezone': zone})
    assert status == 200, (status, body)
    status, person, _ = call('POST', root + '/people', {
        'name': 'Owned civil calendar ' + str(number), 'email': f'm8-civil-{number}@example.invalid',
        'password': 'Owned-fictional-fixture!2026', 'role': 'member', 'capacityHours': 40,
    })
    assert status == 200, (status, person)
    owner = person['id']
    sources = []
    for i, instant in enumerate(instants):
        authored = {
            'title': f'Owned civil source {number}-{i}', 'ownerId': owner, 'status': 'todo',
            'priority': 'medium', 'estimatedHours': 1, 'requiresApproval': False,
            'dueDate': instant[:10], 'deadlineMode': 'timed', 'dueAt': instant, 'dueTimezone': 'UTC',
        }
        status, body, _ = call('POST', root + '/tasks', authored)
        assert status == 200, (status, body)
        sources.append(body['id'])
    for first, last, expected in ranges:
        status, body, _ = call('GET', root + '/planning/calendar?from=' + first + '&to=' + last + '&ownerId=' + owner)
        assert status == 200 and body['complete'] is True and body['timezone'] == zone, (status, body)
        actual = {task['id']: task for task in body['tasks']}
        assert set(actual) == {sources[i] for i in expected}, (zone, first, last, actual, expected)
        for i in expected:
            assert actual[sources[i]]['dueAt'] == instants[i]
            assert first <= actual[sources[i]]['dueDate'] <= last
        results.append({'zone': zone, 'from': first, 'to': last, 'count': len(actual), 'exactInstants': [actual[sources[i]]['dueAt'] for i in expected]})
    for i, source in enumerate(sources):
        status, body, _ = call('GET', root + '/tasks/' + source)
        assert status == 200, (status, body)
        task = body['task']
        assert task['version'] == 1 and task['dueDate'] == instants[i][:10] and task['originalDueDate'] == instants[i][:10]
        assert task['dueAt'] == instants[i] and task['originalDueAt'] == instants[i]
result = {'status': 'passed', 'checks': ['Actual current Calendar TCP midnight gap/overlap/skipped date/repeated date with hole/future leap-year seam', 'Current company timezone updated through owned API; exact microseconds and original Task deadlines/version preserved'], 'ranges': results, 'sourceUnmutatedByCalendar': True}
a.output.parent.mkdir(parents=True, exist_ok=True)
a.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
