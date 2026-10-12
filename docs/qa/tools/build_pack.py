#!/usr/bin/env python3
"""Build the source-grounded QA documentation. Standard library only; no app calls."""
from pathlib import Path
import csv
import html
import io
import json
import re
import textwrap
import zipfile
from collections import Counter
from xml.sax.saxutils import escape

QA = Path(__file__).resolve().parents[1]
REPO = QA.parents[1]
BASE = '191526bd2fda1970809529ab1d30b7cd54508512'
MODULE_ORDER = ['AUTH', 'SETTINGS', 'OVERVIEW', 'WORK', 'TASKS', 'PROJECTS',
                'CALENDAR', 'WORKLOAD', 'GOALS', 'CONNECT', 'MEDIA', 'CALLS',
                'FINANCE', 'REPORTS', 'PEOPLE', 'INBOX', 'INTELLIGENCE',
                'MOBILE', 'SECURITY', 'OPERATIONS', 'JOURNEYS']
ARRAY_FIELDS = ['actors', 'preconditions', 'test_data', 'steps', 'expected_results',
                'cleanup', 'source_refs', 'automation_refs', 'modes']


def load_catalog():
    modules = []
    for filename in ['core.json', 'connect-mobile-security.json',
                     'finance-reports-intelligence.json', 'operations-journeys.json']:
        modules.extend(json.loads((QA / 'catalog' / filename).read_text())['modules'])
    ids = [m['id'] for m in modules]
    assert len(ids) == len(set(ids)) and set(ids) == set(MODULE_ORDER)
    modules.sort(key=lambda m: MODULE_ORDER.index(m['id']))
    cases = []
    for m in modules:
        for ref in m['source_refs'] + m['automation_refs']:
            assert (REPO / ref).is_file(), ref
        for c in m['cases']:
            assert c['module'] == m['id'] and re.fullmatch(m['id'] + r'-\d{3}', c['id'])
            assert c['priority'] in ['P0', 'P1', 'P2']
            assert c['gate'] in ['LOCAL', 'LOCAL_CONFIG', 'DEVICE', 'PRODUCTION']
            assert c.get('status', 'NOT_RUN') == 'NOT_RUN'
            c['status'] = 'NOT_RUN'
            for field in ARRAY_FIELDS:
                assert isinstance(c[field], list), (c['id'], field)
                if field != 'automation_refs':
                    assert c[field], (c['id'], field)
                assert all(isinstance(s, str) and s.strip() for s in c[field]), (c['id'], field)
            assert len(c['steps']) == len(c['expected_results']) >= 1, c['id']
            for ref in c['source_refs'] + c['automation_refs']:
                assert (REPO / ref).is_file(), (c['id'], ref)
            cases.append(c)
        validate_diagram(m['diagram'])
    assert len({c['id'] for c in cases}) == len(cases)
    return modules, cases


def validate_diagram(d):
    ids = {n['id'] for n in d['nodes']}
    assert len(ids) == len(d['nodes'])
    for n in d['nodes']:
        assert re.fullmatch(r'[a-z][a-zA-Z0-9]*', n['id']), n['id']
        assert n['id'] not in ['end', 'graph', 'subgraph']
        assert n['kind'] in ['start', 'action', 'decision', 'result', 'error']
        assert '\n' not in n['label'] and '<' not in n['label']
    for e in d['edges']:
        assert e['from'] in ids and e['to'] in ids
        assert '\n' not in e.get('label', '')
    # Every node must participate; a dangling drawn box can hide a missing path.
    touched = {e[k] for e in d['edges'] for k in ['from', 'to']}
    assert touched == ids


def mermaid(d):
    q = lambda text: text.replace('"', "'")
    lines = ['flowchart TD']
    for n in d['nodes']:
        label = q(n['label'])
        shape = '{"' + label + '"}' if n['kind'] == 'decision' else '["' + label + '"]'
        lines.append('  ' + n['id'] + shape)
    for e in d['edges']:
        label = '|"' + q(e['label']) + '"|' if e.get('label') else ''
        lines.append('  ' + e['from'] + ' -->' + label + ' ' + e['to'])
    return '\n'.join(lines) + '\n'


