-- Daily operational facts, separate from confirmed settlement income, cash and the expense ledger.
CREATE TABLE operating_finance_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN('sale','refund','fee')),
 store_id uuid NOT NULL REFERENCES stores(id),parent_id uuid REFERENCES operating_finance_records(id),
 expense_id uuid UNIQUE REFERENCES expense_records(id),source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 actor_id uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='refund')=(parent_id IS NOT NULL)),CHECK(expense_id IS NULL OR kind='fee')
);
CREATE UNIQUE INDEX operating_finance_source ON operating_finance_records(store_id,kind,lower(source_reference));
CREATE INDEX operating_finance_parent ON operating_finance_records(parent_id);
CREATE TABLE operating_finance_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),record_id uuid NOT NULL REFERENCES operating_finance_records(id),
 version integer NOT NULL CHECK(version>0),business_date date NOT NULL CHECK(business_date>='0001-01-01'::date),
 amount_cents integer NOT NULL CHECK(amount_cents>0),description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),
 note text NOT NULL CHECK(length(note)<=2000),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 status text NOT NULL CHECK(status IN('active','void')),parent_snapshot jsonb,expense_snapshot jsonb,
 actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(record_id,version)
);
CREATE TABLE operating_finance_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,operation text NOT NULL,target_id uuid,
 request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER operating_finance_records_append_only BEFORE UPDATE OR DELETE ON operating_finance_records FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER operating_finance_versions_append_only BEFORE UPDATE OR DELETE ON operating_finance_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER operating_finance_receipts_append_only BEFORE UPDATE OR DELETE ON operating_finance_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
