#!/usr/bin/env python3
"""Verify finance through the real shared Go handler in a disposable bridge.

Build verification/httpbridge, then run this file with --bridge PATH and
--allow-demo-mutations. It uses normal session cookies and fictional records.
There is no TCP connection or native PostgreSQL/Encore/browser claim.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import pathlib
import sys
import uuid

from http_flow import Bridge, Client


class FinanceBridge(Bridge):
    """Normal single requests plus an explicitly concurrent handler batch."""

    def concurrent(self, requests):
        batch = []
        for client, method, path, body in requests:
            batch.append({
                'method': method, 'path': path,
                'body': base64.b64encode(json.dumps(body).encode()).decode('ascii'),
                'headers': {'Content-Type': 'application/json',
                            'Cookie': client.cookie_header(path)},
            })
        self.process.stdin.write(json.dumps({'batch': batch}) + '\n')
        self.process.stdin.flush()
        if not self.selector.select(timeout=30):
            raise TimeoutError('Concurrent handler batch did not finish within 30 seconds')
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError('Bridge stopped during concurrent handler batch')
        result = json.loads(line)
        responses = result.get('responses')
        if not isinstance(responses, list) or len(responses) != len(batch):
            raise AssertionError('Bridge did not return one ordered result per concurrent request')
        return [(response['status'], json.loads(base64.b64decode(response['body'])))
                for response in responses]


def run_flow(bridge, checks):
    def check(name, condition=True):
        if not condition:
            raise AssertionError(name)
        checks.append(name)
        print(f'PASS {name}', flush=True)

    def deny(client, method, path, body=None, statuses=(403, 404)):
        payload = json.dumps(body).encode() if body is not None else b''
        status, raw, _ = bridge.call(method, path, payload, {
            'Content-Type': 'application/json', 'Cookie': client.cookie_header(path),
        })
        value = json.loads(raw)
        if status not in statuses or 'error' not in value:
            raise AssertionError(f'{method} {path}: expected denial {statuses}, got {status}: {value}')
        return value

    def client(email=None, password='Fictional-Finance-QA!2026'):
        value = Client('http://bridge.invalid', bridge)
        if email:
            value.call('POST', '/api/auth/login', {'email': email, 'password': password})
        return value

    founder = client()
    founder.call('GET', '/api/companies/c-schach/workspace', expected=401)
    founder_session = founder.call('POST', '/api/auth/login', {
        'email': 'founder@schach.demo', 'password': 'SchachDemo!2026',
    })[0]
    founder_id = founder_session['user']['id']
    check('Finance requests use the normal authenticated session boundary')
    suffix = uuid.uuid4().hex[:10]
    today = dt.datetime.now(dt.timezone.utc).date()
    fiscal_start_year = today.year if today.month >= 4 else today.year - 1
    start = dt.date(fiscal_start_year, 4, 1).isoformat()
    end = dt.date(fiscal_start_year + 1, 3, 31).isoformat()

    def create_company(label):
        return founder.call('POST', '/api/companies', {
            'name': f'Finance QA {label} {suffix}', 'slug': f'finance-qa-{label}-{suffix}',
            'timezone': 'UTC', 'color': '#F97316',
        })[0]['id']

    cid = create_company('primary')
    foreign_cid = create_company('foreign')
    root = f'/api/companies/{cid}'
    foreign_root = f'/api/companies/{foreign_cid}'

    def workspace(actor=founder):
        return actor.call('GET', root + '/workspace')[0]

    initial = workspace()
    check('New companies receive INR, April fiscal year, starter categories, and empty transaction arrays',
          initial['company']['currency'] == 'INR'
          and initial['company']['fiscalYearStartMonth'] == 4
          and initial['financeScope'] == 'company'
          and isinstance(initial['expenseCategories'], list) and len(initial['expenseCategories']) >= 7
          and all(initial[key] == [] for key in ('expenses', 'budgets', 'financeEvents')))

    def department(name, target=root):
        return founder.call('POST', target + '/departments', {
            'name': name, 'description': 'Fictional verification department',
            'headId': '', 'color': '#F97316',
        })[0]['id']

    did = department('Delivery')
    other_did = department('Operations')
    foreign_did = department('Foreign department', foreign_root)
    identities = {'founder': founder_id}
    actors = {'founder': founder}
    definitions = [('finance', 'finance', did), ('head', 'head', did),
                   ('manager', 'manager', did), ('member', 'member', did),
                   ('other_head', 'head', other_did), ('other_member', 'member', other_did),
                   ('viewer', 'viewer', did)]
    for label, role, department_id in definitions:
        email = f'{label}-{suffix}@finance-verification.demo'
        identity = founder.call('POST', root + '/people', {
            'name': f'Fictional Finance QA {label}', 'email': email,
            'password': 'Fictional-Finance-QA!2026', 'role': role,
            'departmentId': department_id, 'managerId': identities.get('manager', founder_id),
            'title': f'Verification {label}', 'capacityHours': 40,
        })[0]['id']
        identities[label] = identity
        actors[label] = client(email)
    finance, head, member = actors['finance'], actors['head'], actors['member']
    manager, other_head, other_member, viewer = (actors[key] for key in ('manager', 'other_head', 'other_member', 'viewer'))
    expected_scopes = {'founder': 'company', 'finance': 'company', 'head': 'department',
                       'manager': 'personal', 'member': 'personal', 'other_head': 'department',
                       'other_member': 'personal', 'viewer': 'none'}
    check('All eight role scenarios receive the specified financial scope',
          all(workspace(actors[label])['financeScope'] == scope for label, scope in expected_scopes.items()))
    deny(finance, 'PATCH', root, {'name': 'Disallowed administration'}, (403,))
    deny(finance, 'POST', root + '/departments', {'name': 'Disallowed department'}, (403,))
    deny(finance, 'PATCH', root + '/people/' + founder_id, {'title': 'Disallowed edit'}, (403,))
    check('Finance role does not acquire company, department, or membership administration')

    def category(name, required=False, active=True, target=root):
        return founder.call('POST', target + '/expense-categories', {
            'name': name, 'color': '#F97316', 'active': active, 'receiptRequired': required,
        })[0]['id']

    category_id = category('Office and operations')
    receipt_category_id = category('Travel with evidence', required=True)
    inactive_category_id = category('Archived category', active=False)
    foreign_category_id = category('Foreign category', target=foreign_root)
    cat = next(row for row in workspace()['expenseCategories'] if row['id'] == category_id)
    finance.call('PATCH', root + '/expense-categories/' + category_id,
                 {'version': cat['version'], 'name': 'Office and operations revised'})
    finance.call('PATCH', root + '/expense-categories/' + category_id,
                 {'version': cat['version'], 'name': 'Stale category edit'}, expected=409)
    deny(head, 'POST', root + '/expense-categories', {'name': 'Disallowed category'}, (403,))
    check('Finance manages versioned categories; stale and head category writes are rejected')

    budget_template = {'departmentId': did, 'name': 'Delivery financial year', 'startDate': start,
                       'endDate': end, 'amountMinor': 100000, 'status': 'active', 'notes': 'QA allocation'}
    budget_id = finance.call('POST', root + '/budgets', budget_template)[0]['id']

    def budget():
        return next(row for row in workspace()['budgets'] if row['id'] == budget_id)

    for amount in (-1, 0.5, 1000000000001):
        finance.call('POST', root + '/budgets', {**budget_template, 'departmentId': other_did,
                                                'amountMinor': amount}, expected=422)
    zero_budget = finance.call('POST', root + '/budgets', {
        **budget_template, 'departmentId': other_did, 'amountMinor': 0, 'status': 'draft',
    })[0]['id']
    check('Budget amounts reject fractional, negative, and over-limit values while accepting zero')
    finance.call('POST', root + '/budgets', {**budget_template, 'status': 'draft'}, expected=422)
    finance.call('POST', root + '/budgets', {**budget_template, 'startDate': end}, expected=422)
    check('Inclusive budget overlap is rejected even for draft envelopes and shared boundary dates')
    finance.call('POST', root + '/budgets', {**budget_template, 'departmentId': foreign_did}, expected=422)
    finance.call('POST', root + '/budgets', {
        **budget_template, 'startDate': end,
        'endDate': (dt.date.fromisoformat(end) + dt.timedelta(days=1)).isoformat(),
    }, expected=422)
    deny(head, 'POST', root + '/budgets', budget_template, (403,))
    check('Budget references, fiscal-year boundaries, and management permissions are enforced')
    founder.call('PATCH', root, {'currency': 'USD'}, expected=422)
    founder.call('PATCH', root, {'fiscalYearStartMonth': 1}, expected=422)
    check('Company currency and fiscal-year month freeze after financial records exist')
    for changes in ({'departmentId': other_did},
                    {'startDate': (dt.date.fromisoformat(start) + dt.timedelta(days=1)).isoformat()},
                    {'endDate': (dt.date.fromisoformat(end) - dt.timedelta(days=1)).isoformat()}):
        finance.call('PATCH', root + '/budgets/' + budget_id,
                     {'version': budget()['version'], 'reason': 'Reviewed change request for QA', **changes}, expected=422)
    finance.call('PATCH', root + '/budgets/' + budget_id,
                 {'version': budget()['version'], 'amountMinor': 90000}, expected=422)
    check('Activated budget scope is immutable and allocation revisions require a reason')
    check('Personal scopes omit budget totals and viewers receive no financial arrays',
          workspace(member)['budgets'] == [] and workspace(manager)['budgets'] == []
          and all(workspace(viewer)[key] == [] for key in ('expenses', 'budgets', 'expenseCategories', 'financeEvents')))

    expense_template = {'departmentId': did, 'categoryId': category_id,
                        'title': 'Fictional office supplies', 'description': 'Finance verification fixture',
                        'vendor': 'Acme Suppliers', 'invoiceNumber': '', 'expenseDate': today.isoformat(),
                        'amountMinor': 12345, 'projectId': '', 'taskId': '', 'receiptExceptionReason': ''}

    def create_expense(actor=member, **changes):
        return actor.call('POST', root + '/expenses', {**expense_template, **changes})[0]['id']

    def expense(expense_id, actor=founder):
        return next(row for row in workspace(actor)['expenses'] if row['id'] == expense_id)

    def transition(actor, expense_id, action, expected=200, **fields):
        fields.setdefault('version', expense(expense_id)['version'])
        return actor.call('POST', root + '/expenses/' + expense_id + '/transition',
                          {'action': action, **fields}, expected=expected)[0]

    def patch(actor, expense_id, expected=200, **fields):
        fields.setdefault('version', expense(expense_id)['version'])
        return actor.call('PATCH', root + '/expenses/' + expense_id, fields, expected=expected)[0]

    def paid_fields(reference):
        return {'paidDate': today.isoformat(), 'paymentMethod': 'bank_transfer', 'paymentReference': reference}

    def used():
        return sum(row['amountMinor'] for row in workspace()['expenses']
                   if row['departmentId'] == did and start <= row['expenseDate'] <= end
                   and row['status'] in ('approved', 'paid'))

    for amount in (0, -1, 1.5, 1000000000001, 9007199254740992):
        member.call('POST', root + '/expenses', {**expense_template, 'amountMinor': amount}, expected=422)
    max_id = create_expense(amountMinor=1000000000000, vendor='Maximum boundary fixture')
    check('Expense money validates exact integer minor units and the documented upper boundary',
          expense(max_id)['amountMinor'] == 1000000000000 and expense(max_id)['status'] == 'draft')
    future_date = (today + dt.timedelta(days=1)).isoformat()
    member.call('POST', root + '/expenses', {**expense_template, 'expenseDate': future_date}, expected=422)
    patch(member, max_id, expected=422, expenseDate=future_date)
    check('Future expense dates are rejected in the company timezone without changing a draft version',
          expense(max_id)['expenseDate'] == today.isoformat() and expense(max_id)['version'] == 1)
    unicode_id = create_expense(title='界' * 240, vendor='आ' * 240, invoiceNumber='票' * 160,
                                description='व' * 8000, receiptExceptionReason='अ' * 12, amountMinor=3)
    for changes in ({'title': '界' * 241}, {'vendor': 'आ' * 241}, {'invoiceNumber': '票' * 161},
                    {'description': 'व' * 8001}, {'receiptExceptionReason': 'अ' * 11}):
        patch(member, unicode_id, expected=422, **changes)
    check('Financial text limits count Unicode characters and preserve valid multilingual boundary values',
          expense(unicode_id)['title'] == '界' * 240 and expense(unicode_id)['description'] == 'व' * 8000
          and expense(unicode_id)['receiptExceptionReason'] == 'अ' * 12 and expense(unicode_id)['version'] == 1)
    for extra in ({'status': 'paid'}, {'currency': 'USD'}, {'createdBy': founder_id}, {'version': 44}, {'code': 'FORGED-1'}):
        member.call('POST', root + '/expenses', {**expense_template, **extra}, expected=422)
    check('Clients cannot forge creator, currency, code, version, or workflow at expense creation')
    for changes in ({'departmentId': foreign_did}, {'categoryId': foreign_category_id}, {'categoryId': inactive_category_id}):
        member.call('POST', root + '/expenses', {**expense_template, **changes}, expected=422)
    deny(member, 'POST', root + '/expenses', {**expense_template, 'departmentId': other_did}, (403,))
    deny(viewer, 'POST', root + '/expenses', expense_template, (403,))
    check('Expense references cannot cross tenants; creators remain in their allowed department')

    private_project = founder.call('POST', root + '/projects', {
        'name': 'Restricted project', 'ownerId': founder_id, 'departmentId': did,
        'status': 'active', 'color': '#F97316', 'dueDate': today.isoformat(),
    })[0]['id']
    private_task = founder.call('POST', root + '/tasks', {
        'title': 'Restricted company leadership task', 'ownerId': founder_id, 'departmentId': did,
        'projectId': private_project, 'status': 'todo', 'priority': 'medium',
    })[0]['id']
    linked_id = create_expense(founder, amountMinor=500)
    patch(founder, linked_id, projectId=private_project, taskId=private_task)
    finance_copy = expense(linked_id, finance)
    check('Company financial visibility does not expose hidden task/project links',
          finance_copy['taskId'] == '' and finance_copy['projectId'] == ''
          and not any(row['id'] == private_task for row in workspace(finance)['tasks'])
          and not any(private_task in row['detail'] or private_project in row['detail']
                      for row in workspace(finance)['financeEvents']))
    finance.call('POST', root + '/expenses', {**expense_template, 'taskId': private_task}, expected=422)
    deny(finance, 'PATCH', root + '/tasks/' + private_task, {'version': 1, 'progress': 10})
    check('Finance role cannot use an expense link to acquire task write permission')

    eid = create_expense(categoryId=receipt_category_id, invoiceNumber='INV-001')
    row = expense(eid)
    check('Expense identity, creator, currency snapshot, draft state, and exact amount are server supplied',
          row['createdBy'] == identities['member'] and row['currency'] == 'INR'
          and row['status'] == 'draft' and row['amountMinor'] == 12345 and row['version'] == 1
          and bool(row['code']))
    member.call('POST', root + '/expenses', {**expense_template, 'vendor': '  acme   suppliers  ',
                                           'invoiceNumber': '  inv-001  '}, expected=422)
    check('Case and whitespace variations cannot duplicate a non-void vendor/invoice pair')
    deny(finance, 'PATCH', root + '/expenses/' + eid, {'version': row['version'], 'amountMinor': 99}, (403,))
    deny(founder, 'PATCH', foreign_root + '/expenses/' + eid, {'version': row['version'], 'title': 'Wrong company'}, (404,))
    patch(member, eid, expected=422, createdBy=founder_id)
    check('Expense editing is creator-only and cannot change tenant or creator identity')
    transition(finance, eid, 'approve', expected=422)
    transition(member, eid, 'submit', expected=422)
    check('Approval cannot skip submission and required evidence blocks submission')

    def upload(actor, expense_id, content, filename='receipt.txt', expected=200):
        boundary = 'FinanceVerification' + uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                'Content-Type: text/plain\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
        return actor.call('POST', root + '/expenses/' + expense_id + '/receipts', body,
                          expected=expected, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})[0]

    upload(member, eid, b'Not an executable', filename='receipt.exe', expected=422)
    contents = b'Fictional receipt: ACME INV-001 total INR 123.45.\n'
    upload(member, eid, contents)
    with_receipt = expense(eid)
    receipt = with_receipt['receipts'][0]
    check('Safe receipt bytes persist and append advances the expense version',
          with_receipt['version'] == row['version'] + 1 and len(with_receipt['receipts']) == 1
          and receipt['size'] == len(contents) and receipt['uploadedBy'] == identities['member'])
    body, headers = finance.call('GET', root + '/expense-receipts/' + receipt['id'])
    check('Authorised receipt download preserves bytes and attachment security headers',
          body == contents and 'attachment' in headers.get('Content-Disposition', '').lower()
          and headers.get('X-Content-Type-Options') == 'nosniff')
    deny(viewer, 'GET', root + '/expense-receipts/' + receipt['id'])
    deny(other_member, 'GET', root + '/expense-receipts/' + receipt['id'])
    deny(founder, 'GET', foreign_root + '/expense-receipts/' + receipt['id'])
    upload(head, eid, b'Head is not an authorised uploader', expected=403)
    check('Receipts enforce expense scope, company scope, and creator/finance upload permission')
    transition(member, eid, 'submit')
    patch(member, eid, expected=422, amountMinor=12400)
    patch(member, eid, expected=422, departmentId=other_did)
    check('Submitted financial decision fields freeze until withdrawal or rejection')
    old_version = expense(eid)['version']
    upload(finance, eid, b'Additional finance evidence for the submitted expense.\n')
    transition(head, eid, 'approve', version=old_version, expected=409)
    check('Newly appended evidence invalidates an approval based on an older expense version',
          expense(eid)['version'] == old_version + 1 and expense(eid)['status'] == 'submitted')
    transition(head, eid, 'approve')
    approved = expense(eid)
    check('Independent head approves an in-scope expense inside the active budget',
          approved['status'] == 'approved' and approved['reviewedBy'] == identities['head'])
    transition(head, eid, 'approve', version=approved['version'] - 1, expected=409)
    transition(member, eid, 'void', note='Creator cannot erase independent approval', expected=403)
    check('Stale approval cannot repeat and creator cannot void their approved expense')

    exception_id = create_expense(amountMinor=1000, categoryId=receipt_category_id,
                                  receiptExceptionReason='Receipt was lost during the verified business journey.')
    transition(member, exception_id, 'submit')
    transition(head, exception_id, 'approve', expected=422)
    transition(head, exception_id, 'approve', note='Too short', expected=422)
    exception_note = 'Reviewed the missing receipt exception and accepted the documented reason.'
    transition(head, exception_id, 'approve', note=exception_note)
    check('Receipt exception requires an explicit independent approval note of meaningful length',
          expense(exception_id)['reviewNote'] == exception_note)

    for owner_label, reviewer_label, amount in [('founder', 'finance', 999), ('finance', 'founder', 444)]:
        owner, reviewer = actors[owner_label], actors[reviewer_label]
        own_id = create_expense(owner, amountMinor=amount, vendor=f'{owner_label} own expense fixture')
        transition(owner, own_id, 'submit')
        transition(owner, own_id, 'approve', expected=403)
        transition(owner, own_id, 'reject', note='Creator cannot decide their own request', expected=403)
        transition(reviewer, own_id, 'approve')
        transition(owner, own_id, 'pay', expected=403, **paid_fields('SELF-PAY-DENIED'))
        transition(reviewer, own_id, 'pay', **paid_fields(f'QA-{owner_label.upper()}-PAYMENT'))
    check('Founder and finance authority both remain unable to approve, reject, or pay their own expense')
    before_pay = used()
    transition(head, eid, 'pay', expected=403, **paid_fields('HEAD-PAY-DENIED'))
    transition(finance, eid, 'pay', expected=422)
    transition(finance, eid, 'pay', expected=422, **{**paid_fields('FUTURE-DATE'),
                                                  'paidDate': (today + dt.timedelta(days=1)).isoformat()})
    transition(finance, eid, 'pay', expected=422, **{**paid_fields('EARLY-DATE'),
                                                  'paidDate': (today - dt.timedelta(days=1)).isoformat()})
    transition(finance, eid, 'pay', expected=422, **{**paid_fields('BAD-METHOD'), 'paymentMethod': 'crypto'})
    transition(finance, eid, 'pay', expected=422, **{**paid_fields(''), 'paymentReference': '   '})
    check('Payment recording checks authority, payment method/reference, and company-local date bounds')
    payable_version = expense(eid)['version']
    transition(finance, eid, 'pay', **paid_fields('QA-BANK-0001'))
    paid = expense(eid)
    check('Recording payment moves approved value to paid without double counting budget use',
          paid['status'] == 'paid' and paid['paidBy'] == identities['finance']
          and paid['paymentReference'] == 'QA-BANK-0001' and paid['amountMinor'] == 12345
          and used() == before_pay == 14788)
    transition(finance, eid, 'pay', version=payable_version, expected=409, **paid_fields('DUPLICATE-CLICK'))
    transition(finance, eid, 'pay', expected=422, **paid_fields('DUPLICATE-FRESH'))
    transition(finance, eid, 'void', note='Paid records cannot be destructively reversed', expected=422)
    patch(member, eid, expected=422, amountMinor=1)
    check('Duplicate payment clicks and all attempted paid-record edits or voids are rejected')

    visible = workspace(member)
    check('Personal financial reads contain only the immutable creator’s expenses',
          all(row['createdBy'] == identities['member'] for row in visible['expenses']))
    check('Department heads cannot see other department expenses or events',
          all(row['departmentId'] == did or row.get('createdBy') == identities['head'] for row in workspace(head)['expenses'])
          and not any(row['departmentId'] == other_did for row in workspace(head)['financeEvents']))

    current_budget = budget()
    allocation = used() + 7000
    finance.call('PATCH', root + '/budgets/' + budget_id, {
        'version': current_budget['version'], 'amountMinor': allocation,
        'reason': 'Set a measured remaining capacity for concurrent approval verification.',
    })
    finance.call('PATCH', root + '/budgets/' + budget_id, {
        'version': current_budget['version'], 'amountMinor': allocation + 1,
        'reason': 'A stale budget edit must not overwrite the latest allocation.',
    }, expected=409)
    check('Reasoned allocation revisions persist and stale budget writes conflict')
    race_ids = [create_expense(member, amountMinor=5000, vendor='Race request one'),
                create_expense(manager, amountMinor=5000, vendor='Race request two')]
    transition(member, race_ids[0], 'submit')
    transition(manager, race_ids[1], 'submit')
    snapshots = [expense(race_ids[0], head), expense(race_ids[1], finance)]
    check('Submitted requests are pending and do not reserve or double-count available budget',
          budget()['amountMinor'] - used() == 7000)
    responses = bridge.concurrent([
        (head, 'POST', root + '/expenses/' + race_ids[0] + '/transition',
         {'version': snapshots[0]['version'], 'action': 'approve'}),
        (finance, 'POST', root + '/expenses/' + race_ids[1] + '/transition',
         {'version': snapshots[1]['version'], 'action': 'approve'}),
    ])
    check('Simultaneous handler approvals recheck shared budget capacity: exactly one fits',
          sorted(status for status, _ in responses) == [200, 422]
          and sorted(expense(expense_id)['status'] for expense_id in race_ids) == ['approved', 'submitted']
          and budget()['amountMinor'] - used() == 2000)
    loser_id = next(expense_id for expense_id in race_ids if expense(expense_id)['status'] == 'submitted')
    transition(finance, loser_id, 'approve', expected=422)
    transition(head, loser_id, 'approve', expected=403, overrideReason='Explicit override cannot enlarge a head role.')
    transition(finance, loser_id, 'approve', expected=422, overrideReason='Too short')
    override = 'Leadership accepted this additional spend after reviewing the current budget shortfall.'
    transition(finance, loser_id, 'approve', overrideReason=override)
    check('Only company finance authority can approve overspend with a meaningful explicit override',
          expense(loser_id)['budgetOverrideReason'] == override and budget()['amountMinor'] - used() == -3000)
    below_used = used() - 500
    budget_reason = 'Revised the approved allocation while preserving the existing recorded commitments.'
    finance.call('PATCH', root + '/budgets/' + budget_id,
                 {'version': budget()['version'], 'amountMinor': below_used, 'reason': budget_reason})
    check('Reasoned allocation below used value preserves commitments and exposes negative availability',
          budget()['amountMinor'] - used() == -500
          and any(event['entityId'] == budget_id and budget_reason in event['detail'] for event in workspace()['financeEvents']))

    no_budget_id = create_expense(other_member, departmentId=other_did, amountMinor=500, vendor='Draft-budget expense')
    transition(other_member, no_budget_id, 'submit')
    transition(other_head, no_budget_id, 'approve', expected=422)
    transition(finance, no_budget_id, 'approve', expected=422)
    transition(finance, no_budget_id, 'approve', overrideReason='No active budget is in place; leadership approved this exceptional item.')
    check('A draft budget does not authorise spending; absence of an active budget needs company override')
    check('Department and personal scope exclude another department’s financial records',
          not any(row['id'] == no_budget_id for row in workspace(head)['expenses'])
          and not any(row['id'] == no_budget_id for row in workspace(member)['expenses']))

    finance.call('PATCH', root + '/budgets/' + budget_id,
                 {'version': budget()['version'], 'amountMinor': used() + 10000,
                  'reason': 'Provide sufficient allocation to isolate the closed-budget workflow check.'})
    finance.call('PATCH', root + '/budgets/' + budget_id,
                 {'version': budget()['version'], 'status': 'closed'}, expected=422)
    finance.call('PATCH', root + '/budgets/' + budget_id,
                 {'version': budget()['version'], 'status': 'closed',
                  'reason': 'Closed the verified reporting period pending leadership review.'})
    closed_id = create_expense(amountMinor=100, vendor='Closed-budget workflow')
    transition(member, closed_id, 'submit')
    transition(head, closed_id, 'approve', expected=422)
    transition(finance, closed_id, 'approve', expected=422)
    transition(finance, closed_id, 'approve', overrideReason='Leadership approved a late item after this budget was closed.')
    check('Closed budgets require an explicit company override despite sufficient numeric capacity')
    finance.call('PATCH', root + '/budgets/' + budget_id,
                 {'version': budget()['version'], 'status': 'active'}, expected=422)
    finance.call('PATCH', root + '/budgets/' + budget_id,
                 {'version': budget()['version'], 'status': 'active',
                  'reason': 'Reopened this budget after completing the controlled review.'})
    finance.call('PATCH', root + '/budgets/' + budget_id,
                 {'version': budget()['version'], 'status': 'draft',
                  'reason': 'An activated budget cannot revert to a draft state.'}, expected=422)
    check('Closing and reopening require reasons; activated budgets never return to draft')

    correction_id = create_expense(amountMinor=2500, vendor='Correction lifecycle')
    transition(member, correction_id, 'submit')
    transition(head, correction_id, 'reject', expected=422)
    transition(head, correction_id, 'reject', note='Clarify this business purpose before another review.')
    patch(member, correction_id, amountMinor=2600, description='Corrected amount and explanation for review.')
    transition(member, correction_id, 'submit')
    transition(member, correction_id, 'withdraw')
    check('Rejected expense can be corrected and resubmitted; withdrawal returns it to draft',
          expense(correction_id)['status'] == 'draft' and expense(correction_id)['amountMinor'] == 2600)
    transition(member, correction_id, 'void', expected=422)
    transition(member, correction_id, 'void', note='The creator withdrew this duplicate request permanently.')
    patch(member, correction_id, expected=422, amountMinor=10)
    transition(member, correction_id, 'submit', expected=422)
    before_void = used()
    transition(head, exception_id, 'void', note='Independently voided the approved obligation before payment.')
    check('Void is final; independent approved void releases exactly the prior commitment',
          expense(correction_id)['status'] == 'void' and expense(exception_id)['status'] == 'void'
          and used() == before_void - 1000)

    active_category = next(row for row in workspace()['expenseCategories'] if row['id'] == category_id)
    finance.call('PATCH', root + '/expense-categories/' + category_id,
                 {'version': active_category['version'], 'active': False})
    member.call('POST', root + '/expenses', expense_template, expected=422)
    check('Archived category blocks new entries while preserving existing expenses and their amounts',
          any(row['id'] == category_id and not row['active'] for row in workspace()['expenseCategories'])
          and expense(eid)['amountMinor'] == 12345)
    events = workspace()['financeEvents']
    check('Financial decisions, overrides, payments, receipt additions, and budget revisions retain scoped audit events',
          all(any(event['entityId'] == expense_id for event in events)
              for expense_id in [eid, exception_id, *race_ids, correction_id])
          and any(event['entityId'] == budget_id for event in events)
          and all(not any(key in event['detail'].lower() for key in ('schach_session=', 'password_hash')) for event in events))
    task_activities = workspace()['activities']
    check('Financial payment and override details do not leak into broad task activity feeds',
          not any('QA-BANK-0001' in event['detail'] or override in event['detail'] for event in task_activities))
    founder.call('PATCH', root + '/people/' + identities['finance'], {'role': 'member'})
    deny(finance, 'GET', root + '/workspace', statuses=(401,))
    finance = client(f'finance-{suffix}@finance-verification.demo')
    reduced = workspace(finance)
    deny(finance, 'POST', root + '/budgets', budget_template, (403,))
    check('Role changes immediately narrow financial read scope and revoke financial management writes',
          reduced['financeScope'] == 'personal' and reduced['budgets'] == []
          and all(row['createdBy'] == identities['finance'] for row in reduced['expenses']))
    founder.call('PATCH', root + '/people/' + identities['finance'], {'active': False})
    deny(finance, 'GET', root + '/workspace', statuses=(401,))
    deny(finance, 'POST', root + '/expenses/' + eid + '/transition',
         {'version': expense(eid)['version'], 'action': 'pay', **paid_fields('REVOKED')}, (401,))
    check('Revoked membership cannot read finance or execute a mutation using its existing cookie')
    check('Receipt and payment history survive category archival and actor role changes',
          expense(eid)['status'] == 'paid' and len(expense(eid)['receipts']) == 2
          and expense(eid)['reviewedBy'] == identities['head'] and expense(eid)['paidBy'] == identities['finance'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bridge', required=True, help='Compiled verification/httpbridge binary')
    parser.add_argument('--allow-demo-mutations', action='store_true')
    parser.add_argument('--report', default=str(pathlib.Path(__file__).with_name('finance-result.json')))
    args = parser.parse_args()
    if not args.allow_demo_mutations:
        parser.error('This flow creates fictional records. Explicitly enable --allow-demo-mutations for the disposable bridge.')
    checks, bridge = [], None
    repository = pathlib.Path(__file__).resolve().parents[1]
    sources = sorted((repository / 'backend/platform').glob('*.go'))
    sources += sorted((repository / 'backend/migrations').glob('*.sql'))
    sources += [
        repository / 'backend/platform/sample.json',
        repository / 'backend/go.mod', repository / 'backend/go.sum',
        pathlib.Path(__file__).resolve(), repository / 'verification/http_flow.py',
        repository / 'verification/httpbridge/main.go',
        repository / 'verification/httpbridge/go.mod', repository / 'verification/httpbridge/go.sum',
    ]
    result = {
        'status': 'failed', 'kind': 'Independent finance HTTP handler integration',
        'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'scope': 'Real shared Go handler through httptest, normal session cookies, GORM and disposable in-memory SQLite. Concurrent batches use simultaneous handler goroutines sharing this fixture database.',
        'limitations': [
            'No TCP, standalone static server, native PostgreSQL, pgx, Encore runtime, production deployment, or actual browser was exercised.',
            'The SQLite bridge has one database connection; simultaneous handler results do not certify PostgreSQL row locking, deadlocks, pool behavior, or multi-instance concurrency.',
            'Amounts are checked at the HTTP boundary; exact decimal input parsing and rendered financial reports require the separate frontend suite.',
            'This records fictional external payment references only; no money transfer, banking integration, tax calculation, or reconciliation is performed.',
        ],
        'sourceSha256': {str(path.relative_to(repository)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources},
        'bridgeSha256': hashlib.sha256(pathlib.Path(args.bridge).resolve().read_bytes()).hexdigest(),
    }
    try:
        bridge = FinanceBridge(args.bridge)
        run_flow(bridge, checks)
        result['status'] = 'passed'
    except (AssertionError, RuntimeError, OSError, ValueError, KeyError, StopIteration) as error:
        result['failure'] = str(error) or type(error).__name__
        print(f'FAIL {result["failure"]}', file=sys.stderr, flush=True)
    finally:
        if bridge:
            bridge.close()
        result.update(checks=len(checks), details=checks)
        target = pathlib.Path(args.report)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({'status': result['status'], 'checks': len(checks), 'report': str(target)}), flush=True)
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
