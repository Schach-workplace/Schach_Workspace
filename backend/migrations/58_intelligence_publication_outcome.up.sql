ALTER TABLE intelligence_publications ADD COLUMN outcome text NOT NULL DEFAULT 'created' CHECK(outcome IN ('created','existing'));
