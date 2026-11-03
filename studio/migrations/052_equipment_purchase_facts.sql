-- Protected acquisition facts reference the existing asset and ledger.
-- Keep them out of ordinary equipment row/event snapshots and borrowing payloads.
CREATE TABLE equipment_purchase_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 equipment_id uuid NOT NULL REFERENCES equipment_assets(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 purchase_date date,
 amount_cents integer CHECK(amount_cents>=0),
 supplier text NOT NULL DEFAULT '' CHECK(length(supplier)<=150),
 expense_id uuid REFERENCES expense_records(id) ON DELETE RESTRICT,
 expense_snapshot jsonb,
 equipment_snapshot jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(equipment_id,version),
 CHECK((expense_id IS NULL)=(expense_snapshot IS NULL)),
 CHECK(purchase_date IS NULL OR purchase_date>='0001-01-01'::date)
);
CREATE TRIGGER equipment_purchase_versions_append_only BEFORE UPDATE OR DELETE ON equipment_purchase_versions
FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TABLE equipment_purchase_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 equipment_id uuid NOT NULL REFERENCES equipment_assets(id) ON DELETE RESTRICT,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER equipment_purchase_receipts_append_only BEFORE UPDATE OR DELETE ON equipment_purchase_receipts
FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
