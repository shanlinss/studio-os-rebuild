CREATE TABLE packaging_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE RESTRICT,
 store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,
 quantity integer NOT NULL CHECK(quantity>=0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE (item_id,id)
);

CREATE UNIQUE INDEX packaging_balances_public ON packaging_balances(item_id) WHERE store_id IS NULL;
CREATE UNIQUE INDEX packaging_balances_store ON packaging_balances(item_id,store_id) WHERE store_id IS NOT NULL;

ALTER TABLE warehouse_movements ADD COLUMN packaging_balance_id uuid;
ALTER TABLE warehouse_movements ADD FOREIGN KEY (item_id,packaging_balance_id)
 REFERENCES packaging_balances(item_id,id) ON DELETE RESTRICT;
CREATE INDEX warehouse_movements_packaging_balance ON warehouse_movements(packaging_balance_id,created_at DESC,id)
 WHERE packaging_balance_id IS NOT NULL;
