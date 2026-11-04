-- Actual money evidence; never posts income, operating expense, or reimbursements.
CREATE TABLE cash_movement_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),direction text NOT NULL CHECK(direction IN('in','out')),
 account_label text NOT NULL CHECK(length(btrim(account_label)) BETWEEN 1 AND 100),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX cash_movement_source_unique ON cash_movement_records(lower(btrim(account_label)),lower(btrim(source_reference)));
CREATE TABLE cash_movement_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),record_id uuid NOT NULL REFERENCES cash_movement_records(id),version integer NOT NULL CHECK(version>0),
 paid_date date NOT NULL,amount_cents integer NOT NULL CHECK(amount_cents>0),description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines)<=50),
 status text NOT NULL CHECK(status IN('active','void')),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(record_id,version)
);
CREATE TABLE cash_source_references (
 record_id uuid NOT NULL REFERENCES cash_movement_records(id),source_key text NOT NULL,
 expense_id uuid REFERENCES expense_records(id) ON DELETE RESTRICT,
 store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,month text,
 PRIMARY KEY(record_id,source_key),
 CHECK((expense_id IS NOT NULL AND store_id IS NULL AND month IS NULL) OR (expense_id IS NULL AND store_id IS NOT NULL AND month IS NOT NULL AND month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'))
);
CREATE TABLE cash_movement_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,operation text NOT NULL CHECK(operation IN('create','revise','void')),target_id uuid,
 request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER cash_records_append_only BEFORE UPDATE OR DELETE ON cash_movement_records FOR EACH ROW EXECUTE FUNCTION warehouse_keep_transfer_history();
CREATE TRIGGER cash_versions_append_only BEFORE UPDATE OR DELETE ON cash_movement_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_transfer_history();
CREATE TRIGGER cash_references_append_only BEFORE UPDATE OR DELETE ON cash_source_references FOR EACH ROW EXECUTE FUNCTION warehouse_keep_transfer_history();
CREATE TRIGGER cash_receipts_append_only BEFORE UPDATE OR DELETE ON cash_movement_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_transfer_history();
