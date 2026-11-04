CREATE TABLE packaging_stock_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE RESTRICT,
 source_balance_id uuid NOT NULL,
 target_balance_id uuid NOT NULL,
 outbound_movement_id uuid NOT NULL UNIQUE REFERENCES warehouse_movements(id) ON DELETE RESTRICT,
 inbound_movement_id uuid NOT NULL UNIQUE REFERENCES warehouse_movements(id) ON DELETE RESTRICT,
 quantity integer NOT NULL CHECK(quantity>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(item_id,source_balance_id) REFERENCES packaging_balances(item_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(item_id,target_balance_id) REFERENCES packaging_balances(item_id,id) ON DELETE RESTRICT,
 CHECK(source_balance_id<>target_balance_id AND outbound_movement_id<>inbound_movement_id)
);
CREATE TRIGGER packaging_stock_transfers_append_only BEFORE UPDATE OR DELETE ON packaging_stock_transfers
 FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
