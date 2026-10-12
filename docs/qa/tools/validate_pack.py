#!/usr/bin/env python3
"""Validate documentation artifacts only. No application or provider requests."""
from pathlib import Path
from collections import Counter
import csv
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from urllib.parse import unquote, urlparse
from html.parser import HTMLParser

sys.dont_write_bytecode = True
from build_pack import QA, REPO, BASE, load_catalog, mermaid, svg

modules, cases = load_catalog()
assert len(modules) == 21 and len(cases) == 224
expected = {m['id'] for m in modules} | {c['id'] for c in cases}
assert {p.stem for p in (QA/'diagrams').glob('*.svg')} == expected
assert {p.stem for p in (QA/'diagrams').glob('*.mmd')} == expected
for p in (QA/'diagrams').glob('*.svg'):
    root = ET.fromstring(p.read_text())
    assert root.tag.endswith('svg') and root.find('{http://www.w3.org/2000/svg}title') is not None
for m in modules:
    assert (QA/'diagrams'/f'{m["id"]}.mmd').read_text() == mermaid(m['diagram'])
    assert (QA/'diagrams'/f'{m["id"]}.svg').read_text() == svg(m['diagram'])
    guide = (QA/'modules'/f'{m["id"]}.md').read_text()
    for c in m['cases']:
        assert c['id'] in guide
for file, id_column, status_column in [('test-scenarios.csv','Case ID','Status'),('execution-log.csv','Case ID','Status')]:
    with (QA/file).open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == len(cases)
    assert {r[id_column] for r in rows} == {c['id'] for c in cases}
    assert {r[status_column] for r in rows} == {'NOT_RUN'}
    if file == 'test-scenarios.csv':
        for row, c in zip(rows, cases):
            assert row['Steps'] == '\n'.join(f'{i}. {s}' for i,s in enumerate(c['steps'],1))
            assert row['Expected results'] == '\n'.join(f'{i}. {s}' for i,s in enumerate(c['expected_results'],1))
ns = {'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(QA/'test-scenarios.xlsx') as z:
    assert z.testzip() is None
    for name in z.namelist():
        if name.endswith('.xml') or name.endswith('.rels'):
            ET.fromstring(z.read(name))
    workbook = ET.fromstring(z.read('xl/workbook.xml'))
    names = [s.attrib['name'] for s in workbook.findall('s:sheets/s:sheet',ns)]
    assert names == ['Readme','Scenarios','Execution log','Summary','Module coverage','Device matrix','Defect log']
    for number, column in [(2,'O'),(3,'F')]:
        sheet = ET.fromstring(z.read(f'xl/worksheets/sheet{number}.xml'))
        rows = sheet.findall('s:sheetData/s:row',ns)
        assert len(rows) == len(cases)+1
        for index, row in enumerate(rows[1:],2):
            status = row.find(f's:c[@r="{column}{index}"]/s:is/s:t',ns)
            assert status is not None and status.text == 'NOT_RUN'
        validation = sheet.find('s:dataValidations/s:dataValidation',ns)
        assert validation.attrib['sqref'] == f'{column}2:{column}225'
        assert sheet.find('s:sheetViews/s:sheetView/s:pane',ns).attrib['state'] == 'frozen'
    summary = ET.fromstring(z.read('xl/worksheets/sheet4.xml'))
    assert len(summary.findall('.//s:f',ns)) == 6
broken = []
for p in QA.rglob('*.md'):
    for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
        if urlparse(target).scheme or target.startswith('#'):
            continue
        local = unquote(target.split('#')[0].strip('<>'))
        if not (p.parent/local).exists():
            broken.append([str(p.relative_to(QA)),target])
class LocalLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []
    def handle_starttag(self, tag, attrs):
        self.targets.extend(value for key,value in attrs if key in ['src','href'] and value)
for p in [QA/'index.html',QA/'WORKFLOW_GUIDE.html']:
    parser = LocalLinks()
    parser.feed(p.read_text())
    for target in parser.targets:
        if urlparse(target).scheme or target.startswith('#'):
            continue
        assert (p.parent/unquote(target.split('#')[0])).exists(), (p.name,target)
assert not broken, broken
for p in (QA/'tools').glob('*.py'):
    compile(p.read_text(),str(p),'exec')
subprocess.run(['bash','-n',str(QA/'tools/start-isolated-qa.sh')],check=True)
for env in [{'SCHACH_QA_PORT':'8080'},{'SCHACH_QA_PORT':'invalid'}]:
    import os
    result = subprocess.run(['bash',str(QA/'tools/start-isolated-qa.sh')],env={**os.environ,**env},capture_output=True)
    assert result.returncode == 2
left = {p.name:p.read_bytes() for p in (REPO/'backend/migrations').glob('*.sql')}
right = {p.name:p.read_bytes() for p in (REPO/'encore/api/migrations').glob('*.sql')}
assert left == right and len(left) == 116
pdf = (QA/'WORKFLOW_GUIDE.pdf').read_bytes()
assert pdf.startswith(b'%PDF-') and len(pdf)>10000
report = {'status':'PASS','scope':'Documentation structure and artifacts only; not application/team acceptance',
          'applicationSourceBaseline':BASE,'modules':len(modules),'scenarios':len(cases),'diagrams':len(expected),
          'manualStatuses':dict(Counter(c['status'] for c in cases)),
          'byGate':dict(Counter(c['gate'] for c in cases)),
          'checks':['Unique IDs and paired steps/results','Source and automated-reference files exist',
                    '245 SVG XML files and matching editable Mermaid files','Module guides cover all cases',
                    'CSV rows/results and all NOT_RUN statuses','Seven-sheet OOXML, formulas, dropdowns and frozen headers',
                    'No broken local Markdown/HTML links','Python and Bash syntax',
                    'Launcher rejects retained port and invalid port before work','116 byte-identical SQL files per tree','PDF signature'],
          'qualifications':['Full launcher/app/manual cases not executed by this validator',
                            'Mermaid grammar generated/structurally checked; external Mermaid parser not run',
                            'Physical/provider/production gates remain unobserved']}
(QA/'validation-structure.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