def svg(d):
    """Readable vector flowchart; only arrows encode relationships, not row order."""
    positions = {}
    cursor = 86
    for n in d['nodes']:
        if n['kind'] == 'error':
            continue
        wrapped = textwrap.wrap(n['label'], 66) or ['']
        height = max(68, 30 + len(wrapped) * 19)
        if n['kind'] == 'decision':
            height = max(110, height * 1.8)
        positions[n['id']] = (350, cursor, 560, height, wrapped)
        cursor += height + 58
    error_cursor = 218
    for n in d['nodes']:
        if n['kind'] != 'error':
            continue
        wrapped = textwrap.wrap(n['label'], 32) or ['']
        height = max(82, 30 + len(wrapped) * 19)
        positions[n['id']] = (940, error_cursor, 340, height, wrapped)
        error_cursor += height + 72
    height = max(cursor + 12, error_cursor + 50)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="{height}" '
             f'viewBox="0 0 1160 {height}" role="img" aria-labelledby="flowTitle flowDesc">',
             '<title id="flowTitle">' + escape(d['title']) + '</title>',
             '<desc id="flowDesc">Arrows show the documented workflow. Denial and missing-prerequisite branches are red.</desc>',
             '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>',
             '<rect width="1160" height="100%" fill="#ffffff"/>',
             '<text x="38" y="32" font-family="Arial,sans-serif" font-size="21" font-weight="700" fill="#172033">' + escape(d['title']) + '</text>',
             '<text x="38" y="55" font-family="Arial,sans-serif" font-size="12" fill="#5e6b7d">Source-grounded flow | Current permission, version and original retry controls remain binding</text>']
    # Draw connections first, with side lanes for skips and back edges.
    for i, e in enumerate(d['edges']):
        x, y, w, h, _ = positions[e['from']]
        tx, ty, tw, th, _ = positions[e['to']]
        branch = tx != x
        if branch:
            sx = x + w / 2 if tx > x else x - w / 2
            ex = tx - tw / 2 if tx > x else tx + tw / 2
            sy, ey = y + h / 2, ty + th / 2
            lane = 700 + (i % 4) * 13
            path = f'M {sx} {sy} H {lane} V {ey} H {ex}'
            lx, ly = sx - 140, y - 10
        elif ty > y and ty - (y + h) < 100:
            path = f'M {x} {y+h} V {ty}'
            lx, ly = x + 10, (y + h + ty) / 2 - 5
        else:
            lane = 20 + (i % 4) * 10
            sy, ey = y + h / 2, ty + th / 2
            path = f'M {x-w/2} {sy} H {lane} V {ey} H {tx-tw/2}'
            lx, ly = 90, y - 10
        parts.append(f'<path d="{path}" fill="none" stroke="#64748b" stroke-width="1.8" marker-end="url(#arrow)"/>')
        if e.get('label'):
            label = e['label']
            parts.append(f'<text x="{lx}" y="{ly}" font-family="Arial,sans-serif" font-size="11" fill="#475569"><title>{escape(label)}</title>{escape(textwrap.shorten(label, width=42, placeholder="…"))}</text>')
    colors = {'start': ('#ecfdf5', '#0f766e'), 'action': ('#f8fafc', '#64748b'),
              'decision': ('#fff7ed', '#c2410c'), 'result': ('#eff6ff', '#2563eb'),
              'error': ('#fff1f2', '#be123c')}
    for n in d['nodes']:
        x, y, w, h, wrapped = positions[n['id']]
        fill, stroke = colors[n['kind']]
        parts.append('<g><title>' + escape(n['label']) + '</title>')
        if n['kind'] == 'decision':
            points = f'{x},{y} {x+w/2},{y+h/2} {x},{y+h} {x-w/2},{y+h/2}'
            parts.append(f'<polygon points="{points}" fill="{fill}" stroke="{stroke}" stroke-width="1.8"/>')
        else:
            parts.append(f'<rect x="{x-w/2}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="1.8"/>')
        first = y + h / 2 - (len(wrapped) - 1) * 9.5 + 5
        for line, text in enumerate(wrapped):
            parts.append(f'<text x="{x}" y="{first+line*19}" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" fill="#172033">{escape(text)}</text>')
        parts.append('</g>')
    parts.append('</svg>')
    return '\n'.join(parts) + '\n'


