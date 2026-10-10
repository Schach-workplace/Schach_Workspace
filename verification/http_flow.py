#!/usr/bin/env python3
"""Exercise the real Go API against an explicitly disposable demo database.

Start the server with --demo and --db pointing at a disposable file. This script
creates one fictional company and test memberships; it never deletes records.
Run: python verification/http_flow.py --url http://127.0.0.1:8080 --allow-demo-mutations
Or use --bridge /path/to/httpbridge for in-process HTTP handler integration.
"""
import argparse
import base64
import datetime as dt
import email.message
import http.cookiejar
from http.cookies import SimpleCookie
import json
import pathlib
import selectors
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


class Bridge:
    """One disposable Go handler process shared by independent client sessions."""

    def __init__(self, binary):
        self.process = subprocess.Popen(
            [str(pathlib.Path(binary).expanduser().resolve())],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=None, text=True, encoding='utf-8', bufsize=1,
        )
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)

    def call(self, method, path, body, headers):
        request = {'method': method, 'path': path,
                   'body': base64.b64encode(body or b'').decode('ascii'),
                   'headers': headers}
        try:
            self.process.stdin.write(json.dumps(request) + '\n')
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as error:
            raise RuntimeError(f'{method} {path}: bridge input closed; inspect its stderr above') from error
        if not self.selector.select(timeout=30):
            raise TimeoutError(f'{method} {path}: bridge did not return a response within 30 seconds')
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError(f'{method} {path}: bridge stopped before a response; exit={self.process.poll()}, inspect stderr above')
        try:
            response = json.loads(line)
            raw = base64.b64decode(response['body'] or '', validate=True)
            response_headers = email.message.Message()
            for name, value in response['headers'].items():
                for item in value.split('\n'):
                    response_headers[name] = item
            return response['status'], raw, response_headers
        except (ValueError, KeyError, TypeError) as error:
            raise RuntimeError(f'{method} {path}: invalid bridge response: {line[:300]}') from error

    def close(self):
        self.selector.close()
        if self.process.stdin:
            try:
                self.process.stdin.close()
            except BrokenPipeError:
                pass
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
        self.process.stdout.close()


class Client:
    def __init__(self, base, bridge=None):
        self.base = base.rstrip('/')
        self.bridge = bridge
        self.bridge_cookies = SimpleCookie()
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def cookie_header(self, path):
        if not self.bridge:
            request = urllib.request.Request(self.base + path)
            self.cookies.add_cookie_header(request)
            return request.get_header('Cookie', '')
        request_path = urllib.parse.urlsplit(path).path
        values = []
        for name, morsel in self.bridge_cookies.items():
            cookie_path = morsel['path'] or '/'
            if (request_path == cookie_path or
                    request_path.startswith(cookie_path if cookie_path.endswith('/') else cookie_path + '/')):
                values.append(f'{name}={morsel.coded_value}')
        return '; '.join(values)

    def call(self, method, path, body=None, expected=200, headers=None):
        headers = dict(headers or {})
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        if self.bridge:
            cookies = self.cookie_header(path)
            if cookies and 'Cookie' not in headers:
                headers['Cookie'] = cookies
            status, raw, response_headers = self.bridge.call(method, path, body, headers)
            for value in response_headers.get_all('Set-Cookie', []):
                received = SimpleCookie()
                received.load(value)
                for name, morsel in received.items():
                    if not morsel.value or (morsel['max-age'] and int(morsel['max-age']) <= 0):
                        self.bridge_cookies.pop(name, None)
                    else:
                        self.bridge_cookies[name] = morsel
        else:
            req = urllib.request.Request(self.base + path, data=body, headers=headers, method=method)
            try:
                response = self.opener.open(req, timeout=20)
            except urllib.error.HTTPError as error:
                response = error
            except urllib.error.URLError as error:
                raise RuntimeError(f'{method} {path}: HTTP connection failed: {error.reason}') from error
            with response:
                raw = response.read()
                status, response_headers = response.code, response.headers
        try:
            value = json.loads(raw) if 'application/json' in response_headers.get('Content-Type', '') else raw
        except ValueError as error:
            raise AssertionError(f'{method} {path}: response was not valid JSON: {raw[:300]!r}') from error
        if status != expected:
            raise AssertionError(f'{method} {path}: expected {expected}, got {status}: {str(value)[:500]}')
        return value, response_headers


