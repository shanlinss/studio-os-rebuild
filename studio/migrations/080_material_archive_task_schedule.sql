ALTER TABLE materials ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN schedule_overridden boolean NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN planned_publish_on date;
ALTER TABLE tasks ADD COLUMN schedule_version integer NOT NULL DEFAULT 0 CHECK(schedule_version>=0);
CREATE TABLE material_archive_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),material_id uuid NOT NULL REFERENCES materials(id),version integer NOT NULL CHECK(version>0),archived boolean NOT NULL,
 material_version integer NOT NULL,material_snapshot jsonb NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(material_id,version)
);
CREATE TABLE task_schedule_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES tasks(id),version integer NOT NULL CHECK(version>0),planned_publish_on date,
 previous_on date,task_snapshot jsonb NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(task_id,version)
);
CREATE TABLE operational_change_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,kind text NOT NULL CHECK(kind IN('material-archive','task-schedule')),target_id uuid NOT NULL,
 request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['material_archive_versions','task_schedule_versions','operational_change_receipts'] LOOP
 EXECUTE format('CREATE TRIGGER operational_history_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history()',t);
END LOOP; END $$;
CREATE FUNCTION material_archive_edit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=studio_os,pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.archived OR EXISTS(SELECT 1 FROM material_archive_versions WHERE material_id=OLD.id) THEN RAISE EXCEPTION 'Archived material history must remain' USING ERRCODE='OPS01'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.archived AND NEW.archived AND (to_jsonb(OLD)-ARRAY['version','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['version','updated_at']) THEN
  RAISE EXCEPTION 'Restore archived material before editing' USING ERRCODE='OPS01';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER material_archive_edit BEFORE UPDATE OR DELETE ON materials FOR EACH ROW EXECUTE FUNCTION material_archive_edit_guard();
CREATE FUNCTION material_archive_reference_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=studio_os,pg_catalog AS $$
DECLARE j jsonb; oldj jsonb; mid uuid; field text; is_archived boolean; BEGIN
 j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;field:=TG_ARGV[0];
 IF TG_OP='UPDATE' AND (j->field IS NOT DISTINCT FROM to_jsonb(OLD)->field) AND (TG_TABLE_NAME<>'candidate_references' OR (j->'element_id' IS NOT DISTINCT FROM to_jsonb(OLD)->'element_id' AND j->'template_id' IS NOT DISTINCT FROM to_jsonb(OLD)->'template_id')) THEN RETURN NEW; END IF;
 mid:=(j->>field)::uuid;
 IF mid IS NULL AND TG_TABLE_NAME='candidate_references' THEN
  IF j->>'element_id' IS NOT NULL THEN SELECT material_id INTO mid FROM material_elements WHERE id=(j->>'element_id')::uuid;
  ELSIF j->>'template_id' IS NOT NULL THEN SELECT source_material_id INTO mid FROM note_templates WHERE id=(j->>'template_id')::uuid; END IF;
 END IF;
 IF mid IS NOT NULL THEN SELECT archived INTO is_archived FROM materials WHERE id=mid FOR SHARE;IF is_archived THEN RAISE EXCEPTION 'Restore material before adding or editing references' USING ERRCODE='OPS01'; END IF;END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER archived_material_assets BEFORE INSERT OR DELETE ON material_assets FOR EACH ROW EXECUTE FUNCTION material_archive_reference_guard('material_id');
CREATE TRIGGER archived_material_stores BEFORE INSERT OR DELETE ON material_stores FOR EACH ROW EXECUTE FUNCTION material_archive_reference_guard('material_id');
CREATE TRIGGER archived_plan_reference BEFORE INSERT ON plan_materials FOR EACH ROW EXECUTE FUNCTION material_archive_reference_guard('material_id');
CREATE TRIGGER archived_task_reference BEFORE INSERT ON task_materials FOR EACH ROW EXECUTE FUNCTION material_archive_reference_guard('material_id');
CREATE TRIGGER archived_template_reference BEFORE INSERT OR UPDATE ON note_templates FOR EACH ROW EXECUTE FUNCTION material_archive_reference_guard('source_material_id');
CREATE TRIGGER archived_template_task_reference BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION material_archive_reference_guard('template_material_id');
CREATE TRIGGER archived_shooting_reference BEFORE INSERT OR UPDATE ON shooting_items FOR EACH ROW EXECUTE FUNCTION material_archive_reference_guard('material_id');
CREATE TRIGGER archived_element_reference BEFORE INSERT OR UPDATE ON material_elements FOR EACH ROW EXECUTE FUNCTION material_archive_reference_guard('material_id');
CREATE TRIGGER archived_candidate_reference BEFORE INSERT OR UPDATE ON candidate_references FOR EACH ROW EXECUTE FUNCTION material_archive_reference_guard('material_id');