def diagram_files(d, filename):
    validate_diagram(d)
    (QA / 'diagrams' / (filename + '.mmd')).write_text(mermaid(d))
    (QA / 'diagrams' / (filename + '.svg')).write_text(svg(d))


def source_link(ref, depth=3):
    return '[' + ref + '](' + '../' * depth + ref + ')'


def numbered(values):
    return '\n'.join(f'{i}. {s}' for i, s in enumerate(values, 1))


def markdown_module(m):
    text = f'# {m["title"]}\n\n{m["purpose"]}\n\n'
    text += '**Entry:** ' + '; '.join(m['entry_points']) + '\n\n'
    text += '**Actors:** ' + '; '.join(m['actors']) + '\n\n'
    text += '## Main flow\n\n' + numbered(m['workflow']) + '\n\n'
    text += '![Workflow](../diagrams/' + m['id'] + '.svg)\n\n'
    text += '[Editable Mermaid](../diagrams/' + m['id'] + '.mmd)\n\n'
    text += '```mermaid\n' + mermaid(m['diagram']) + '```\n\n'
    text += '## Controls and limits\n\n' + '\n'.join('- ' + s for s in m['limitations']) + '\n\n'
    text += '## Proposed manual scenarios\n\nAll start **NOT_RUN**. Missing prerequisite = BLOCKED.\n\n'
    for c in m['cases']:
        text += f'### {c["id"]}: {c["title"]}\n\n'
        text += f'**{c["priority"]} · {c["gate"]} · ' + ', '.join(c['modes']) + '**\n\n'
        for title, field in [('Actors', 'actors'), ('Preconditions', 'preconditions'), ('Test data', 'test_data')]:
            text += '**' + title + ':**\n\n' + '\n'.join('- ' + s for s in c[field]) + '\n\n'
        text += '| Step | Action | Expected result |\n| --- | --- | --- |\n'
        for i, (a, b) in enumerate(zip(c['steps'], c['expected_results']), 1):
            text += f'| {i} | {a.replace("|", "&#124;")} | {b.replace("|", "&#124;")} |\n'
        text += '\n**Cleanup:** ' + ' '.join(c['cleanup']) + '\n\n'
        text += '[Scenario flow](../diagrams/' + c['id'] + '.svg) · [Editable source](../diagrams/' + c['id'] + '.mmd)\n\n'
        text += '**Source:** ' + ', '.join(source_link(r) for r in c['source_refs']) + '\n\n'
        text += '**Supporting automation:** ' + (', '.join(source_link(r) for r in c['automation_refs']) or 'Manual/device/provider gate; no owning automated reference.') + '\n\n'
    (QA / 'modules' / (m['id'] + '.md')).write_text(text.rstrip() + '\n')


