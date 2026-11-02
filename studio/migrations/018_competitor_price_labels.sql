-- Preserve the legacy observation field's free-text prices (ranges, labels,
-- currencies) without forcing them into a financial amount or dropping text.
ALTER TABLE competitor_products ADD COLUMN price_label text NOT NULL DEFAULT '' CHECK(length(price_label)<=200);
ALTER TABLE competitor_products ADD CONSTRAINT competitor_product_price_source CHECK(price_label='' OR price_cents IS NULL);
ALTER TABLE competitor_sales_snapshots ADD COLUMN price_label text NOT NULL DEFAULT '' CHECK(length(price_label)<=200);
ALTER TABLE competitor_sales_snapshots ADD CONSTRAINT competitor_snapshot_price_source CHECK(price_label='' OR price_cents IS NULL);
