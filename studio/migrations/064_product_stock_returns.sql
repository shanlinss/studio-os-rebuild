ALTER TABLE product_stock_documents DROP CONSTRAINT product_stock_documents_operation_check;
ALTER TABLE product_stock_documents
 ADD CONSTRAINT product_stock_documents_operation_check CHECK(operation IN('inbound','shipment','return')),
 ADD COLUMN source_shipment_id uuid REFERENCES product_stock_documents(id) ON DELETE RESTRICT,
 ADD COLUMN resellable_confirmed boolean NOT NULL DEFAULT false,
 ADD CHECK ((operation='return' AND source_shipment_id IS NOT NULL AND resellable_confirmed)
  OR (operation<>'return' AND source_shipment_id IS NULL AND NOT resellable_confirmed));

CREATE TABLE product_stock_returns (
 return_movement_id uuid PRIMARY KEY REFERENCES warehouse_movements(id) ON DELETE RESTRICT,
 shipment_movement_id uuid NOT NULL REFERENCES warehouse_movements(id) ON DELETE RESTRICT,
 CHECK(return_movement_id<>shipment_movement_id)
);
CREATE INDEX product_stock_returns_shipment ON product_stock_returns(shipment_movement_id);
CREATE TRIGGER product_stock_returns_append_only BEFORE UPDATE OR DELETE ON product_stock_returns
 FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