def csv_files(modules, cases):
    fields = ['Case ID', 'Module', 'Title', 'Priority', 'Gate', 'Surfaces', 'Actors',
              'Preconditions', 'Test data', 'Steps', 'Expected results', 'Cleanup',
              'Source references', 'Automation references', 'Status', 'Run ID',
              'Tester', 'Date/time/zone', 'Environment/build/device', 'Actual observations',
              'Evidence link', 'Defect ID', 'Blocked/skip reason']
    rows = []
    for c in cases:
        rows.append([c['id'], c['module'], c['title'], c['priority'], c['gate'],
                     '; '.join(c['modes']), '; '.join(c['actors']), '\n'.join(c['preconditions']),
                     '\n'.join(c['test_data']), numbered(c['steps']), numbered(c['expected_results']),
                     '\n'.join(c['cleanup']), '; '.join(c['source_refs']), '; '.join(c['automation_refs']),
                     'NOT_RUN'] + [''] * 8)
    # All string cells: neutralize formula-leading fields in export artifacts.
    def safe(s):
        return "'" + s if s[:1] in ['=', '+', '-', '@'] else s
    with (QA / 'test-scenarios.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(fields)
        writer.writerows([[safe(s) for s in row] for row in rows])
    execution = ['Run ID', 'Case ID', 'Module', 'Priority', 'Gate', 'Status', 'Tester',
                 'Date/time/zone', 'Environment/build/device', 'Actor/company aliases',
                 'Actual observations', 'Evidence link', 'Defect ID', 'Blocked/skip reason']
    execution_rows = [['', c['id'], c['module'], c['priority'], c['gate'], 'NOT_RUN'] + [''] * 8 for c in cases]
    with (QA / 'execution-log.csv').open('w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f, lineterminator="\n"); w.writerow(execution); w.writerows(execution_rows)
    with (QA / 'defect-log.csv').open('w', newline='', encoding='utf-8-sig') as f:
        csv.writer(f, lineterminator="\n").writerow(['Defect ID', 'Case ID', 'Run ID', 'Title', 'Severity',
            'Classification', 'Source/build', 'Environment/device', 'Actor/company aliases',
            'Steps', 'Expected', 'Actual', 'Canonical commit known?', 'Sanitized evidence',
            'Owner', 'Status', 'Fix revision', 'Retest run'])
    return fields, rows, execution, execution_rows


def cell_name(col):
    result = ''
    while col:
        col, remainder = divmod(col - 1, 26)
        result = chr(65 + remainder) + result
    return result


def worksheet(headers, rows, widths=None, status_column=None):
    total = len(rows) + 1
    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      f'<dimension ref="A1:{cell_name(len(headers))}{total}"/>',
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
      '<sheetFormatPr defaultRowHeight="22"/><cols>']
    for i in range(1, len(headers) + 1):
        width = widths[i - 1] if widths and i <= len(widths) else 28
        parts.append(f'<col min="{i}" max="{i}" width="{width}" customWidth="1"/>')
    parts.append('</cols><sheetData>')
    for index, row in enumerate([headers] + rows, 1):
        parts.append(f'<row r="{index}" ht="{30 if index==1 else 58}" customHeight="1">')
        for col, value in enumerate(row, 1):
            name = cell_name(col) + str(index)
            style = 1 if index == 1 else (3 if status_column == col else 2)
            if isinstance(value, dict):
                parts.append(f'<c r="{name}" s="{style}"><f>{escape(value["formula"])}</f><v>{value["cached"]}</v></c>')
            elif isinstance(value, int):
                parts.append(f'<c r="{name}" s="{style}"><v>{value}</v></c>')
            else:
                parts.append(f'<c r="{name}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>')
        parts.append('</row>')
    parts.append('</sheetData>')
    parts.append(f'<autoFilter ref="A1:{cell_name(len(headers))}{total}"/>')
    if status_column:
        letter = cell_name(status_column)
        parts.append(f'<dataValidations count="1"><dataValidation type="list" allowBlank="0" showErrorMessage="1" errorTitle="Choose a run status" error="Use the listed status and record blockers/defects." sqref="{letter}2:{letter}{total}"><formula1>"NOT_RUN,PASS,FAIL,BLOCKED,SKIPPED"</formula1></dataValidation></dataValidations>')
    parts.append('<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>')
    return ''.join(parts)


def xlsx(modules, cases, headers, rows, execution, execution_rows):
    readme = [['Purpose', 'Proposed manual E2E scenarios; every fresh run starts NOT_RUN.'],
      ['Baseline source', BASE], ['Run instructions', 'Copy workbook per run. Filter Scenarios. Record results in Execution log.'],
      ['Gate LOCAL', 'Isolated fictional server; deterministic owned harness where stated.'],
      ['Gate LOCAL_CONFIG', 'Configured keys/scanner/storage/models/calls as named; absence BLOCKED.'],
      ['Gate DEVICE', 'Named exact build and physical/device qualification; browser pixels are not native dp.'],
      ['Gate PRODUCTION', 'Named staged deployment/provider/capacity/restore acceptance.'],
      ['Privacy', 'No real tokens/passwords/private source/model text in evidence.'],
      ['Pass definition', 'All numbered expected results observed for this run. Automation references are not manual passes.'],
      ['Independence', 'Separate initiating/reviewer/operator profiles; creator cannot approve/pay own expense.'],
      ['Record limitations', 'Do not mix numberedPG with AutoMigrate; call recording disabled; explicit source/consent; original retry remains frozen.']]
    last = len(cases) + 1
    summary = [['Total', {'formula': f"COUNTA('Execution log'!B2:B{last})", 'cached': len(cases)}]]
    for status in ['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED', 'SKIPPED']:
        summary.append([status, {'formula': f'COUNTIF(\'Execution log\'!F2:F{last},"{status}")', 'cached': len(cases) if status == 'NOT_RUN' else 0}])
    coverage = [[m['id'], m['title'], len(m['cases']), '; '.join(sorted({c['gate'] for c in m['cases']})), 'NOT_RUN'] for m in modules]
    devices = [['Desktop', 'Chrome / Edge / Firefox / Safari', 'Normal API mode; record exact version', 'NOT_RUN'],
               ['Mobile web', '320 / 375 / 430 CSS px', 'Keyboard + zoom + overflow + dialog return', 'NOT_RUN'],
               ['Android', 'Physical signed release and separately qualified emulator', '44dp owning bounds / fonts / IME / Back / camera / push / call', 'NOT_RUN'],
               ['iOS', 'Physical signed iOS build', 'Actual build / keyboard / accessibility / background / push / call', 'NOT_RUN'],
               ['Network', 'Normal / slow / offline / reconnect / mobile handoff', 'Canonical identity and current authority retained', 'NOT_RUN']]
    sheets = [('Readme', ['Field', 'Instruction'], readme, [26, 115], None),
              ('Scenarios', headers, rows, [18, 18, 50, 12, 19, 24, 42, 58, 48, 70, 70, 50, 52, 52], 15),
              ('Execution log', execution, execution_rows, [18, 18, 18, 12, 19, 16, 24, 27, 45, 40, 70, 45, 20, 55], 6),
              ('Summary', ['Metric', 'Count'], summary, [32, 24], None),
              ('Module coverage', ['Module', 'Purpose', 'Cases', 'Gates', 'Status'], coverage, [20, 75, 12, 55, 16], 5),
              ('Device matrix', ['Surface', 'Matrix', 'Checks', 'Status'], devices, [24, 65, 95, 16], 4),
              ('Defect log', ['Defect ID', 'Case ID', 'Run ID', 'Title', 'Severity', 'Classification', 'Expected', 'Actual', 'Evidence', 'Owner', 'Retest run'], [[''] * 11 for _ in range(20)], [20, 20, 20, 60, 18, 25, 65, 65, 50, 25, 25], None)]
    count = len(sheets)
    content = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    content += ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, count + 1)) + '</Types>'
    styles = '''<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF253247"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF7DA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''
    with zipfile.ZipFile(QA / 'test-scenarios.xlsx', 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', content)
        z.writestr('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        workbook = '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        workbook += ''.join(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>' for i, (name, *_rest) in enumerate(sheets, 1))
        z.writestr('xl/workbook.xml', workbook + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>')
        rels = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        rels += ''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, count + 1))
        z.writestr('xl/_rels/workbook.xml.rels', rels + f'<Relationship Id="rId{count+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        z.writestr('xl/styles.xml', styles)
        for i, (_, h, r, widths, status) in enumerate(sheets, 1):
            z.writestr(f'xl/worksheets/sheet{i}.xml', worksheet(h, r, widths, status))


CSS = '''*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#192236;font:15px/1.6 system-ui,sans-serif}header{background:#192236;color:white;padding:36px max(24px,calc((100vw - 1200px)/2))}header p{max-width:900px;color:#c9d2e0}h1{margin:0;font-size:30px}h2{margin-top:0}h3{margin-bottom:6px}main{max-width:1250px;margin:auto;padding:24px}.bar{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;position:sticky;top:0;background:#f5f6f8;padding:12px 0;z-index:2}input,select,button{max-width:100%;font:inherit;padding:10px;border:1px solid #b8c3d4;border-radius:6px}input{flex:1;min-width:220px}a{color:#1959a2}header a{color:#a6cdfd}.stats{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}.stats span,.tag{padding:5px 10px;border-radius:5px;background:#eaf0f7;color:#334767}.stats span{background:#314057;color:white}article,section.card{overflow-wrap:anywhere;background:white;border:1px solid #dce2ec;border-radius:10px;padding:22px;margin-bottom:18px}summary{cursor:pointer;font-weight:650}.case{border-top:1px solid #e4e9f0;padding-top:14px;margin-top:14px}.case details{padding:12px 0}.flow{width:100%;max-height:720px;object-fit:contain;background:white;border:1px solid #e4e9f0;border-radius:8px}.note{background:#fff6e7;border-left:4px solid #d97912;padding:14px;margin:18px 0}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #dce2ec;padding:10px;vertical-align:top;overflow-wrap:anywhere}th{background:#edf2f8}td:first-child,th:first-child{width:55px}.muted{color:#65738a}.links{display:flex;gap:15px;flex-wrap:wrap}.empty{padding:40px;text-align:center}.print-module{break-before:page;background:white;padding:20px}.print-module img{display:block;width:100%;height:650px;object-fit:contain}@media(max-width:600px){header{padding:24px}main{padding:12px}h1{font-size:25px}.bar{position:static}article{padding:14px}table{font-size:13px}td,th{padding:6px}}@media print{body{background:white}.bar,.no-print{display:none}header{padding:20px;color:#192236;background:white}article{break-inside:avoid}a{color:#192236}main{padding:0;max-width:none}.print-module{page-break-before:always;padding:8px;font-size:12px;line-height:1.45}.print-module h2{font-size:18px}.print-module img{height:540px}}@page{size:A4;margin:12mm}'''


