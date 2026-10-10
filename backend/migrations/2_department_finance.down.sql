-- DESTRUCTIVE: disposable rollback only. Removes all financial history and
-- demotes finance memberships to ordinary members for compatibility with v1.
DROP TABLE finance_events;
DROP TABLE expense_receipts;
DROP TABLE expenses;
DROP TABLE budgets;
DROP TABLE expense_categories;
ALTER TABLE notifications DROP COLUMN expense_id;
UPDATE memberships SET role = 'member' WHERE role = 'finance';
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
 CHECK (role IN ('founder','ceo','admin','head','manager','member','viewer'));
ALTER TABLE companies
 DROP COLUMN next_expense_number,
 DROP COLUMN fiscal_year_start_month,
 DROP COLUMN currency;
