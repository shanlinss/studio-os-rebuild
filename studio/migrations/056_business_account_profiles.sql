ALTER TABLE business_accounts
 ADD COLUMN platform text NOT NULL DEFAULT '小红书' CHECK(length(platform) BETWEEN 1 AND 40),
 ADD COLUMN platform_account_id text NOT NULL DEFAULT '' CHECK(length(platform_account_id)<=100),
 ADD COLUMN avatar_url text,
 ADD COLUMN purpose text NOT NULL DEFAULT '' CHECK(length(purpose)<=1000),
 ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,
 ADD COLUMN primary_device_id uuid UNIQUE REFERENCES equipment_assets(id) ON DELETE RESTRICT;

CREATE TABLE business_account_extra_devices (
 account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES equipment_assets(id) ON DELETE RESTRICT,
 PRIMARY KEY(account_id, device_id)
);
CREATE INDEX business_account_extra_devices_device ON business_account_extra_devices(device_id);
