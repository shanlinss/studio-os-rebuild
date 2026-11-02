-- AccountManagementPanel@a69dda9: admin-only phone fields and remark.
-- Optional details do not determine account/store cardinality or task ownership.
ALTER TABLE studio_os.business_accounts
 ADD COLUMN bound_phone text CHECK (bound_phone IS NULL OR length(bound_phone)<=100),
 ADD COLUMN actual_phone text CHECK (actual_phone IS NULL OR length(actual_phone)<=100),
 ADD COLUMN remark text NOT NULL DEFAULT '' CHECK (length(remark)<=2000);