def html_files(modules, cases):
    stats = f'{len(cases)} scenarios · {len(modules)} module/journey guides · {len(cases)+len(modules)} editable flows'
    template = '''<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Schach Workspace · Team QA</title><style>CSS_HERE</style></head><body><header><h1>Schach Workspace · End-to-end QA</h1><p>Source-grounded module guides, editable workflow diagrams and repeatable team scenarios. Every manual case starts NOT_RUN. Run mutations only in an isolated fictional environment.</p><div class="links"><a href="test-scenarios.xlsx">Excel workbook</a><a href="test-scenarios.csv">All scenarios CSV</a><a href="execution-log.csv">Execution log</a><a href="WORKFLOW_GUIDE.pdf">Workflow PDF</a><a href="TEAM_RUNBOOK.md">Team runbook</a></div><div class="stats"><span>STATS_HERE</span><span>Baseline 191526b · 12 October 2026</span></div></header><main><div class="note">Local implementation evidence is separate from your team's results. Missing scanner/model/keys/device/TLS/provider prerequisites = BLOCKED. Company rank never grants private conversation access. Suggestions never approve tasks or move money.</div><div class="bar"><input id="query" aria-label="Search scenarios" placeholder="Search case ID, workflow, role or expected result"><select id="module" aria-label="Filter module"><option value="">All modules</option></select><select id="gate" aria-label="Filter environment gate"><option value="">All gates</option><option>LOCAL</option><option>LOCAL_CONFIG</option><option>DEVICE</option><option>PRODUCTION</option></select><select id="priority" aria-label="Filter priority"><option value="">All priorities</option><option>P0</option><option>P1</option><option>P2</option></select><button id="clear">Clear filters</button></div><p id="count" class="muted" aria-live="polite"></p><div id="content"></div></main><script src="catalog/catalog.js"></script><script>
const catalog=window.schachQA;const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ul=v=>'<ul>'+v.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>';
const refs=v=>v.map(r=>'<a href="'+(r.startsWith('docs/qa/')?r.slice(8):'https://github.com/Schach-workplace/Schach_Workspace/blob/'+catalog.sourceBaseline+'/'+r)+'">'+esc(r)+'</a>').join(' · ')||'Manual/device/provider gate; no owning automated reference.';
for(const m of catalog.modules){const o=document.createElement('option');o.value=m.id;o.textContent=m.id+' · '+m.title;document.querySelector('#module').append(o)}
function render(){const query=document.querySelector('#query').value.trim().toLowerCase(),mid=document.querySelector('#module').value,gate=document.querySelector('#gate').value,priority=document.querySelector('#priority').value;let total=0;
const sections=[];for(const m of catalog.modules){if(mid&&mid!==m.id)continue;const found=m.cases.filter(c=>(!gate||c.gate===gate)&&(!priority||c.priority===priority)&&(!query||JSON.stringify(c).toLowerCase().includes(query)));if(!found.length)continue;total+=found.length;
const items=found.map(c=>'<div class="case" id="'+c.id+'"><details><summary>'+esc(c.id)+' · '+esc(c.title)+'</summary><p><span class="tag">'+c.priority+'</span> <span class="tag">'+c.gate+'</span> <span class="tag">NOT_RUN</span> '+esc(c.modes.join(' / '))+'</p><h3>Actors</h3>'+ul(c.actors)+'<h3>Preconditions</h3>'+ul(c.preconditions)+'<h3>Test data</h3>'+ul(c.test_data)+'<table><thead><tr><th>#</th><th>Action</th><th>Expected result</th></tr></thead><tbody>'+c.steps.map((s,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(s)+'</td><td>'+esc(c.expected_results[i])+'</td></tr>').join('')+'</tbody></table><p><b>Cleanup:</b> '+esc(c.cleanup.join(' '))+'</p><details><summary>Scenario diagram</summary><img class="flow" loading="lazy" src="diagrams/'+c.id+'.svg" alt="'+esc(c.title)+'"><p><a href="diagrams/'+c.id+'.svg">Open SVG</a> · <a href="diagrams/'+c.id+'.mmd">Editable Mermaid</a></p></details><p><b>Source:</b> '+refs(c.source_refs)+'</p><p><b>Supporting automation:</b> '+refs(c.automation_refs)+'</p><p class="muted">Record your actual result in the execution workbook. A code reference is not a manual pass.</p></details></div>').join('');
sections.push('<article data-module="'+m.id+'"><h2>'+esc(m.id)+' · '+esc(m.title)+'</h2><p>'+esc(m.purpose)+'</p><p><b>Entry:</b> '+esc(m.entry_points.join('; '))+'</p><details><summary>Module workflow and limits</summary><ol>'+m.workflow.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ol><img class="flow" loading="lazy" src="diagrams/'+m.id+'.svg" alt="'+esc(m.title)+'"><p><a href="diagrams/'+m.id+'.svg">Open diagram</a> · <a href="diagrams/'+m.id+'.mmd">Editable Mermaid</a> · <a href="modules/'+m.id+'.md">Module guide</a></p>'+ul(m.limitations)+'</details>'+items+'</article>')}
document.querySelector('#count').textContent=total+' of '+catalog.caseCount+' proposed scenarios shown · '+sections.length+' guides';document.querySelector('#content').innerHTML=sections.join('')||'<div class="empty">No matching scenarios. Clear a filter to see more.</div>'}
for(const id of ['query','module','gate','priority'])document.querySelector('#'+id).addEventListener(id==='query'?'input':'change',render);document.querySelector('#clear').onclick=()=>{for(const id of ['query','module','gate','priority'])document.querySelector('#'+id).value='';render()};render();
</script></body></html>'''
    (QA / 'index.html').write_text(template.replace('CSS_HERE', CSS).replace('STATS_HERE', stats))
    data = {'sourceBaseline': BASE, 'caseCount': len(cases), 'modules': modules,
            'qualification': 'Proposed manual cases, all NOT_RUN; source references are not executed team acceptance.'}
    (QA / 'catalog' / 'catalog.json').write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    (QA / 'catalog' / 'catalog.js').write_text('window.schachQA=' + json.dumps(data, ensure_ascii=False).replace('<', '\\u003c') + ';\n')
    pages = []
    for m in modules:
        pages.append('<section class="print-module"><h2>' + html.escape(m['id'] + ' · ' + m['title']) + '</h2><p>' + html.escape(m['purpose']) + '</p><p><b>Entry:</b> ' + html.escape('; '.join(m['entry_points'])) + '</p><img src="diagrams/' + m['id'] + '.svg" alt="Workflow"><p>' + html.escape('; '.join(m['limitations'])) + '</p></section>')
    for c in [c for c in cases if c['module'] == 'JOURNEYS']:
        pages.append('<section class="print-module"><h2>' + html.escape(c['id'] + ' · ' + c['title']) + '</h2><p>' + html.escape(c['gate'] + ' · ' + '; '.join(c['actors'])) + '</p><img src="diagrams/' + c['id'] + '.svg" alt="Journey"><p>These are proposed steps. Each numbered expected result is in the workbook/module guide; missing prerequisites remain BLOCKED.</p></section>')
    (QA / 'WORKFLOW_GUIDE.html').write_text('<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Schach Workspace workflow guide</title><style>' + CSS + '</style></head><body><header><h1>Schach Workspace workflow guide</h1><p>12 October 2026 · Source baseline191526b · Every module and cross-module journey. Only arrows define interactions. New manual cases are NOT_RUN.</p></header><main>' + ''.join(pages) + '</main></body></html>')


