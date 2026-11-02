-- Explicit downloads are separate from ordinary image previews. A receipt only
-- becomes a download mark after its authenticated owner confirms receipt.
CREATE TABLE material_asset_downloads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 asset_id uuid NOT NULL REFERENCES material_assets(id) ON DELETE CASCADE,
 requested_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
 confirmed_at timestamptz,
 first_for_asset boolean NOT NULL DEFAULT false,
 CHECK (NOT first_for_asset OR confirmed_at IS NOT NULL)
);
CREATE UNIQUE INDEX material_asset_downloads_first
 ON material_asset_downloads(asset_id) WHERE first_for_asset;
CREATE INDEX material_asset_downloads_pending
 ON material_asset_downloads(requested_by, expires_at) WHERE confirmed_at IS NULL;
