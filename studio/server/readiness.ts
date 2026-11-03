import type { StudioDatabase } from './database';
import { readMigrationFiles } from './migrations';

// Read-only: never applies migrations, repairs schemas, or returns account data.
export async function checkReadiness(
  database: StudioDatabase,
  schema = 'studio_os',
) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid schema');
  const files = await readMigrationFiles();
  await database.client.begin('read only', async (tx) => {
    await tx`SET LOCAL statement_timeout = '2s'`;
    await tx.unsafe(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    const applied = await tx<
      { name: string; checksum: string }[]
    >`SELECT name, checksum FROM schema_migrations ORDER BY name`;
    if (
      applied.length !== files.length ||
      applied.some(
        (row, i) =>
          row.name !== files[i].name || row.checksum !== files[i].checksum,
      )
    )
      throw new Error('Migrations are not ready');
    if (
      (await tx`SELECT id FROM installation WHERE singleton = true`).length !==
      1
    )
      throw new Error('Installation is not ready');
    await tx`SELECT id, display_name, login_account_id, active, version FROM members LIMIT 0`;
    await tx`SELECT entity_type, entity_id, actor_id, before_value, after_value FROM identity_events LIMIT 0`;
    await tx`SELECT id, name, profile_url, bound_phone, actual_phone, remark, responsible_member_id, active, version FROM business_accounts LIMIT 0`;
    await tx`SELECT account_id, actor_id, before_value, after_value FROM business_account_events LIMIT 0`;
    await tx`SELECT id,author_id,body,version,created_at,updated_at FROM operational_observations LIMIT 0`;
    await tx`SELECT id,observation_id,added_version,name,mime,content,digest FROM operational_observation_assets LIMIT 0`;
    await tx`SELECT id,observation_id,actor_id,request_key,request_hash,before_value,after_value FROM operational_observation_events LIMIT 0`;
    await tx`SELECT id,title,source_url FROM materials LIMIT 0`;
    await tx`SELECT id,name,ai_rule,active,position,version FROM reference_dimensions LIMIT 0`;
    await tx`SELECT id,material_id,dimension_id,content,asset_id FROM material_elements LIMIT 0`;
    await tx`SELECT id,owner_id,request_key FROM personal_inspirations LIMIT 0`;
    await tx`SELECT id,status,version FROM research_candidates LIMIT 0`;
    await tx`SELECT candidate_id,material_id,element_id,template_id FROM candidate_references LIMIT 0`;
    await tx`SELECT plan_id,candidate_id,source_snapshot FROM plan_candidate_sources LIMIT 0`;
    await tx`SELECT id,asset_id,requested_by,expires_at,confirmed_at,first_for_asset FROM material_asset_downloads LIMIT 0`;
    await tx`SELECT id,title,conclusion,version FROM plans LIMIT 0`;
    await tx`SELECT plan_id,material_id FROM plan_materials LIMIT 0`;
    await tx`SELECT id,plan_id,member_id,account_id,target_count FROM tasks LIMIT 0`;
    await tx`SELECT id,task_id,url,published_at FROM publications LIMIT 0`;
    await tx`SELECT publication_id,observed_at,views,likes,favorites,comments FROM data_snapshots LIMIT 0`;
    await tx`SELECT plan_id,actor_id,action,reference_id FROM workflow_events LIMIT 0`;
    await tx`SELECT id,publication_id,name,mime,content,created_by FROM publication_assets LIMIT 0`;
    await tx`SELECT publication_id,asset_id,actor_id,action FROM publication_asset_events LIMIT 0`;
    await tx`SELECT plan_id,actor_id,request_key,request_hash,result FROM snapshot_imports LIMIT 0`;
    await tx`SELECT id,name,store_id,active,version FROM products LIMIT 0`;
    await tx`SELECT product_id,id,name,position FROM product_stages LIMIT 0`;
    await tx`SELECT product_id,name,mime,content FROM product_images LIMIT 0`;
    await tx`SELECT product_id,decision,reason FROM product_reviews LIMIT 0`;
    await tx`SELECT product_id,actor_id,action,detail FROM product_events LIMIT 0`;
    await tx`SELECT source_type,product_id,stage_id,requirements FROM plans LIMIT 0`;
    await tx`SELECT kind FROM tasks LIMIT 0`;
    await tx`SELECT task_id,material_id,target_count,requirements FROM task_materials LIMIT 0`;
    await tx`SELECT task_id,evidence_url,feedback,completed_by FROM action_completions LIMIT 0`;
    await tx`SELECT material_id FROM publications LIMIT 0`;
    await tx`SELECT id,title,owner_id,request_key,request_hash,task_type,priority,status,notes,version,deleted_at FROM personal_todos LIMIT 0`;
    await tx`SELECT todo_id,actor_id,action,detail FROM personal_todo_events LIMIT 0`;
    await tx`SELECT id,name,batch_date,version FROM title_batches LIMIT 0`;
    await tx`SELECT id,batch_id,title,direction,usage_count,position FROM title_entries LIMIT 0`;
    await tx`SELECT batch_id,actor_id,action,detail FROM title_events LIMIT 0`;
    await tx`SELECT id,batch_id,actor_id,entry_ids FROM title_copy_receipts LIMIT 0`;
    await tx`SELECT id,name,url,category,description,version FROM toolbox_links LIMIT 0`;
    await tx`SELECT link_id,actor_id,action,before_value,after_value FROM toolbox_events LIMIT 0`;
    await tx`SELECT id,title,entry_type,kind,category,summary,body,source_url,experiment_id,product_review_id,tags,version FROM knowledge_assets LIMIT 0`;
    await tx`SELECT asset_id,name,mime,content FROM knowledge_covers LIMIT 0`;
    await tx`SELECT asset_id,actor_id,action,before_value,after_value FROM knowledge_events LIMIT 0`;
    await tx`SELECT id,name,structure,product,scene,description,note,tags,rating,source_material_id,source_experiment_id,archived,version FROM note_templates LIMIT 0`;
    await tx`SELECT id,template_id,name,mime,content FROM template_assets LIMIT 0`;
    await tx`SELECT template_id,actor_id,action,detail FROM template_events LIMIT 0`;
    await tx`SELECT template_id,template_material_id,template_version,instructions FROM tasks LIMIT 0`;
    await tx`SELECT template_id,title,note,version FROM publications LIMIT 0`;
    await tx`SELECT has_conversion FROM data_snapshots LIMIT 0`;
    await tx`SELECT id,name,xhs_id,profile_url,status,notes,version FROM competitor_accounts LIMIT 0`;
    await tx`SELECT competitor_id,store_id FROM competitor_store_links LIMIT 0`;
    await tx`SELECT competitor_id,product_id FROM competitor_product_links LIMIT 0`;
    await tx`SELECT id,competitor_id,name,xhs_id,profile_url,notes FROM competitor_sub_accounts LIMIT 0`;
    await tx`SELECT id,competitor_id,name,product_url,linked_product_id,price_cents,price_label,notes FROM competitor_products LIMIT 0`;
    await tx`SELECT id,competitor_id,product_id,snapshot_date,sales,price_cents,price_label FROM competitor_sales_snapshots LIMIT 0`;
    await tx`SELECT id,competitor_id,sub_account_id,observation_date,content FROM competitor_observations LIMIT 0`;
    await tx`SELECT id,competitor_id,sub_account_id,product_id,observation_id,name,mime,content FROM competitor_files LIMIT 0`;
    await tx`SELECT competitor_id,actor_id,action,detail FROM competitor_events LIMIT 0`;

    await tx`SELECT id,name,active,version FROM expense_categories LIMIT 0`;
    await tx`SELECT id,expense_date,store_id,category_id,description,amount_cents,payment_mode,payer_id,note,version,request_key,request_hash FROM expense_records LIMIT 0`;
    await tx`SELECT id,expense_id,name,mime,content FROM expense_receipts LIMIT 0`;
    await tx`SELECT id,payer_id,start_date,end_date,note,version,request_key,request_hash FROM expense_settlements LIMIT 0`;
    await tx`SELECT expense_id,settlement_id,amount_cents FROM expense_settlement_items LIMIT 0`;
    await tx`SELECT id,settlement_id,payer_id,amount_cents,paid_date,note,request_key,request_hash FROM expense_reimbursements LIMIT 0`;
    await tx`SELECT entity_type,entity_id,actor_id,action,detail FROM expense_events LIMIT 0`;
    // Test the actual columns required by authentication, not only table names.
    await tx`SELECT id, username, password_hash, role, active, version, superadmin, admin_permissions FROM accounts LIMIT 0`;
    await tx`SELECT id,asset_tag,name,keeper_member_id,location,status,version FROM equipment_assets LIMIT 0`;
    await tx`SELECT id,equipment_id,owner_id,returned_at,return_condition,return_location,version FROM equipment_loans LIMIT 0`;
    await tx`SELECT id,equipment_id,actor_id,action,before_value,after_value FROM equipment_events LIMIT 0`;
    await tx`SELECT actor_id,request_key,action,request_hash,result FROM equipment_receipts LIMIT 0`;
    await tx`SELECT id,item_code,kind,product_id,unit,opening_confirmed,quantity,version FROM warehouse_items LIMIT 0`;
    await tx`SELECT id,item_id,type,quantity,delta,before_quantity,after_quantity,item_snapshot,corrects_movement_id FROM warehouse_movements LIMIT 0`;
    await tx`SELECT id,item_id,actor_id,action,before_value,after_value FROM warehouse_item_events LIMIT 0`;
    await tx`SELECT actor_id,request_key,request_hash,result FROM warehouse_receipts LIMIT 0`;
    await tx`SELECT sample_id,item_id,product_id,specification,source_unit,confirmed_by FROM warehouse_sample_links LIMIT 0`;
    await tx`SELECT id,item_id,sample_id,movement_id,sample_event_id,quantity,source_before,source_after,target_before,target_after,source_snapshot,target_snapshot FROM warehouse_sample_transfers LIMIT 0`;
    await tx`SELECT token_hash, account_id, csrf_token, expires_at FROM sessions LIMIT 0`;
    await tx`SELECT id,account_id,actor_id,before_value,after_value,created_at FROM account_access_events LIMIT 0`;
    await tx`SELECT actor_id,account_id,request_key,action,metadata_hash,reason,before_value,after_value,result FROM account_lifecycle_events LIMIT 0`;
    await tx`SELECT account_id,actor_id,reason,before_value,after_value FROM account_permission_events LIMIT 0`;
    await tx`SELECT owner_id,work_date,period_id,origin FROM attendance_daily_links LIMIT 0`;
    await tx`SELECT id,owner_id,member_id,leave_type,starts_at,ends_at,status,version,reviewed_at,withdrawn_at,revoked_at FROM leave_requests LIMIT 0`;
    await tx`SELECT leave_id,actor_id,actor_name,action,before_value,after_value FROM leave_events LIMIT 0`;
    await tx`SELECT actor_id,request_key,action,request_hash,result FROM leave_receipts LIMIT 0`;
    await tx`SELECT key, attempts, reset_at FROM login_limits LIMIT 0`;
    await tx`SELECT id, name, active, version, created_at, updated_at FROM stores LIMIT 0`;
    await tx`SELECT store_id, actor_id, action, before_value, after_value FROM store_events LIMIT 0`;
    const layout =
      await tx`SELECT singleton,version FROM material_folder_layout WHERE singleton`;
    if (layout.length !== 1)
      throw new Error('Material folder layout unavailable');
    await tx`SELECT store_id,position FROM material_folder_positions LIMIT 0`;
    await tx`SELECT actor_id,before_ids,after_ids FROM material_folder_events LIMIT 0`;
  });
  return {
    database: 'ready',
    migrations: 'ready',
    authentication: 'first-party',
  } as const;
}