def main():
    modules, cases = load_catalog()
    for m in modules:
        diagram_files(m['diagram'], m['id'])
        markdown_module(m)
    for c in cases:
        nodes = [dict(id='step' + str(i), label=s, kind='start' if i == 1 else 'action')
                 for i, s in enumerate(c['steps'], 1)]
        nodes.append(dict(id='record', label='Compare every expected result; record PASS, FAIL or BLOCKED for this run', kind='result'))
        edges = [{'from': nodes[i]['id'], 'to': nodes[i + 1]['id'], 'label': ''} for i in range(len(nodes) - 1)]
        diagram_files(dict(id='case' + c['id'].replace('-', ''), title=c['id'] + ' · ' + c['title'], module=c['module'], nodes=nodes, edges=edges), c['id'])
    headers, rows, execution, execution_rows = csv_files(modules, cases)
    xlsx(modules, cases, headers, rows, execution, execution_rows)
    html_files(modules, cases)
    index = '# Module and workflow index\n\nSource baseline `' + BASE + '`. All proposed scenarios start NOT_RUN.\n\n'
    index += '| Module | Entry/purpose | Cases | Guide | Diagram |\n| --- | --- | ---: | --- | --- |\n'
    for m in modules:
        index += f'| {m["id"]} | {m["title"]} | {len(m["cases"])} | [Guide](modules/{m["id"]}.md) | [SVG](diagrams/{m["id"]}.svg) / [Mermaid](diagrams/{m["id"]}.mmd) |\n'
    index += '\nEvery case also has its own SVG/Mermaid flow, linked from the module guide and offline scenario view.\n'
    (QA / 'MODULE_INDEX.md').write_text(index)
    counts = {'modules': len(modules), 'cases': len(cases), 'diagrams': len(cases) + len(modules),
              'byGate': dict(Counter(c['gate'] for c in cases)),
              'byPriority': dict(Counter(c['priority'] for c in cases)),
              'manualStatus': {'NOT_RUN': len(cases)}}
    print(json.dumps(counts))


if __name__ == '__main__':
    main()
