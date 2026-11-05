-- Original knowledge records stay in place. Training order is metadata, never document content.
ALTER TABLE knowledge_assets ADD COLUMN sort_order integer CHECK(sort_order IS NULL OR sort_order>0);
CREATE INDEX knowledge_navigation_order ON knowledge_assets(entry_type,category,sort_order,title,id);
