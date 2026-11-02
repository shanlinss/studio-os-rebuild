import { ConflictException, NotFoundException } from '@nestjs/common';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator, requireContributor } from './access';
import {
  objectInput,
  uuid,
  shortText,
  longText,
  version,
  webLink,
} from './validation';
export class Toolbox {
  constructor(private readonly db: StudioDatabase) {}
  list(identity: Identity) {
    requireContributor(identity);
    return this.db
      .client`SELECT id,name,url,category,description,version,created_at AS "createdAt",updated_at AS "updatedAt" FROM studio_os.toolbox_links ORDER BY updated_at DESC,id`;
  }
  async save(identity: Identity, value: unknown, id?: string) {
    requireAdministrator(identity);
    if (id) uuid(id);
    const b = objectInput(
      value,
      id
        ? ['name', 'url', 'category', 'description', 'expectedVersion']
        : ['name', 'url', 'category', 'description'],
    );
    const name = shortText(b.name, 100),
      url = webLink(b.url),
      category = b.category ? shortText(b.category, 60) : '',
      description = b.description ? longText(b.description) : '';
    return this.db.client.begin(async (tx) => {
      let old, row;
      if (id) {
        [old] =
          await tx`SELECT id,name,url,category,description,version FROM studio_os.toolbox_links WHERE id=${id} FOR UPDATE`;
        if (!old) throw new NotFoundException();
        if (old.version !== version(b.expectedVersion))
          throw new ConflictException();
        [row] =
          await tx`UPDATE studio_os.toolbox_links SET name=${name},url=${url},category=${category},description=${description},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,name,url,category,description,version`;
      } else
        [row] =
          await tx`INSERT INTO studio_os.toolbox_links(name,url,category,description) VALUES(${name},${url},${category},${description}) RETURNING id,name,url,category,description,version`;
      await tx`INSERT INTO studio_os.toolbox_events(link_id,actor_id,action,before_value,after_value) VALUES(${row.id},${identity.id},${id ? 'updated' : 'created'},${old ? JSON.stringify(old) : null}::jsonb,${JSON.stringify(row)}::jsonb)`;
      return row;
    });
  }
  async remove(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, ['expectedVersion']),
      v = version(b.expectedVersion);
    return this.db.client.begin(async (tx) => {
      const [old] =
        await tx`SELECT id,name,url,category,description,version FROM studio_os.toolbox_links WHERE id=${id} FOR UPDATE`;
      if (!old) throw new NotFoundException();
      if (old.version !== v) throw new ConflictException();
      await tx`DELETE FROM studio_os.toolbox_links WHERE id=${id}`;
      await tx`INSERT INTO studio_os.toolbox_events(link_id,actor_id,action,before_value) VALUES(${id},${identity.id},'deleted',${JSON.stringify(old)}::jsonb)`;
      return { ok: true };
    });
  }
}
