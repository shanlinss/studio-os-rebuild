-- Explicit administrator association only. Preserve original product text and all
-- rounds/tasks; do not infer identity from names or grant the product directory.
ALTER TABLE lab_experiments ADD COLUMN product_id uuid REFERENCES products(id) ON DELETE RESTRICT;
CREATE INDEX lab_experiments_product ON lab_experiments(product_id) WHERE product_id IS NOT NULL;
