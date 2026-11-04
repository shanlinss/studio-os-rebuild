ALTER TABLE packaging_balances
 ADD COLUMN reorder_threshold integer CHECK(reorder_threshold>=0);

CREATE VIEW packaging_reorder_alerts AS
 SELECT b.id AS balance_id,w.id AS item_id,w.item_code,w.name,w.unit,b.store_id,s.name AS store_name,
        b.quantity,b.reorder_threshold
 FROM packaging_balances b
 JOIN warehouse_items w ON w.id=b.item_id
 LEFT JOIN stores s ON s.id=b.store_id
 WHERE w.active AND w.kind='packaging' AND (b.store_id IS NULL OR s.active)
   AND b.reorder_threshold IS NOT NULL AND b.quantity<=b.reorder_threshold;
