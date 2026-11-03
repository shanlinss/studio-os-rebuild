ALTER TABLE accounts DROP CONSTRAINT account_permission_names;
ALTER TABLE accounts ADD CONSTRAINT account_permission_names CHECK(admin_permissions <@ ARRAY['finance','account_security','payroll','personnel','resources']::text[] AND array_position(admin_permissions,NULL) IS NULL);
-- Existing admin roles already had these capabilities. Preserve them on upgrade;
-- newly-created/promoted administrators retain the original empty default.
UPDATE accounts SET admin_permissions=admin_permissions||ARRAY['personnel','resources']::text[] WHERE role='admin';
