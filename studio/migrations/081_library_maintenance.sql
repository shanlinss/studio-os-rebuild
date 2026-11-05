ALTER TABLE title_batches ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE toolbox_links ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE title_events DROP CONSTRAINT title_events_action_check;
ALTER TABLE title_events ADD CONSTRAINT title_events_action_check CHECK(action IN('created','renamed','appended','edited','removed','deleted','copied','archived','restored'));
CREATE TABLE library_maintenance_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN('template','titles','tool')),target_id uuid NOT NULL,action text NOT NULL,
 before_value jsonb,after_value jsonb NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX library_maintenance_history ON library_maintenance_events(kind,target_id,created_at DESC,id);
CREATE TABLE library_maintenance_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,kind text NOT NULL,target_id uuid,request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER library_events_append_only BEFORE UPDATE OR DELETE ON library_maintenance_events FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER library_receipts_append_only BEFORE UPDATE OR DELETE ON library_maintenance_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE FUNCTION library_archived_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=studio_os,pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN IF OLD.archived THEN RAISE EXCEPTION 'Restore before changing library data' USING ERRCODE='OPS01';END IF;RETURN OLD;END IF;
 IF OLD.archived AND NEW.archived AND (to_jsonb(OLD)-ARRAY['version','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['version','updated_at']) THEN RAISE EXCEPTION 'Restore before changing library data' USING ERRCODE='OPS01';END IF;RETURN NEW;
END $$;
CREATE TRIGGER archived_template_edit BEFORE UPDATE OR DELETE ON note_templates FOR EACH ROW EXECUTE FUNCTION library_archived_guard();
CREATE TRIGGER archived_title_batch_edit BEFORE UPDATE OR DELETE ON title_batches FOR EACH ROW EXECUTE FUNCTION library_archived_guard();
CREATE TRIGGER archived_tool_edit BEFORE UPDATE OR DELETE ON toolbox_links FOR EACH ROW EXECUTE FUNCTION library_archived_guard();
CREATE FUNCTION library_archived_child_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=studio_os,pg_catalog AS $$ DECLARE j jsonb; state boolean; BEGIN
 j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 EXECUTE format('SELECT archived FROM %I WHERE id=$1 FOR SHARE',TG_ARGV[0]) INTO state USING (j->>TG_ARGV[1])::uuid;
 IF state THEN RAISE EXCEPTION 'Restore before changing archived library entries' USING ERRCODE='OPS01';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER archived_title_entries BEFORE INSERT OR UPDATE OR DELETE ON title_entries FOR EACH ROW EXECUTE FUNCTION library_archived_child_guard('title_batches','batch_id');
CREATE TRIGGER archived_template_assets BEFORE INSERT OR DELETE ON template_assets FOR EACH ROW EXECUTE FUNCTION library_archived_child_guard('note_templates','template_id');
