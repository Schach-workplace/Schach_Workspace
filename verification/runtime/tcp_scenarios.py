"""Reuse existing scenarios over TCP, only against disposable demo servers.

Pass --allow-demo-mutations and --url. For API-only Encore pass --api-only.
Concurrent finance requests start from a shared barrier on separate connections.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import json
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import http_flow
import finance_flow


class TCPTransport:
    def __init__(self, url):
        self.url = url.rstrip('/')

    def call(self, method, path, body, headers):
        request = urllib.request.Request(self.url + path, data=body, headers=headers, method=method)
        try:
            response = urllib.request.urlopen(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, response.read(), response.headers

    def concurrent(self, requests):
        barrier = threading.Barrier(len(requests))

        def execute(item):
            client, method, path, body = item
            barrier.wait(timeout=20)
            status, raw, _ = self.call(method, path, json.dumps(body).encode(), {
                'Content-Type': 'application/json', 'Cookie': client.cookie_header(path)})
            return status, json.loads(raw)

        with ThreadPoolExecutor(max_workers=len(requests)) as pool:
            return list(pool.map(execute, requests))


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', required=True)
parser.add_argument('--api-only', action='store_true')
parser.add_argument('--allow-demo-mutations', action='store_true')
parser.add_argument('--report', required=True)
args = parser.parse_args()
if not args.allow_demo_mutations:
    parser.error('Requires explicit --allow-demo-mutations for a disposable demo server.')
transport = TCPTransport(args.url)
result = {'status': 'failed', 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
          'scope': 'Existing workspace/finance scenarios via TCP with independent session cookies; finance batch uses separate concurrent HTTP connections.',
          'url': args.url, 'apiOnly': args.api_only}
checks = []
try:
    # Transport mode omits the standalone-only static-document assertion.
    http_flow.run_flow(SimpleNamespace(url=args.url), transport, checks)
    result['workspaceChecks'] = len(checks)
    if not args.api_only:
        _, document, _ = transport.call('GET', '/', None, {})
        assert b'<div id="root"></div>' in document and b'type="module"' in document
        checks.append('Standalone serves compiled React document')
        result['workspaceChecks'] += 1
    finance_checks = []
    finance_flow.run_flow(transport, finance_checks)
    result['financeChecks'] = len(finance_checks)
    checks.extend(finance_checks)
    result['status'] = 'passed'
except Exception as error:
    result['failure'] = str(error)
    raise
finally:
    result['checks'] = checks
    Path(args.report).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'checks'}))
