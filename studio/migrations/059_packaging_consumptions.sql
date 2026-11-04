CREATE TABLE packaging_consumptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER packaging_consumptions_append_only BEFORE UPDATE OR DELETE ON packaging_consumptions
 FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();

ALTER TABLE warehouse_movements
 ADD COLUMN packaging_consumption_id uuid REFERENCES packaging_consumptions(id) ON DELETE RESTRICT,
 ADD COLUMN used_store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,
 ADD CHECK ((packaging_consumption_id IS NULL AND used_store_id IS NULL)
  OR (packaging_consumption_id IS NOT NULL AND used_store_id IS NOT NULL AND packaging_balance_id IS NOT NULL AND type='outbound'));
CREATE UNIQUE INDEX warehouse_consumption_balance ON warehouse_movements(packaging_consumption_id,packaging_balance_id)
 WHERE packaging_consumption_id IS NOT NULL;
