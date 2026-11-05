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
    await tx`SELECT account_id, device_id FROM business_account_extra_devices LIMIT 0`;
    await tx`SELECT id, name, profile_url, bound_phone, actual_phone, remark, responsible_member_id, active, version, platform, platform_account_id, avatar_url, purpose, store_id, primary_device_id FROM business_accounts LIMIT 0`;
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
    await tx`SELECT product_id,code,version FROM commercial_products LIMIT 0`;
    await tx`SELECT id,product_id,code,specification,unit,active,warehouse_item_id FROM product_skus LIMIT 0`;
    await tx`SELECT id,operation,business_date,source_reference,reason,actor_id,source_shipment_id,resellable_confirmed FROM product_stock_documents LIMIT 0`;
    await tx`SELECT document_id,sku_id,store_id FROM dropship_business_references LIMIT 0`;
    await tx`SELECT id,document_id,version,status,business_date,source_reference,lines,actor_id FROM product_stock_correction_versions LIMIT 0`;
    await tx`SELECT movement_id,version_id,source_movement_id FROM product_stock_correction_adjustments LIMIT 0`;
    await tx`SELECT actor_id,request_key,document_id,operation,request_hash,result FROM product_stock_correction_receipts LIMIT 0`;
    await tx`SELECT id,status,correction_version FROM product_stock_effective_documents LIMIT 0`;
    await tx`SELECT id,quantity,delta,cost_excluded FROM product_stock_cost_movements LIMIT 0`;
    await tx`SELECT stock_correction_version FROM product_purchase_versions LIMIT 0`;
    await tx`SELECT document_id,cost_version,business_date,supplier,source_reference,lines,actor_id FROM dropship_business_versions LIMIT 0`;
    await tx`SELECT id,business_date,supplier,source_reference FROM dropship_effective_documents LIMIT 0`;
    await tx`SELECT id,sku_id,store_id,quantity,snapshot FROM dropship_effective_lines LIMIT 0`;
    await tx`SELECT status FROM dropship_cost_versions LIMIT 0`;
    await tx`SELECT status FROM dropship_refund_versions LIMIT 0`;
    await tx`SELECT replaces_refund_id FROM dropship_refunds LIMIT 0`;
    await tx`SELECT original_document_id,document_id,actor_id FROM dropship_document_replacements LIMIT 0`;
    await tx`SELECT id,direction,account_label,source_reference,created_by FROM cash_movement_records LIMIT 0`;
    await tx`SELECT id,record_id,version,paid_date,amount_cents,description,lines,status,reason,actor_id FROM cash_movement_versions LIMIT 0`;
    await tx`SELECT record_id,source_key,expense_id,store_id,month FROM cash_source_references LIMIT 0`;
    await tx`SELECT actor_id,request_key,operation,target_id,request_hash,result FROM cash_movement_receipts LIMIT 0`;
    await tx`SELECT id,event_id,version,mode,amount_cents,scope,store_id,loss_kind,expense_id,expense_snapshot,source_reference,reason,event_snapshot,actor_id,actor_name FROM sample_cost_evidence_versions LIMIT 0`;
    await tx`SELECT expense_id,event_id FROM sample_cost_expense_links LIMIT 0`;
    await tx`SELECT actor_id,request_key,event_id,request_hash,result FROM sample_cost_evidence_receipts LIMIT 0`;
    await tx`SELECT id,movement_id,version,mode,amount_cents,scope,store_id,expense_id,expense_snapshot,source_reference,reason,movement_snapshot,actor_id,actor_name FROM inventory_cost_evidence_versions LIMIT 0`;
    await tx`SELECT expense_id,movement_id FROM inventory_cost_expense_links LIMIT 0`;
    await tx`SELECT actor_id,request_key,movement_id,request_hash,result FROM inventory_cost_evidence_receipts LIMIT 0`;
    await tx`SELECT id,store_id,month,version,amount_cents,source_reference,reason,status,actor_id,actor_name FROM store_month_income_versions LIMIT 0`;
    await tx`SELECT actor_id,request_key,store_id,month,request_hash,result FROM store_month_income_receipts LIMIT 0`;
    await tx`SELECT id,expense_scope,expense_use,store_id FROM expense_records LIMIT 0`;
    await tx`SELECT actor_id,request_key,expense_id,request_hash,result FROM expense_attribution_receipts LIMIT 0`;
    await tx`SELECT id,kind,store_id,parent_id,expense_id,source_reference,actor_id FROM operating_finance_records LIMIT 0`;
    await tx`SELECT id,record_id,version,business_date,amount_cents,description,note,reason,status,parent_snapshot,expense_snapshot,actor_id,actor_name FROM operating_finance_versions LIMIT 0`;
    await tx`SELECT actor_id,request_key,operation,target_id,request_hash,result FROM operating_finance_receipts LIMIT 0`;
    await tx`SELECT id,sku_id,version,effective_month,unit_cents,fulfillment_mode,source_reference,reason,actor_id,actor_name FROM product_reference_costs LIMIT 0`;
    await tx`SELECT actor_id,request_key,sku_id,request_hash,result FROM product_reference_receipts LIMIT 0`;
    await tx`SELECT id,code,business_date,supplier,source_reference,actor_id FROM dropship_cost_documents LIMIT 0`;
    await tx`SELECT id,document_id,position,sku_id,store_id,quantity,snapshot FROM dropship_cost_lines LIMIT 0`;
    await tx`SELECT id,document_id,version,lines,reason,actor_id,actor_name FROM dropship_cost_versions LIMIT 0`;
    await tx`SELECT id,line_id,quantity,business_date,source_reference FROM dropship_refunds LIMIT 0`;
    await tx`SELECT id,refund_id,version,amount_cents,reason,actor_id,actor_name FROM dropship_refund_versions LIMIT 0`;
    await tx`SELECT actor_id,request_key,operation,target_id,request_hash,result FROM dropship_cost_receipts LIMIT 0`;
    await tx`SELECT id,item_id,version,total_cents,source_reference,reason,actor_id,actor_name FROM product_opening_cost_versions LIMIT 0`;
    await tx`SELECT version_id,movement_id,quantity,total_cents,item_snapshot FROM product_opening_cost_lines LIMIT 0`;
    await tx`SELECT actor_id,request_key,sku_id,request_hash,result FROM product_opening_cost_receipts LIMIT 0`;
    await tx`SELECT id,inbound_document_id,code FROM product_purchase_batches LIMIT 0`;
    await tx`SELECT id,batch_id,version,purchase_date,supplier,goods_cents,additional_cents,total_cents,expense_id,expense_snapshot,reason,actor_id,actor_name FROM product_purchase_versions LIMIT 0`;
    await tx`SELECT version_id,movement_id,quantity,unit_cents,goods_cents,additional_cents,total_cents,item_snapshot FROM product_purchase_lines LIMIT 0`;
    await tx`SELECT expense_id,batch_id FROM product_purchase_expenses LIMIT 0`;
    await tx`SELECT actor_id,request_key,inbound_document_id,request_hash,result FROM product_purchase_receipts LIMIT 0`;
    await tx`SELECT return_movement_id,shipment_movement_id FROM product_stock_returns LIMIT 0`;
    await tx`SELECT sku_id,store_id,platform_product_id,platform_sku_id,listing_url,active FROM product_sku_stores LIMIT 0`;
    await tx`SELECT product_id,actor_id,reason,before_value,after_value FROM commercial_product_events LIMIT 0`;
    await tx`SELECT actor_id,request_key,product_id,request_hash,result FROM commercial_product_receipts LIMIT 0`;
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
    await tx`SELECT device_type,brand,serial_number,image_id FROM equipment_assets LIMIT 0`;
    await tx`SELECT id,equipment_id,name,mime,content,digest FROM equipment_images LIMIT 0`;
    await tx`SELECT id,equipment_id,previous_loan_id,new_loan_id,from_member_id,to_member_id,occurred_at,condition,note,actor_name FROM equipment_handovers LIMIT 0`;
    await tx`SELECT id,equipment_id,version,purchase_date,amount_cents,supplier,expense_id,expense_snapshot,equipment_snapshot,reason,actor_id,actor_name FROM equipment_purchase_versions LIMIT 0`;
    await tx`SELECT actor_id,request_key,equipment_id,request_hash,result FROM equipment_purchase_receipts LIMIT 0`;
    await tx`SELECT id,card_code,phone_number,carrier,status,user_member_id,device_id,store_id,plan_description,plan_expires_on,notes,version FROM phone_cards LIMIT 0`;
    await tx`SELECT card_id,account_id FROM phone_card_accounts LIMIT 0`;
    await tx`SELECT card_id,actor_id,actor_name,reason,before_value,after_value FROM phone_card_events LIMIT 0`;
    await tx`SELECT card_id,version,registered_entity,card_snapshot,actor_name,reason FROM phone_card_identities LIMIT 0`;
    await tx`SELECT actor_id,request_key,action,request_hash,result FROM phone_card_receipts LIMIT 0`;
    await tx`SELECT id,card_id,created_by FROM phone_card_recharges LIMIT 0`;
    await tx`SELECT id,recharge_id,card_id,version,previous_id,status,recharge_date,amount_cents,handler_name,payer_name,store_id,expense_id,expense_snapshot,card_snapshot FROM phone_card_recharge_versions LIMIT 0`;
    await tx`SELECT id,card_id,version,amount_cents,observed_at,card_snapshot,note FROM phone_card_balances LIMIT 0`;
    await tx`SELECT id,card_id,version,next_recharge_on,card_snapshot,note FROM phone_card_reminder_versions LIMIT 0`;
    await tx`SELECT actor_id,request_key,action,request_hash,result FROM phone_card_operation_receipts LIMIT 0`;
    await tx`SELECT id,item_code,kind,product_id,unit,opening_confirmed,quantity,version FROM warehouse_items LIMIT 0`;
    await tx`SELECT id,item_id,store_id,quantity,version,reorder_threshold FROM packaging_balances LIMIT 0`;
    await tx`SELECT balance_id,item_id,item_code,name,unit,store_id,store_name,quantity,reorder_threshold FROM packaging_reorder_alerts LIMIT 0`;
    await tx`SELECT id,item_id,purchase_date,supplier,quantity,unit_cents,total_cents,expense_id,expense_snapshot,reason,actor_id FROM packaging_purchases LIMIT 0`;
    await tx`SELECT id,actor_id,reason,created_at FROM packaging_consumptions LIMIT 0`;
    await tx`SELECT id,item_id,source_balance_id,target_balance_id,outbound_movement_id,inbound_movement_id,quantity,reason,actor_id FROM packaging_stock_transfers LIMIT 0`;
    await tx`SELECT purchase_id,balance_id,movement_id FROM packaging_purchase_allocations LIMIT 0`;
    await tx`SELECT id,item_id,type,quantity,delta,before_quantity,after_quantity,item_snapshot,corrects_movement_id,packaging_balance_id,packaging_consumption_id,used_store_id,product_stock_document_id,business_store_id FROM warehouse_movements LIMIT 0`;
    await tx`SELECT id,item_id,actor_id,action,before_value,after_value FROM warehouse_item_events LIMIT 0`;
    await tx`SELECT actor_id,request_key,request_hash,result FROM warehouse_receipts LIMIT 0`;
    await tx`SELECT sample_id,item_id,product_id,specification,source_unit,confirmed_by FROM warehouse_sample_links LIMIT 0`;
    await tx`SELECT id,item_id,sample_id,movement_id,sample_event_id,quantity,source_before,source_after,target_before,target_after,source_snapshot,target_snapshot FROM warehouse_sample_transfers LIMIT 0`;
    await tx`SELECT token_hash, account_id, csrf_token, expires_at FROM sessions LIMIT 0`;
    await tx`SELECT id,account_id,actor_id,before_value,after_value,created_at FROM account_access_events LIMIT 0`;
    await tx`SELECT actor_id,account_id,request_key,action,metadata_hash,reason,before_value,after_value,result FROM account_lifecycle_events LIMIT 0`;
    await tx`SELECT account_id,actor_id,reason,before_value,after_value FROM account_permission_events LIMIT 0`;
    await tx`SELECT account_id,store_id,scope_key,can_move FROM inventory_access_grants LIMIT 0`;
    await tx`SELECT id,account_id,actor_id,actor_name,reason,before_value,after_value FROM inventory_access_events LIMIT 0`;
    await tx`SELECT actor_id,request_key,account_id,request_hash,result FROM inventory_access_receipts LIMIT 0`;
    await tx`SELECT owner_id,work_date,period_id,origin FROM attendance_daily_links LIMIT 0`;
    await tx`SELECT id,owner_id,member_id,leave_type,starts_at,ends_at,status,version,reviewed_at,withdrawn_at,revoked_at FROM leave_requests LIMIT 0`;
    await tx`SELECT leave_id,actor_id,actor_name,action,before_value,after_value FROM leave_events LIMIT 0`;
    await tx`SELECT actor_id,request_key,action,request_hash,result FROM leave_receipts LIMIT 0`;
    await tx`SELECT period_id,owner_id,kind,outcome,note,period_version,revision,previous_review_id,source_snapshot,actor_id FROM attendance_exception_reviews LIMIT 0`;
    await tx`SELECT actor_id,request_key,request_hash,result FROM attendance_exception_receipts LIMIT 0`;
    await tx`SELECT work_date,mode,note,version,updated_at FROM attendance_calendar LIMIT 0`;
    await tx`SELECT work_date,actor_id,actor_name,before_value,after_value,created_at FROM attendance_calendar_events LIMIT 0`;
    await tx`SELECT actor_id,request_key,request_hash,result FROM attendance_calendar_receipts LIMIT 0`;
    await tx`SELECT id,member_id,owner_id,month,revision,previous_id,action,source_hash,snapshot,day_notes,note,actor_id,actor_name,created_at FROM attendance_month_closures LIMIT 0`;
    await tx`SELECT actor_id,request_key,request_hash,result FROM attendance_month_closure_receipts LIMIT 0`;
    await tx`SELECT id,member_id,effective_month,revision,amount_cents,note,actor_id FROM salary_versions LIMIT 0`;
    await tx`SELECT id,member_id,month,revision,previous_id,closure_id,salary_id,attendance_hash,base_cents,bonus_cents,allowance_cents,adjustment_cents,total_cents,note FROM payroll_drafts LIMIT 0`;
    await tx`SELECT actor_id,request_key,request_hash,result FROM payroll_receipts LIMIT 0`;
    await tx`SELECT member_id,month,revision FROM payroll_month_heads LIMIT 0`;
    await tx`SELECT id,member_id,month,revision,previous_id,action,draft_id,snapshot,note,actor_id FROM payroll_confirmations LIMIT 0`;
    await tx`SELECT actor_id,request_key,request_hash,result FROM payroll_confirmation_receipts LIMIT 0`;
    await tx`SELECT id,actor_id,request_key,request_hash,month,payload,file_hash FROM payroll_exports LIMIT 0`;
    await tx`SELECT end_date FROM members LIMIT 0`;
    await tx`SELECT actor_id,request_key,request_hash,result FROM employment_date_receipts LIMIT 0`;
    await tx`SELECT id,member_id,month,revision,source_hash,source_snapshot,note,actor_id FROM admin_payroll_reviews LIMIT 0`;
    await tx`SELECT actor_id,request_key,request_hash,result FROM admin_payroll_review_receipts LIMIT 0`;
    await tx`SELECT basis_kind,admin_review_id FROM payroll_drafts LIMIT 0`;
    await tx`SELECT key, attempts, reset_at FROM login_limits LIMIT 0`;
    await tx`SELECT id, name, active, version, created_at, updated_at FROM stores LIMIT 0`;
    await tx`SELECT store_id, actor_id, action, before_value, after_value FROM store_events LIMIT 0`;
    await tx`SELECT id,month,version,reason,actor_id,actor_name FROM finance_month_scope_versions LIMIT 0`;
    await tx`SELECT version_id,store_id,store_name FROM finance_month_scope_stores LIMIT 0`;
    await tx`SELECT actor_id,request_key,month,request_hash,result FROM finance_month_scope_receipts LIMIT 0`;
    await tx`SELECT id,month,version,action,source_hash,snapshot FROM finance_month_closures LIMIT 0`;
    await tx`SELECT actor_id,request_key,month,action,request_hash,result FROM finance_month_closure_receipts LIMIT 0`;
    await tx`SELECT equipment_id,version,scope,store_id,store_name FROM equipment_store_versions LIMIT 0`;
    await tx`SELECT handover_id,account_id,decision,before_value,after_value FROM equipment_handover_account_reviews LIMIT 0`;
    await tx`SELECT card_id,version,plan_name,fixed_cents,cycle,billing_day,effective_on FROM phone_card_plan_versions LIMIT 0`;
    await tx`SELECT actor_id,request_key,kind,target_id,request_hash,result FROM resource_profile_receipts LIMIT 0`;
    await tx`SELECT archived FROM materials LIMIT 0`;
    await tx`SELECT schedule_version,schedule_overridden,planned_publish_on FROM tasks LIMIT 0`;
    await tx`SELECT material_id,version,material_version,archived FROM material_archive_versions LIMIT 0`;
    await tx`SELECT task_id,version,planned_publish_on,task_snapshot FROM task_schedule_versions LIMIT 0`;
    await tx`SELECT actor_id,request_key,kind,target_id,request_hash,result FROM operational_change_receipts LIMIT 0`;
    await tx`SELECT sort_order FROM knowledge_assets LIMIT 0`;
    await tx`SELECT archived FROM title_batches LIMIT 0`;
    await tx`SELECT archived FROM toolbox_links LIMIT 0`;
    await tx`SELECT kind,target_id,action,before_value,after_value FROM library_maintenance_events LIMIT 0`;
    await tx`SELECT actor_id,request_key,kind,target_id,request_hash,result FROM library_maintenance_receipts LIMIT 0`;
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
