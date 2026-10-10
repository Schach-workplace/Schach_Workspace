-- Schach Workspace PostgreSQL schema, version 2. Apply after version 1.
-- Existing companies keep INR and an April financial year. No financial history
-- or balances are invented during upgrade; application-created companies get
-- editable starter categories through the shared platform initializer.
ALTER TABLE companies
 ADD COLUMN currency text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP','AED','SGD','AUD','CAD')),
 ADD COLUMN fiscal_year_start_month integer NOT NULL DEFAULT 4 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
 ADD COLUMN next_expense_number bigint NOT NULL DEFAULT 0 CHECK (next_expense_number >= 0);

ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
 CHECK (role IN ('founder','ceo','admin','finance','head','manager','member','viewer'));

ALTER TABLE notifications ADD COLUMN expense_id text NOT NULL DEFAULT '';

CREATE TABLE expense_categories (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id),
 name text NOT NULL CHECK (length(trim(name)) > 0), color text NOT NULL DEFAULT '#64748B',
 active boolean NOT NULL DEFAULT true, receipt_required boolean NOT NULL DEFAULT true,
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0), UNIQUE (company_id,id)
);
CREATE UNIQUE INDEX expense_category_company_name ON expense_categories(company_id,lower(name));

CREATE TABLE budgets (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id),
 department_id varchar(80) NOT NULL, name text NOT NULL CHECK (length(trim(name)) > 0),
 start_date text NOT NULL, end_date text NOT NULL,
 amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 0 AND 1000000000000),
 currency text NOT NULL CHECK (currency IN ('INR','USD','EUR','GBP','AED','SGD','AUD','CAD')),
 status text NOT NULL CHECK (status IN ('draft','active','closed')), notes text NOT NULL DEFAULT '',
 created_by varchar(80) NOT NULL, created_at text NOT NULL, updated_at text NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 CHECK (start_date <> '' AND end_date <> '' AND start_date <= end_date),
 FOREIGN KEY (company_id,department_id) REFERENCES departments(company_id,id),
 FOREIGN KEY (company_id,created_by) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX idx_budgets_company_department_period ON budgets(company_id,department_id,start_date,end_date);

CREATE TABLE expenses (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id), code text NOT NULL,
 department_id varchar(80) NOT NULL, category_id varchar(80) NOT NULL,
 title text NOT NULL CHECK (length(trim(title)) > 0), description text NOT NULL DEFAULT '',
 vendor text NOT NULL CHECK (length(trim(vendor)) > 0), invoice_number text NOT NULL DEFAULT '',
 vendor_key text NOT NULL DEFAULT '', invoice_key text NOT NULL DEFAULT '',
 expense_date text NOT NULL CHECK (expense_date <> ''),
 amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000),
 currency text NOT NULL CHECK (currency IN ('INR','USD','EUR','GBP','AED','SGD','AUD','CAD')),
 project_id text NOT NULL DEFAULT '', task_id text NOT NULL DEFAULT '', created_by varchar(80) NOT NULL,
 status text NOT NULL CHECK (status IN ('draft','submitted','approved','rejected','paid','void')),
 receipt_exception_reason text NOT NULL DEFAULT '', submitted_at text NOT NULL DEFAULT '',
 reviewed_by text NOT NULL DEFAULT '', reviewed_at text NOT NULL DEFAULT '', review_note text NOT NULL DEFAULT '',
 budget_override_reason text NOT NULL DEFAULT '', paid_by text NOT NULL DEFAULT '', paid_at text NOT NULL DEFAULT '',
 paid_date text NOT NULL DEFAULT '', payment_method text NOT NULL DEFAULT '', payment_reference text NOT NULL DEFAULT '',
 created_at text NOT NULL, updated_at text NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 CONSTRAINT expense_company_code UNIQUE (company_id,code), UNIQUE (company_id,id),
 FOREIGN KEY (company_id,department_id) REFERENCES departments(company_id,id),
 FOREIGN KEY (company_id,category_id) REFERENCES expense_categories(company_id,id),
 FOREIGN KEY (company_id,created_by) REFERENCES memberships(company_id,user_id),
 CHECK (reviewed_by = '' OR reviewed_by <> created_by),
 CHECK (paid_by = '' OR paid_by <> created_by),
 CHECK (status NOT IN ('submitted','approved','rejected','paid') OR submitted_at <> ''),
 CHECK (status NOT IN ('approved','rejected','paid') OR (reviewed_by <> '' AND reviewed_at <> '')),
 CHECK (payment_method IN ('','bank_transfer','upi','card','cash','other')),
 CHECK (status <> 'paid' OR (paid_by <> '' AND paid_at <> '' AND paid_date >= expense_date AND payment_method <> '' AND length(trim(payment_reference)) > 0))
);
CREATE UNIQUE INDEX expense_company_vendor_invoice ON expenses(company_id,vendor_key,invoice_key)
 WHERE invoice_key <> '' AND status <> 'void';
CREATE INDEX idx_expenses_company_department_date_status ON expenses(company_id,department_id,expense_date,status);
CREATE INDEX idx_expenses_company_creator ON expenses(company_id,created_by);
CREATE INDEX idx_expenses_company_category ON expenses(company_id,category_id);

CREATE TABLE expense_receipts (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL, expense_id varchar(80) NOT NULL,
 file_name text NOT NULL, mime_type text NOT NULL,
 size bigint NOT NULL CHECK (size > 0 AND size <= 10485760),
 uploaded_by varchar(80) NOT NULL, created_at text NOT NULL, data bytea NOT NULL,
 FOREIGN KEY (company_id,expense_id) REFERENCES expenses(company_id,id),
 FOREIGN KEY (company_id,uploaded_by) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX idx_expense_receipts_company_expense ON expense_receipts(company_id,expense_id);

CREATE TABLE finance_events (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id),
 department_id text NOT NULL DEFAULT '', entity_type text NOT NULL CHECK (entity_type IN ('category','budget','expense')),
 entity_id varchar(80) NOT NULL, user_id text NOT NULL DEFAULT '', action text NOT NULL, detail text NOT NULL DEFAULT '', created_at text NOT NULL
);
CREATE INDEX idx_finance_events_company_entity_created ON finance_events(company_id,entity_type,entity_id,created_at DESC);
CREATE INDEX idx_finance_events_company_department_created ON finance_events(company_id,department_id,created_at DESC);

-- Company locking enforces inclusive budget non-overlap, financial-year scope,
-- currency immutability, permissions, duplicate-key normalization and workflow
-- changes in shared transactions. The application role must not bypass this API.