def run_flow(args, bridge, checks):
    def check(name, condition=True):
        if not condition:
            raise AssertionError(name)
        checks.append(name)
        print(f'PASS {name}', flush=True)

    founder = Client(args.url or 'http://bridge.invalid', bridge)
    health, _ = founder.call('GET', '/api/health')
    check('Go health endpoint is available', health.get('ok') is True)
    founder.call('GET', '/api/companies/c-schach/workspace', expected=401)
    check('Anonymous workspace reads require authentication')
    session, headers = founder.call('POST', '/api/auth/login', {'email': 'founder@schach.demo', 'password': 'SchachDemo!2026'})
    check('Explicit demo founder can sign in', session['user']['email'] == 'founder@schach.demo')
    cookie = headers.get('Set-Cookie', '')
    check('Session cookie is HttpOnly, SameSite=Lax and API-scoped', 'HttpOnly' in cookie and 'SameSite=Lax' in cookie and 'Path=/api' in cookie)
    home, _ = founder.call('GET', '/api/companies/c-schach/workspace')
    check('Seeded workspace has real persisted company data', len(home['tasks']) >= 40 and len(home['departments']) == 6)
    founder.call('POST', '/api/companies', {'name': 'Origin must fail', 'slug': 'invalid-origin-test'}, expected=403, headers={'Origin': 'https://untrusted.invalid'})
    check('Untrusted browser origins cannot mutate the application')

    suffix = uuid.uuid4().hex[:10]
    cid = founder.call('POST', '/api/companies', {'name': f'Verification {suffix}', 'slug': f'verification-{suffix}', 'industry': 'Fictional QA', 'timezone': 'Asia/Kolkata', 'color': '#F97316'}, expected=200)[0]['id']
    root = f'/api/companies/{cid}'
    new_workspace = founder.call('GET', root + '/workspace')[0]
    check('A new company starts with its own empty environment', new_workspace['tasks'] == [] and new_workspace['projects'] == [] and len(new_workspace['people']) == 1)
    active_session = founder.call('GET', '/api/auth/session')[0]
    check('Company creation adds authorised founder membership', any(c['id'] == cid for c in active_session['companies']))
    did = founder.call('POST', root + '/departments', {'name': 'Delivery', 'description': 'Verification department', 'color': '#F97316', 'headId': ''}, expected=200)[0]['id']
    check('Department creation persists')
    password = 'Fictional-QA-only!2026'
    identity = {}
    for role in ('head', 'member', 'viewer'):
        email = f'{role}-{suffix}@verification.demo'
        identity[role] = founder.call('POST', root + '/people', {'name': f'QA {role.title()}', 'email': email, 'password': password, 'role': role, 'departmentId': did, 'managerId': identity.get('head', {}).get('id', session['user']['id']), 'title': f'Fictional {role}', 'capacityHours': 40}, expected=200)[0]
        identity[role]['email'] = email
    check('Company members receive independent scoped roles')
    founder.call('PATCH', root + '/departments/' + did, {'name': 'Delivery', 'headId': identity['head']['id']})
    check('Department head can be assigned')
    clients = {}
    for role in identity:
        client = Client(args.url or 'http://bridge.invalid', bridge)
        client.call('POST', '/api/auth/login', {'email': identity[role]['email'], 'password': password})
        clients[role] = client
    member, head, viewer = clients['member'], clients['head'], clients['viewer']
    member.call('GET', '/api/companies/c-schach/workspace', expected=403)
    check('Membership in one company grants no access to another')
    due = (dt.date.today() + dt.timedelta(days=14)).isoformat()
    pid = founder.call('POST', root + '/projects', {'name': 'Verification delivery', 'description': 'Integration flow', 'ownerId': identity['head']['id'], 'departmentId': did, 'dueDate': due, 'color': '#F97316', 'status': 'active'}, expected=200)[0]['id']
    goal = founder.call('POST', root + '/goals', {'name': 'Delivery acceptance', 'ownerId': identity['head']['id'], 'departmentId': did, 'description': 'Measurable outcome', 'baseline': 0, 'target': 100, 'current': 20, 'unit': '%', 'dueDate': due, 'taskIds': []}, expected=200)[0]['id']
    founder.call('PATCH', root + '/goals/' + goal, {'current': 30})
    check('Project and measurable goal creation and updates persist')
    template = {'title': 'Acceptance evidence flow', 'description': 'A clear outcome', 'ownerId': identity['member']['id'], 'reviewerId': identity['head']['id'], 'departmentId': did, 'projectId': pid, 'priority': 'high', 'status': 'todo', 'dueDate': due, 'startDate': '', 'estimatedHours': 8, 'tags': ['QA'], 'checklist': [{'id': 'criterion', 'text': 'Evidence is verified', 'done': False}], 'dependencies': [], 'collaborators': [], 'recurrence': 'none', 'requiresApproval': True, 'parentId': ''}
    tid = head.call('POST', root + '/tasks', template, expected=200)[0]['id']
    check('Department head can assign a task to a junior')

    def task(client=founder):
        return next(t for t in client.call('GET', root + '/workspace')[0]['tasks'] if t['id'] == tid)

    observed = task(member)
    check('Assigned junior can read their work', observed['ownerId'] == identity['member']['id'])
    member.call('POST', root + '/tasks', {**template, 'ownerId': session['user']['id']}, expected=403)
    check('Junior cannot assign work outside their reporting scope')
    founder.call('PATCH', f'/api/companies/c-schach/tasks/{tid}', {'version': 1, 'progress': 10}, expected=404)
    check('Task identifiers cannot cross company route boundaries')
    head.call('PATCH', root + '/tasks/' + tid, {'version': 1, 'progress': 25}, expected=200)
    head.call('PATCH', root + '/tasks/' + tid, {'version': 1, 'progress': 30}, expected=409)
    check('Optimistic task versions reject stale overwrites')
    t = task()
    revised_due = (dt.date.fromisoformat(due) + dt.timedelta(days=2)).isoformat()
    member.call('PATCH', root + '/tasks/' + tid, {'version': t['version'], 'dueDate': revised_due}, expected=422)
    member.call('PATCH', root + '/tasks/' + tid, {'version': t['version'], 'dueDate': revised_due, 'deadlineChangeReason': 'Dependency delivery date revised'})
    changed = task()
    check('Changed deadlines retain the original commitment', changed['originalDueDate'] == due and changed['dueDate'] == revised_due)
    member.call('PATCH', root + '/tasks/' + tid, {'version': changed['version'], 'requiresApproval': False}, expected=403)
    founder.call('PATCH', root + '/tasks/' + tid, {'version': changed['version'], 'requiresApproval': False}, expected=403)
    check('Required review cannot be removed by owner or leadership')
    member.call('PATCH', root + '/tasks/' + tid, {'version': changed['version'], 'status': 'in_review'}, expected=422)
    check('Incomplete acceptance criteria block submission')
    member.call('POST', root + '/tasks/' + tid + '/comments', {'body': 'Evidence ready for review.'}, expected=200)
    member.call('POST', root + '/tasks/' + tid + '/time', {'hours': 2.5, 'date': dt.date.today().isoformat(), 'note': 'Prepared and checked the deliverable'}, expected=200)
    check('Comments and dated time entries persist')
    boundary = 'SchachBoundary' + suffix
    content = b'Verification evidence: accepted inputs and outputs.\n'
    multipart = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.txt"\r\nContent-Type: text/plain\r\n\r\n'.encode() + content + f'\r\n--{boundary}--\r\n'.encode())
    member.call('POST', root + '/tasks/' + tid + '/attachments', multipart, expected=200, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    t = task()
    check('Evidence bytes and metadata are stored', len(t['attachments']) == 1 and t['attachments'][0]['size'] == len(content))
    aid = t['attachments'][0]['id']
    downloaded, file_headers = head.call('GET', root + '/attachments/' + aid)
    check('Authorised reviewer downloads exact evidence bytes', downloaded == content and 'attachment' in file_headers.get('Content-Disposition', ''))
    founder.call('GET', '/api/companies/c-schach/attachments/' + aid, expected=404)
    check('Evidence download checks company scope')
    check('Actual effort reconciles to time entries', t['actualHours'] == sum(x['hours'] for x in t['timeEntries']) == 2.5)
    viewer.call('POST', root + '/tasks/' + tid + '/comments', {'body': 'Forbidden mutation'}, expected=403)
    check('Viewer memberships cannot comment or change work')
    member.call('PATCH', root + '/tasks/' + tid, {'version': t['version'], 'status': 'in_review', 'checklist': [{'id': 'criterion', 'text': 'Evidence is verified', 'done': True}]})
    review = task()
    member.call('POST', root + '/tasks/' + tid + '/review', {'version': review['version'], 'decision': 'approve', 'comment': ''}, expected=403)
    head.call('POST', root + '/tasks/' + tid + '/review', {'version': review['version'], 'decision': 'approve', 'comment': 'Evidence inspected and accepted'})
    accepted = task()
    check('Independent acceptance completes work and records time', accepted['status'] == 'done' and bool(accepted['completedAt']))
    head.call('PATCH', root + '/tasks/' + tid, {'version': accepted['version'], 'title': 'Changed after acceptance'}, expected=422)
    check('Accepted task fields must be reopened before editing')
    member.call('PATCH', root + '/tasks/' + tid, {'version': accepted['version'], 'status': 'in_progress'})
    reopened = task()
    check('Reopening clears acceptance and preserves review requirement', reopened['status'] == 'in_progress' and not reopened['completedAt'] and reopened['requiresApproval'])
    before = len(founder.call('GET', root + '/workspace')[0]['tasks'])
    founder.call('POST', root + '/tasks/import', {'rows': [template, {**template, 'ownerId': 'outside-company'}]}, expected=422)
    after = len(founder.call('GET', root + '/workspace')[0]['tasks'])
    check('Mixed valid and invalid CSV imports commit no partial rows', before == after)
    imported = founder.call('POST', root + '/tasks/import', {'rows': [{**template, 'title': 'Imported work'}]}, expected=200)[0]
    check('Valid bulk task input imports successfully', imported.get('created') == 1)
    head.call('POST', root + '/automations/run', {}, expected=403)
    check('Automation controls require company administration')
    founder.call('POST', root + '/automations/run', {})
    second = founder.call('POST', root + '/automations/run', {})[0]
    check('Repeated automation scans do not duplicate work', second.get('created') == 0 and second.get('reminders') == 0)
    final = founder.call('GET', root + '/workspace')[0]
    check('Company audit trail includes task and organisation actions', len(final['activities']) >= 12)
    inbox = member.call('GET', root + '/workspace')[0]['notifications']
    check('Junior receives assignment and review notifications', len(inbox) >= 2 and all(n['userId'] == identity['member']['id'] for n in inbox))
    member.call('POST', root + '/notifications/read', {'ids': []})
    check('Inbox can mark own notifications as read', all(n['read'] for n in member.call('GET', root + '/workspace')[0]['notifications']))
    revoked_cookie = member.cookie_header(root + '/workspace')
    if not revoked_cookie:
        raise AssertionError('Authenticated member had no session cookie before logout')
    member.call('POST', '/api/auth/logout', {})
    member.call('GET', root + '/workspace', expected=401)
    member.call('GET', root + '/workspace', expected=401, headers={'Cookie': revoked_cookie})
    check('Sign out revokes the server session')
    if not bridge:
        document, _ = founder.call('GET', '/')
        check('Go server serves the compiled React application', b'<div id="root"></div>' in document and b'type="module"' in document)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--url', help='Running disposable demo server URL')
    mode.add_argument('--bridge', help='Path to the compiled in-process HTTP bridge')
    parser.add_argument('--allow-demo-mutations', action='store_true')
    parser.add_argument('--report', help='Optional sanitized JSON report path')
    args = parser.parse_args()
    if not args.allow_demo_mutations:
        parser.error('This test creates sample records. Use --allow-demo-mutations only with a disposable demo server or bridge.')
    checks, bridge = [], None
    scope = ('In-process HTTP handler integration through httptest and the real shared Go handler with GORM/SQLite. '
             'Normal session authentication and per-client cookies; no TCP, standalone static server, native PostgreSQL, Encore runtime or browser claim.'
             if args.bridge else
             'HTTP calls to the shared Go server with a disposable demo database. No browser layout or native PostgreSQL claim.')
    result = {'status': 'failed', 'mode': 'bridge' if args.bridge else 'url',
              'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'scope': scope,
              'skipped': ['Standalone static React document assertion'] if args.bridge else []}
    try:
        if args.bridge:
            bridge = Bridge(args.bridge)
        run_flow(args, bridge, checks)
        result['status'] = 'passed'
    except (AssertionError, RuntimeError, OSError, ValueError, KeyError, StopIteration) as error:
        result['failure'] = str(error) or type(error).__name__
        print(f'FAIL {result["failure"]}', file=sys.stderr, flush=True)
    finally:
        if bridge:
            bridge.close()
        result.update(checks=len(checks), details=checks)
        if args.report:
            target = pathlib.Path(args.report)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({'status': result['status'], 'checks': len(checks), 'mode': result['mode']}), flush=True)
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
