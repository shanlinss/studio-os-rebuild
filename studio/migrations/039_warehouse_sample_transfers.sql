-- Provenance only. Quantities remain in the original warehouse_items and shooting_samples.
CREATE TABLE warehouse_sample_links (
 sample_id uuid PRIMARY KEY REFERENCES shooting_samples(id) ON DELETE RESTRICT,
 item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE RESTRICT,
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 specification text NOT NULL CHECK(length(specification)<=200),
 source_unit text NOT NULL CHECK(source_unit IN('件','个')),
 confirmed_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX warehouse_sample_links_item ON warehouse_sample_links(item_id,sample_id);
CREATE TABLE warehouse_sample_transfers (
 id uuid PRIMARY KEY,
 item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE RESTRICT,
 sample_id uuid NOT NULL REFERENCES shooting_samples(id) ON DELETE RESTRICT,
 movement_id uuid UNIQUE NOT NULL REFERENCES warehouse_movements(id) ON DELETE RESTRICT,
 sample_event_id uuid UNIQUE NOT NULL REFERENCES shooting_sample_events(id) ON DELETE RESTRICT,
 quantity integer NOT NULL CHECK(quantity>0),
 source_before integer NOT NULL CHECK(source_before>=0),
 source_after integer NOT NULL CHECK(source_after>=0),
 target_before integer NOT NULL CHECK(target_before>=0),
 target_after integer NOT NULL CHECK(target_after>=0),
 source_snapshot jsonb NOT NULL,
 target_snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_before::bigint-source_after=quantity),
 CHECK(target_after::bigint-target_before=quantity)
);
CREATE INDEX warehouse_sample_transfers_item ON warehouse_sample_transfers(item_id,created_at DESC,id);
CREATE INDEX warehouse_sample_transfers_sample ON warehouse_sample_transfers(sample_id,created_at DESC,id);
CREATE FUNCTION warehouse_keep_transfer_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Warehouse sample transfers and source bindings are append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER warehouse_sample_transfers_append_only BEFORE UPDATE OR DELETE ON warehouse_sample_transfers
FOR EACH ROW EXECUTE FUNCTION warehouse_keep_transfer_history();
CREATE TRIGGER warehouse_sample_links_append_only BEFORE UPDATE OR DELETE ON warehouse_sample_links
FOR EACH ROW EXECUTE FUNCTION warehouse_keep_transfer_history();
