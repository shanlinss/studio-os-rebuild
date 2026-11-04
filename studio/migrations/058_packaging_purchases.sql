CREATE TABLE packaging_purchases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE RESTRICT,
 purchase_date date NOT NULL CHECK(purchase_date>='0001-01-01'::date),
 supplier text NOT NULL CHECK(length(btrim(supplier)) BETWEEN 1 AND 150),
 quantity integer NOT NULL CHECK(quantity>0),
 unit_cents integer NOT NULL CHECK(unit_cents>=0),
 total_cents integer NOT NULL CHECK(total_cents::bigint=quantity::bigint*unit_cents),
 expense_id uuid UNIQUE REFERENCES expense_records(id) ON DELETE RESTRICT,
 expense_snapshot jsonb,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((expense_id IS NULL)=(expense_snapshot IS NULL))
);
CREATE INDEX packaging_purchases_item ON packaging_purchases(item_id,created_at DESC,id);

CREATE TABLE packaging_purchase_allocations (
 purchase_id uuid NOT NULL REFERENCES packaging_purchases(id) ON DELETE RESTRICT,
 balance_id uuid NOT NULL REFERENCES packaging_balances(id) ON DELETE RESTRICT,
 movement_id uuid NOT NULL UNIQUE REFERENCES warehouse_movements(id) ON DELETE RESTRICT,
 PRIMARY KEY(purchase_id,balance_id)
);
CREATE TRIGGER packaging_purchases_append_only BEFORE UPDATE OR DELETE ON packaging_purchases
 FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER packaging_purchase_allocations_append_only BEFORE UPDATE OR DELETE ON packaging_purchase_allocations
 FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
