import assert from 'node:assert/strict';

// Financial SQL constraints are exercised separately from HTTP permissions and
// workflow. This file deliberately uses actual release migrations, never a
// hand-built lookalike schema. All fixtures are fictional and disposable.
export async function financeChecks(pg, pass, rejects) {
  const timestamp = '2026-10-10T12:00:00Z';
  const settings = (await pg.query('SELECT id,currency,fiscal_year_start_month FROM companies ORDER BY id')).rows;
  assert.deepEqual(settings, [
    {id: 'company-a', currency: 'INR', fiscal_year_start_month: 4},
    {id: 'company-b', currency: 'INR', fiscal_year_start_month: 4},
  ]);
  pass('Populated companies receive INR and April fiscal-year defaults');
  const notice = (await pg.query("SELECT expense_id FROM notifications WHERE id='notification-a'")).rows[0];
  assert.equal(notice.expense_id, '');
  pass('Existing task notifications receive an empty expense reference');

  const tables = (await pg.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('expense_categories','budgets','expenses','expense_receipts','finance_events') ORDER BY tablename")).rows.map(row => row.tablename);
  assert.deepEqual(tables, ['budgets', 'expense_categories', 'expense_receipts', 'expenses', 'finance_events']);
  pass('All five financial tables are present after the ordered upgrade');
  await rejects('Unsupported company currency rejected', "UPDATE companies SET currency='XYZ' WHERE id='company-a'");
  await rejects('Fiscal-year month before January rejected', "UPDATE companies SET fiscal_year_start_month=0 WHERE id='company-a'");
  await rejects('Fiscal-year month after December rejected', "UPDATE companies SET fiscal_year_start_month=13 WHERE id='company-a'");
  await rejects('Negative expense sequence rejected', "UPDATE companies SET next_expense_number=-1 WHERE id='company-a'");
  const amountTypes = (await pg.query("SELECT table_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('budgets','expenses') AND column_name='amount_minor' ORDER BY table_name")).rows;
  assert.deepEqual(amountTypes, [{table_name: 'budgets', data_type: 'bigint'}, {table_name: 'expenses', data_type: 'bigint'}]);
  pass('Both financial amount columns use exact PostgreSQL bigint storage');
  await pg.query(`
    INSERT INTO departments (id,company_id,name) VALUES ('department-a','company-a','Department A'),('department-b','company-b','Department B');
  `);
  await pg.query("INSERT INTO users (id,name,email,password_hash) VALUES ('user-finance','Finance reviewer','finance@example.invalid','not-a-login-hash')");
  await pg.query("INSERT INTO memberships (id,company_id,user_id,role,department_id) VALUES ('membership-finance','company-a','user-finance','finance','department-a')");
  assert.equal((await pg.query("SELECT role FROM memberships WHERE id='membership-finance'")).rows[0].role, 'finance');
  pass('Version two accepts the added finance role without changing existing memberships');
  await pg.exec(`
    INSERT INTO expense_categories (id,company_id,name) VALUES ('category-a','company-a','Materials'),('category-b','company-b','Materials');
    INSERT INTO budgets (id,company_id,department_id,name,start_date,end_date,amount_minor,currency,status,created_by,created_at,updated_at)
      VALUES ('budget-a','company-a','department-a','Annual envelope','2026-04-01','2027-03-31',10000,'INR','active','user-a','${timestamp}','${timestamp}'),
             ('budget-b','company-b','department-b','Zero draft envelope','2026-04-01','2027-03-31',0,'INR','draft','user-b','${timestamp}','${timestamp}');
  `);
  const defaults = (await pg.query("SELECT active,receipt_required,version FROM expense_categories WHERE id='category-a'")).rows[0];
  assert.equal(defaults.active, true);
  assert.equal(defaults.receipt_required, true);
  assert.equal(String(defaults.version), '1');
  pass('Categories have safe defaults and zero-valued draft budgets are accepted');
  await rejects('Category names are case-insensitively unique within a company', "INSERT INTO expense_categories (id,company_id,name) VALUES ('duplicate-category','company-a','MATERIALS')", [], '23505');
  await rejects('Empty category names rejected', "UPDATE expense_categories SET name=' ' WHERE id='category-a'");
  await rejects('Nonpositive category version rejected', "UPDATE expense_categories SET version=0 WHERE id='category-a'");
  await rejects('Cross-company budget department rejected', "UPDATE budgets SET department_id='department-b' WHERE id='budget-a'", [], '23503');
  await rejects('Cross-company budget creator rejected', "UPDATE budgets SET created_by='user-b' WHERE id='budget-a'", [], '23503');
  await rejects('Negative budget amount rejected', "UPDATE budgets SET amount_minor=-1 WHERE id='budget-a'");
  await rejects('Over-limit budget amount rejected', "UPDATE budgets SET amount_minor=1000000000001 WHERE id='budget-a'");
  await rejects('Nonintegral textual budget amount rejected by bigint input', "UPDATE budgets SET amount_minor=$1 WHERE id='budget-a'", ['1.5'], '22P02');
  await rejects('Unsupported budget currency rejected', "UPDATE budgets SET currency='XYZ' WHERE id='budget-a'");
  await rejects('Unknown budget state rejected', "UPDATE budgets SET status='deleted' WHERE id='budget-a'");
  await rejects('Reversed budget date order rejected', "UPDATE budgets SET start_date='2028-01-01' WHERE id='budget-a'");
  await rejects('Blank budget date rejected', "UPDATE budgets SET end_date='' WHERE id='budget-a'");
  await rejects('Nonpositive budget version rejected', "UPDATE budgets SET version=0 WHERE id='budget-a'");
  await pg.query("UPDATE budgets SET amount_minor=1000000000000 WHERE id='budget-a'");
  assert.equal(String((await pg.query("SELECT amount_minor FROM budgets WHERE id='budget-a'")).rows[0].amount_minor), '1000000000000');
  pass('Maximum budget minor-unit amount round-trips exactly');
  const baseExpense = {
    id: 'expense-a', company_id: 'company-a', code: 'EXP-0001',
    department_id: 'department-a', category_id: 'category-a', title: 'Financial compatibility fixture',
    vendor: 'Fixture Vendor', invoice_number: 'INV-001', vendor_key: 'fixture vendor', invoice_key: 'inv-001',
    expense_date: '2026-10-10', amount_minor: 12345, currency: 'INR', created_by: 'user-a',
    status: 'draft', created_at: timestamp, updated_at: timestamp,
  };
  async function insertExpense(connection, overrides = {}) {
    const row = {...baseExpense, ...overrides};
    const columns = Object.keys(row);
    return connection.query(`INSERT INTO expenses (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
  }
  await insertExpense(pg);
  await insertExpense(pg, {id: 'expense-a2', code: 'EXP-0002', invoice_number: '', invoice_key: ''});
  await insertExpense(pg, {id: 'expense-a3', code: 'EXP-0003', invoice_number: '', invoice_key: ''});
  await insertExpense(pg, {id: 'expense-b', company_id: 'company-b', department_id: 'department-b', category_id: 'category-b', created_by: 'user-b'});
  pass('Expense codes and invoice keys can repeat across companies; blank invoice numbers may repeat');
  await pg.exec(`
    INSERT INTO expense_receipts (id,company_id,expense_id,file_name,mime_type,size,uploaded_by,created_at,data)
      VALUES ('receipt-a','company-a','expense-a','receipt.txt','text/plain',7,'user-a','${timestamp}',decode('72656365697074','hex'));
    INSERT INTO finance_events (id,company_id,department_id,entity_type,entity_id,user_id,action,detail,created_at)
      VALUES ('finance-event-a','company-a','department-a','expense','expense-a','user-a','expense_created','Fictional financial event','${timestamp}');
  `);
  assert.equal((await pg.query("SELECT encode(data,'hex') AS data FROM expense_receipts WHERE id='receipt-a'")).rows[0].data, '72656365697074');
  pass('Expense receipt bytea and independent financial events persist');
  await rejects('Cross-company expense department rejected', "UPDATE expenses SET department_id='department-b' WHERE id='expense-a'", [], '23503');
  await rejects('Cross-company expense category rejected', "UPDATE expenses SET category_id='category-b' WHERE id='expense-a'", [], '23503');
  await rejects('Cross-company expense creator rejected', "UPDATE expenses SET created_by='user-b' WHERE id='expense-a'", [], '23503');
  await rejects('Cross-company receipt expense rejected', "UPDATE expense_receipts SET expense_id='expense-b' WHERE id='receipt-a'", [], '23503');
  await rejects('Cross-company receipt uploader rejected', "UPDATE expense_receipts SET uploaded_by='user-b' WHERE id='receipt-a'", [], '23503');
  await rejects('Financial event without a real company rejected', "UPDATE finance_events SET company_id='missing-company' WHERE id='finance-event-a'", [], '23503');
  await rejects('Unsupported financial event entity type rejected', "UPDATE finance_events SET entity_type='arbitrary' WHERE id='finance-event-a'");
  await rejects('Duplicate expense code within a company rejected', "UPDATE expenses SET code='EXP-0001' WHERE id='expense-a2'", [], '23505');
  await rejects('Duplicate normalized non-void vendor/invoice key rejected', "UPDATE expenses SET invoice_number='INV-001',invoice_key='inv-001' WHERE id='expense-a2'", [], '23505');
  await pg.query("UPDATE expenses SET status='void',invoice_number='INV-001',invoice_key='inv-001' WHERE id='expense-a2'");
  pass('Voided expenses preserve history without occupying the active vendor/invoice unique key');
  await rejects('Nonpositive expense amount rejected', "UPDATE expenses SET amount_minor=0 WHERE id='expense-a'");
  await rejects('Over-limit expense amount rejected', "UPDATE expenses SET amount_minor=1000000000001 WHERE id='expense-a'");
  await rejects('Nonintegral textual expense amount rejected by bigint input', "UPDATE expenses SET amount_minor=$1 WHERE id='expense-a'", ['12.5'], '22P02');
  await rejects('Unsupported expense currency rejected', "UPDATE expenses SET currency='XYZ' WHERE id='expense-a'");
  await rejects('Nonpositive expense version rejected', "UPDATE expenses SET version=0 WHERE id='expense-a'");
  await rejects('Unknown expense state rejected', "UPDATE expenses SET status='deleted' WHERE id='expense-a'");
  await rejects('Blank expense date rejected', "UPDATE expenses SET expense_date='' WHERE id='expense-a'");
  await rejects('Expense creator cannot be recorded as reviewer', "UPDATE expenses SET reviewed_by=created_by WHERE id='expense-a'");
  await rejects('Expense creator cannot be recorded as payment actor', "UPDATE expenses SET paid_by=created_by WHERE id='expense-a'");
  await rejects('Submitted expense without submission metadata rejected', "UPDATE expenses SET status='submitted' WHERE id='expense-a'");
  await rejects('Approved expense without independent review metadata rejected', "UPDATE expenses SET status='approved',submitted_at=$1 WHERE id='expense-a'", [timestamp]);
  await rejects('Paid expense without payment metadata rejected', "UPDATE expenses SET status='paid',submitted_at=$1,reviewed_by='user-finance',reviewed_at=$1 WHERE id='expense-a'", [timestamp]);
  await rejects('Oversized expense receipt rejected', "UPDATE expense_receipts SET size=10485761 WHERE id='receipt-a'");
  await rejects('Empty expense receipt rejected', "UPDATE expense_receipts SET size=0 WHERE id='receipt-a'");
  await pg.query("UPDATE expenses SET amount_minor=1000000000000 WHERE id='expense-a'");
  assert.equal(String((await pg.query("SELECT amount_minor FROM expenses WHERE id='expense-a'")).rows[0].amount_minor), '1000000000000');
  pass('Maximum expense minor-unit amount round-trips exactly');
  await pg.query("UPDATE expenses SET amount_minor=12345,status='paid',submitted_at=$1,reviewed_by='user-finance',reviewed_at=$1,paid_by='user-finance',paid_at=$1,paid_date='2026-10-10',payment_method='bank_transfer',payment_reference='PG-QA-0001' WHERE id='expense-a'", [timestamp]);
  const paid = (await pg.query("SELECT status,amount_minor,reviewed_by,paid_by,payment_reference FROM expenses WHERE id='expense-a'")).rows[0];
  assert.equal(paid.status, 'paid');
  assert.equal(String(paid.amount_minor), '12345');
  assert.equal(paid.reviewed_by, 'user-finance');
  assert.equal(paid.paid_by, 'user-finance');
  assert.equal(paid.payment_reference, 'PG-QA-0001');
  pass('A valid externally recorded payment preserves its exact amount and independent actor metadata');
  await rejects('Payment dated before the expense rejected', "UPDATE expenses SET paid_date='2026-10-09' WHERE id='expense-a'");
  await rejects('Paid expense without a reference rejected', "UPDATE expenses SET payment_reference='  ' WHERE id='expense-a'");
  await rejects('Unsupported payment method rejected', "UPDATE expenses SET payment_method='crypto' WHERE id='expense-a'");
  await rejects('Paid expense without review timestamp rejected', "UPDATE expenses SET reviewed_at='' WHERE id='expense-a'");
  let transactionError;
  try {
    await pg.transaction(async tx => {
      await insertExpense(tx, {id: 'rollback-expense', code: 'EXP-ROLLBACK', invoice_key: '', invoice_number: ''});
      await tx.query("UPDATE expenses SET category_id='category-b' WHERE id='rollback-expense'");
    });
  } catch (error) {transactionError = error;}
  assert.equal(transactionError?.code, '23503');
  assert.equal((await pg.query("SELECT count(*)::int AS count FROM expenses WHERE id='rollback-expense'")).rows[0].count, 0);
  pass('A financial foreign-key failure rolls back its preceding expense insert');
}
