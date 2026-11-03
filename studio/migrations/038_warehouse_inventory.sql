-- Quantity facts only; original product, sample, financial and identity tables remain authoritative.
CREATE TABLE warehouse_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_code text NOT NULL CHECK(length(item_code) BETWEEN 1 AND 64),
 kind text NOT NULL CHECK(kind IN('product','packaging')),
 product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 specification text NOT NULL DEFAULT '' CHECK(length(specification)<=200),
 unit text NOT NULL CHECK(unit IN('件','个','套','包','卷','箱')),
 location text NOT NULL CHECK(length(location) BETWEEN 1 AND 150),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 opening_confirmed boolean NOT NULL DEFAULT false,
 quantity integer CHECK(quantity>=0),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='product' AND product_id IS NOT NULL) OR (kind='packaging' AND product_id IS NULL)),
 CHECK((opening_confirmed AND quantity IS NOT NULL) OR (NOT opening_confirmed AND quantity IS NULL))
);
CREATE UNIQUE INDEX warehouse_item_code_casefold ON warehouse_items(lower(item_code));
CREATE TABLE warehouse_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE RESTRICT,
 type text NOT NULL CHECK(type IN('opening','inbound','outbound','stocktake')),
 quantity integer NOT NULL CHECK(quantity>=0),
 delta integer NOT NULL,
 before_quantity integer CHECK(before_quantity>=0),
 after_quantity integer NOT NULL CHECK(after_quantity>=0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 source_reference text NOT NULL DEFAULT '' CHECK(length(source_reference)<=200),
 corrects_movement_id uuid REFERENCES warehouse_movements(id) ON DELETE RESTRICT,
 item_snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((type='opening' AND before_quantity IS NULL AND delta=quantity AND after_quantity=quantity)
    OR (type='inbound' AND before_quantity IS NOT NULL AND quantity>0 AND delta=quantity AND after_quantity::bigint=before_quantity::bigint+quantity)
    OR (type='outbound' AND before_quantity IS NOT NULL AND quantity>0 AND delta=-quantity AND after_quantity::bigint=before_quantity::bigint-quantity)
    OR (type='stocktake' AND before_quantity IS NOT NULL AND after_quantity=quantity AND delta::bigint=after_quantity::bigint-before_quantity)),
 CHECK(corrects_movement_id IS NULL OR type='stocktake')
);
CREATE INDEX warehouse_movements_item ON warehouse_movements(item_id,created_at DESC,id);
CREATE FUNCTION warehouse_keep_movement_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Warehouse movements are append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER warehouse_movements_append_only BEFORE UPDATE OR DELETE ON warehouse_movements
FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TABLE warehouse_item_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 action text NOT NULL CHECK(action IN('registered','edited')),
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX warehouse_item_events_item ON warehouse_item_events(item_id,created_at DESC,id);
CREATE TABLE warehouse_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),
 request_key uuid NOT NULL,
 action text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
