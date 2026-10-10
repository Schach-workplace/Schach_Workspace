-- Owned PostgreSQL EXPLAIN: company page scanned 500 candidates and sorted;
-- this index reads the first 101 ordered rows directly (see runtime load fixture).
CREATE INDEX tasks_company_created_page ON tasks(company_id,created_at DESC,id DESC);
