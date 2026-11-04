CREATE TABLE commercial_products (
 product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE RESTRICT,
 code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 64),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commercial_product_code ON commercial_products(lower(code));

CREATE TABLE product_skus (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES commercial_products(product_id) ON DELETE RESTRICT,
 code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 64),
 specification text NOT NULL DEFAULT '' CHECK(length(specification)<=200),
 unit text NOT NULL CHECK(unit IN('件','个','套','包','卷','箱')),
 active boolean NOT NULL DEFAULT true,
 warehouse_item_id uuid UNIQUE REFERENCES warehouse_items(id) ON DELETE RESTRICT,
 UNIQUE(product_id,id)
);
CREATE UNIQUE INDEX product_sku_code ON product_skus(lower(code));

CREATE TABLE product_sku_stores (
 sku_id uuid NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
 store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
 platform_product_id text NOT NULL CHECK(length(btrim(platform_product_id)) BETWEEN 1 AND 100),
 platform_sku_id text NOT NULL CHECK(length(btrim(platform_sku_id)) BETWEEN 1 AND 100),
 listing_url text,
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(sku_id,store_id)
);
CREATE UNIQUE INDEX product_sku_store_identity ON product_sku_stores(store_id,platform_product_id,platform_sku_id);

CREATE TABLE commercial_product_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES commercial_products(product_id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commercial_product_events_parent ON commercial_product_events(product_id,created_at DESC,id);
CREATE TRIGGER commercial_product_events_append_only BEFORE UPDATE OR DELETE ON commercial_product_events
 FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();

CREATE TABLE commercial_product_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),
 request_key uuid NOT NULL,
 product_id uuid NOT NULL REFERENCES commercial_products(product_id),
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER commercial_product_receipts_append_only BEFORE UPDATE OR DELETE ON commercial_product_receipts
 FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
