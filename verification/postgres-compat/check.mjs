import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {financeChecks} from './finance-checks.mjs';

// Compatibility probe only. This does not run the Go service, pgx/GORM, or
// PostgreSQL's native multi-process server. All data lives in disposable memory.
const root = new URL('../../', import.meta.url);
const migrationFiles = (await readdir(new URL('backend/migrations/', root)))
  .filter(name => /^\d+_.+\.up\.sql$/.test(name))
  .sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));
const migrations = await Promise.all(migrationFiles.map(async file => {
  const downFile = file.replace(/\.up\.sql$/, '.down.sql');
  const [up, down, encoreUp, encoreDown] = await Promise.all([
    readFile(new URL(`backend/migrations/${file}`, root), 'utf8'),
    readFile(new URL(`backend/migrations/${downFile}`, root), 'utf8'),
    readFile(new URL(`encore/api/migrations/${file}`, root), 'utf8'),
    readFile(new URL(`encore/api/migrations/${downFile}`, root), 'utf8'),
  ]);
  return {version: Number(file.split('_')[0]), file, downFile, up, down, encoreUp, encoreDown};
}));
const up = migrations[0]?.up ?? '';
const down = migrations[0]?.down ?? '';
const pkg = JSON.parse(await readFile(new URL('node_modules/@electric-sql/pglite/package.json', import.meta.url), 'utf8'));
const result = {
  kind: 'PGlite migration compatibility check',
  executedAt: new Date().toISOString(),
  nodeVersion: process.version,
  pgliteVersion: pkg.version,
  migrationSha256: {
    up: createHash('sha256').update(up).digest('hex'),
    down: createHash('sha256').update(down).digest('hex'),
  },
  orderedMigrations: migrations.map(({version, file, downFile, up, down}) => ({
    version, upFile: file, downFile,
    upSha256: createHash('sha256').update(up).digest('hex'),
    downSha256: createHash('sha256').update(down).digest('hex'),
  })),
  checks: [],
  limitations: [
    'No Go, GORM or pgx integration was executed by this probe.',
    'In-memory WASM execution does not verify native PostgreSQL deployment, TLS, credentials, pool behavior, or disk persistence.',
    'No independent PostgreSQL connections, concurrent row locks, deadlocks, failover, scheduler overlap, or throughput were tested.',
    'The down migration was executed only against this disposable fixture database; no production backup/restore was exercised.',
    'Optional text references, JSON graph edges, role visibility, active-membership checks, financial workflow, duplicate normalization, and serialized budget approval remain application-enforced; SQL acceptance does not certify them.',
  ],
  sources: ['https://pglite.dev/docs/about', 'https://pglite.dev/docs/api'],
};
const pass = (name, detail) => result.checks.push({name, passed: true, ...(detail === undefined ? {} : {detail})});
const pg = await PGlite.create();
const originalTables = ['activities', 'attachments', 'automation_records', 'comments', 'companies', 'departments', 'goals', 'memberships', 'notifications', 'projects', 'sessions', 'tasks', 'time_entries', 'users'];
const quote = identifier => '"' + identifier.replaceAll('"', '""') + '"';
async function legacySnapshot() {
  const snapshot = [];
  for (const table of originalTables) {
    const columns = (await pg.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table])).rows.map(row => row.column_name);
    const sql = `SELECT to_jsonb(record) AS row FROM (SELECT ${columns.map(quote).join(',')} FROM ${quote(table)}) AS record ORDER BY to_jsonb(record)::text`;
    snapshot.push({table, sql, rows: (await pg.query(sql)).rows.map(row => row.row)});
  }
  return snapshot;
}
async function assertLegacyPreserved(snapshot, allowAdditionalRows = false) {
  for (const {table, sql, rows} of snapshot) {
    const current = (await pg.query(sql)).rows.map(row => row.row);
    if (allowAdditionalRows) {
      const serialized = new Set(current.map(row => JSON.stringify(row)));
      for (const row of rows) assert.ok(serialized.has(JSON.stringify(row)), `${table}: original row changed or disappeared`);
    } else assert.deepEqual(current, rows, `${table}: original values changed during migration`);
  }
}
async function rejects(name, sql, params = [], code = '23514') {
  let error;
  try { await pg.query(sql, params); } catch (e) { error = e; }
  assert.ok(error, `${name}: statement unexpectedly succeeded`);
  assert.equal(error.code, code, `${name}: wrong SQLSTATE: ${error.message}`);
  pass(name, {sqlstate: error.code, constraint: error.constraint ?? null});
}
const timestamp = '2026-10-10T12:00:00Z';
const baseTask = {
  id: 'task-a', code: 'SW-1', company_id: 'company-a', title: 'Compatibility fixture',
  owner_id: 'user-a', created_by: 'user-a', status: 'todo', priority: 'medium',
  recurrence: 'none', due_date: '2026-10-11', original_due_date: '2026-10-11',
  created_at: timestamp, updated_at: timestamp,
};
async function insertTask(connection, overrides = {}) {
  const row = {...baseTask, ...overrides};
  const columns = Object.keys(row);
  return connection.query(`INSERT INTO tasks (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
}
try {
  result.engine = (await pg.query('SELECT version() AS version, current_setting(\'server_version\') AS server_version')).rows[0];
  assert.deepEqual(migrations.map(migration => migration.version), Array.from({length:migrations.length},(_,i)=>i+1), 'Numbered migrations must start at 1 and remain contiguous');
  assert.ok(migrations.length >= 2, 'Original versions 1 and 2 are required');
  for (const migration of migrations) {
    assert.equal(migration.up, migration.encoreUp, migration.file);
    assert.equal(migration.down, migration.encoreDown, migration.downFile);
  }
  pass('Both ordered standalone and Encore migration pairs are byte-identical');
  await pg.transaction(tx => tx.exec(up));
  pass('Entire up migration accepted in one transaction');
  const tables = (await pg.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map(x => x.tablename);
  assert.deepEqual(tables, originalTables);
  pass('All 14 expected tables created', tables);
  result.catalog = (await pg.query("SELECT contype AS type, count(*)::int AS count FROM pg_constraint WHERE connamespace = 'public'::regnamespace GROUP BY contype ORDER BY contype")).rows;
  await pg.exec(`
    INSERT INTO companies (id,name,slug,created_at) VALUES ('company-a','Company A','company-a','${timestamp}'),('company-b','Company B','company-b','${timestamp}');
    INSERT INTO users (id,name,email,password_hash) VALUES ('user-a','User A','a@example.invalid','not-a-login-hash'),('user-b','User B','b@example.invalid','not-a-login-hash');
    INSERT INTO memberships (id,company_id,user_id,role) VALUES ('membership-a','company-a','user-a','founder'),('membership-b','company-b','user-b','founder');
    INSERT INTO projects (id,company_id,name,owner_id,status) VALUES ('project-a','company-a','Project A','user-a','active');
    INSERT INTO goals (id,company_id,name,owner_id,unit,baseline,target,current) VALUES ('goal-a','company-a','Goal A','user-a','items',0,10,2);
  `);
  await insertTask(pg);
  await insertTask(pg, {id: 'task-b', company_id: 'company-b', owner_id: 'user-b', created_by: 'user-b'});
  await insertTask(pg, {id: 'task-a2', code: 'SW-2'});
  pass('Valid cross-table fixtures and same task code in different companies accepted');
  await pg.exec(`
    INSERT INTO comments (id,company_id,task_id,user_id,body,created_at) VALUES ('comment-a','company-a','task-a','user-a','Evidence comment','${timestamp}');
    INSERT INTO time_entries (id,company_id,task_id,user_id,hours,date,created_at) VALUES ('time-a','company-a','task-a','user-a',2.5,'2026-10-10','${timestamp}');
    INSERT INTO attachments (id,company_id,task_id,file_name,mime_type,size,uploaded_by,created_at,data) VALUES ('attachment-a','company-a','task-a','fixture.txt','text/plain',6,'user-a','${timestamp}',decode('736368616368','hex'));
    INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (repeat('a',64),'user-a','2026-10-10T12:00:00Z','2026-10-13T12:00:00Z');
    INSERT INTO automation_records (key,company_id,created_at) VALUES ('reminder:task-a:2026-10-10','company-a','${timestamp}');
    INSERT INTO activities (id,company_id,task_id,user_id,action,detail,created_at) VALUES ('activity-a','company-a','task-a','user-a','fixture_created','Version-one history','${timestamp}');
    INSERT INTO notifications (id,company_id,user_id,task_id,title,kind,created_at) VALUES ('notification-a','company-a','user-a','task-a','Version-one notice','assignment','${timestamp}');
  `);
  pass('Valid comments, time, evidence, sessions and automation record accepted');
  await rejects('Cross-company task owner rejected', "UPDATE tasks SET owner_id='user-b' WHERE id='task-a'", [], '23503');
  await rejects('Cross-company project owner rejected', "UPDATE projects SET owner_id='user-b' WHERE id='project-a'", [], '23503');
  await rejects('Cross-company goal owner rejected', "UPDATE goals SET owner_id='user-b' WHERE id='goal-a'", [], '23503');
  for (const [table, id] of [['comments','comment-a'], ['time_entries','time-a'], ['attachments','attachment-a']]) {
    await rejects(`Cross-company ${table} task rejected`, `UPDATE ${table} SET company_id='company-b' WHERE id=$1`, [id], '23503');
  }
  await rejects('Duplicate membership rejected', "INSERT INTO memberships (id,company_id,user_id,role) VALUES ('duplicate-membership','company-a','user-a','member')", [], '23505');
  await rejects('Duplicate task code within company rejected', "UPDATE tasks SET code='SW-1' WHERE id='task-a2'", [], '23505');
  await rejects('Duplicate company slug rejected', "UPDATE companies SET slug='company-a' WHERE id='company-b'", [], '23505');
  await rejects('Duplicate account email rejected', "UPDATE users SET email='a@example.invalid' WHERE id='user-b'", [], '23505');
  await rejects('Duplicate automation key rejected', "INSERT INTO automation_records (key,company_id,created_at) VALUES ('reminder:task-a:2026-10-10','company-a',$1)", [timestamp], '23505');
  await rejects('Invalid company role rejected', "UPDATE memberships SET role='superuser' WHERE id='membership-a'");
  await rejects('Capacity over 168 hours rejected', "UPDATE memberships SET capacity_hours=169 WHERE id='membership-a'");
  await rejects('Invalid task status rejected', "UPDATE tasks SET status='unknown' WHERE id='task-a'");
  await rejects('Progress over 100 rejected', "UPDATE tasks SET progress=101 WHERE id='task-a'");
  await rejects('Negative task effort rejected', "UPDATE tasks SET estimated_hours=-1 WHERE id='task-a'");
  await rejects('Nonpositive task version rejected', "UPDATE tasks SET version=0 WHERE id='task-a'");
  await rejects('Owner as reviewer rejected', "UPDATE tasks SET reviewer_id=owner_id WHERE id='task-a'");
  await rejects('Required review without reviewer rejected', "UPDATE tasks SET requires_approval=true WHERE id='task-a'");
  await rejects('Time entry over 24 hours rejected', "UPDATE time_entries SET hours=25 WHERE id='time-a'");
  await rejects('Nonpositive time entry rejected', "UPDATE time_entries SET hours=0 WHERE id='time-a'");
  await rejects('Attachment over 10 MiB rejected', "UPDATE attachments SET size=10485761 WHERE id='attachment-a'");
  await rejects('Empty attachment rejected', "UPDATE attachments SET size=0 WHERE id='attachment-a'");
  await rejects('Goal target equal to baseline rejected', "UPDATE goals SET target=baseline WHERE id='goal-a'");
  await rejects('Session for nonexistent user rejected', "UPDATE sessions SET user_id='missing-user'", [], '23503');
  const tags = ['engineering', 'evidence'];
  const checklist = [{id:'check-1', title:'Review file', required:true, done:false}];
  await pg.query("UPDATE tasks SET tags=$1::jsonb,checklist=$2::jsonb WHERE id='task-a'", [JSON.stringify(tags), JSON.stringify(checklist)]);
  const json = (await pg.query("SELECT tags,checklist,dependencies,collaborators FROM tasks WHERE id='task-a'")).rows[0];
  assert.deepEqual(json, {tags, checklist, dependencies:[], collaborators:[]});
  pass('JSONB arrays and checklist objects round-trip with empty-array defaults');
  await rejects('Malformed JSONB rejected', "UPDATE tasks SET tags=$1::jsonb WHERE id='task-a'", ['not-json'], '22P02');
  assert.equal((await pg.query("SELECT encode(data,'hex') AS data FROM attachments WHERE id='attachment-a'")).rows[0].data, '736368616368');
  pass('Evidence bytea round-trips exactly');
  assert.equal((await pg.query('SELECT expires_at > created_at AS ordered FROM sessions')).rows[0].ordered, true);
  pass('Session timestamptz values accepted and ordered');
  let transactionError;
  try {
    await pg.transaction(async tx => {
      await insertTask(tx, {id:'rollback-task', code:'SW-3'});
      await tx.query("UPDATE tasks SET owner_id='user-b' WHERE id='rollback-task'");
    });
  } catch (e) {transactionError = e;}
  assert.equal(transactionError?.code, '23503');
  assert.equal((await pg.query("SELECT count(*)::int AS count FROM tasks WHERE id='rollback-task'")).rows[0].count, 0);
  pass('Constraint error rolls back all writes in a multi-statement transaction');
  await rejects('Version one rejects the finance role before upgrade', "UPDATE memberships SET role='finance' WHERE id='membership-a'");
  const legacy = await legacySnapshot();
  for (const migration of migrations.slice(1)) await pg.transaction(tx => tx.exec(migration.up));
  pass('Version two upgrades the populated version-one database atomically');
  await assertLegacyPreserved(legacy);
  pass('Upgrade preserves every populated version-one field and row, including evidence bytes and audit history');
  await financeChecks(pg, pass, rejects);
  const repairMigration = migrations.find(m => m.version === 47);
  assert(repairMigration, 'Reconciliation attention repair migration required');
  await pg.exec(`
    INSERT INTO finance_statement_imports(id,company_id,creator_id,internal_hash,mapping_hash,mapping,preview_id,version,row_count,totals,created_at) VALUES
      ('repair-import-a','company-a','user-a','fictional-hash-a','mapping-a','{}','repair-preview-a',1,2,'{}',now()),
      ('repair-import-b','company-b','user-b','fictional-hash-b','mapping-b','{}','repair-preview-b',1,1,'{}',now());
    INSERT INTO finance_statement_rows(id,company_id,import_id,record_ordinal,booked_date,company_currency,signed_amount_minor,reference,description,reviewed_cells,version) VALUES
      ('repair-row-a1','company-a','repair-import-a',2,'2026-10-10','INR',-130050,'equal','Fictional occurrence','[]',1),
      ('repair-row-a2','company-a','repair-import-a',3,'2026-10-10','INR',-130050,'equal','Fictional occurrence','[]',1),
      ('repair-row-b1','company-b','repair-import-b',2,'2026-10-10','INR',-130050,'other','Fictional occurrence','[]',1);
  `);
  const repairCompanies = (await pg.query('SELECT DISTINCT company_id FROM finance_statement_rows ORDER BY company_id')).rows;
  assert(repairCompanies.length > 0, 'Populated finance statement upgrade fixture required');
  await pg.transaction(tx => tx.exec(repairMigration.down));
  await pg.transaction(tx => tx.exec(repairMigration.up));
  const repaired = (await pg.query('SELECT company_id FROM finance_reconciliation_attention_works WHERE revision=1 AND processed_revision=0 AND cursor=\'\' ORDER BY company_id')).rows;
  assert.deepEqual(repaired, repairCompanies);
  pass('SQL47 populated statement upgrade backfills exactly the dirty company cursor queue');
  await rejects('Repair cursor rejects nonexistent company', "INSERT INTO finance_reconciliation_attention_works(company_id,revision,updated_at) VALUES ('missing-company',1,now())", [], '23503');
  await rejects('Repair cursor rejects nonpositive revision', 'UPDATE finance_reconciliation_attention_works SET revision=0');
  await rejects('Repair cursor rejects processing a future revision', 'UPDATE finance_reconciliation_attention_works SET processed_revision=revision+1');
  for (const migration of migrations.slice(1).reverse()) await pg.transaction(tx => tx.exec(migration.down));
  assert.deepEqual((await pg.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename), originalTables);
  await assertLegacyPreserved(legacy, true);
  pass('Version-two downgrade removes financial tables while preserving original version-one data');
  assert.equal((await pg.query("SELECT role FROM memberships WHERE id='membership-finance'")).rows[0].role, 'member');
  pass('Disposable downgrade retains the added account and converts finance membership to the documented member role');
  assert.equal((await pg.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name IN ('currency','fiscal_year_start_month','next_expense_number')")).rows[0].count, 0);
  pass('Version-two downgrade removes financial company settings and sequence columns');
  await rejects('Version-two downgrade restores the original allowed-role constraint', "UPDATE memberships SET role='finance' WHERE id='membership-a'");
  await pg.transaction(tx => tx.exec(down));
  assert.equal((await pg.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'")).rows[0].count, 0);
  pass('Reverse-order downgrades remove all disposable fixture tables');
  result.passed = true;
} catch (e) {
  result.passed = false;
  result.failure = {message: e.message, code: e.code ?? null};
  process.exitCode = 1;
} finally {
  await pg.close();
  await writeFile(new URL('result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({kind:result.kind,passed:result.passed,pgliteVersion:result.pgliteVersion,engine:result.engine,checksPassed:result.checks.length,migrationSha256:result.migrationSha256,failure:result.failure,resultFile:new URL('result.json',import.meta.url).pathname}, null, 2));
}
