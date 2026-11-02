import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { TransactionSql } from 'postgres';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { uuid } from './validation';
import { mediaFile } from './media';
import { productPlanWritable } from './workflow';
function contributor(identity: Identity) {
  if (!identity) throw new UnauthorizedException();
  if (!['admin', 'employee'].includes(identity.role))
    throw new ForbiddenException();
}
export class PublicationAssets {
  constructor(private readonly db: StudioDatabase) {}
  private async lock(
    tx: TransactionSql,
    identity: Identity,
    taskId: string,
    publicationId: string,
  ) {
    const [row] =
      await tx`SELECT n.id,p.id AS plan_id,p.experiment_id FROM studio_os.publications n JOIN studio_os.tasks t ON t.id=n.task_id JOIN studio_os.plans p ON p.id=t.plan_id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.id=${taskId} AND n.id=${publicationId} AND (${identity.role === 'admin'} OR (m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) FOR SHARE OF t,m,a FOR UPDATE OF n`;
    if (!row) throw new NotFoundException();
    await productPlanWritable(tx, String(row.plan_id));
    if (row.experiment_id) {
      const [experiment] =
        await tx`SELECT status FROM studio_os.lab_experiments WHERE id=${row.experiment_id} FOR SHARE`;
      if (experiment?.status === 'concluded') throw new ConflictException();
    }
  }
  async upload(
    identity: Identity,
    taskId: string,
    publicationId: string,
    bytes: unknown,
    name: unknown,
    mime: unknown,
  ) {
    contributor(identity);
    uuid(taskId);
    uuid(publicationId);
    const file = mediaFile(bytes, name, mime);
    return this.db.client.begin(async (tx) => {
      await this.lock(tx, identity, taskId, publicationId);
      const [usage] =
        await tx`SELECT count(*)::int AS n,coalesce(sum(octet_length(content)),0)::int AS size FROM studio_os.publication_assets WHERE publication_id=${publicationId}`;
      if (usage.n >= 20 || usage.size + file.content.length > 67108864)
        throw new ConflictException();
      const [asset] =
        await tx`INSERT INTO studio_os.publication_assets(publication_id,name,mime,content,created_by) VALUES(${publicationId},${file.name},${file.mime},${file.content},${identity.id}) RETURNING id,name,mime,octet_length(content) AS size`;
      await tx`INSERT INTO studio_os.publication_asset_events(publication_id,asset_id,actor_id,action) VALUES(${publicationId},${asset.id},${identity.id},'uploaded')`;
      return asset;
    });
  }
  async file(
    identity: Identity,
    taskId: string,
    publicationId: string,
    assetId: string,
  ) {
    contributor(identity);
    uuid(taskId);
    uuid(publicationId);
    uuid(assetId);
    const [file] = await this.db.client<
      { name: string; mime: string; content: Buffer }[]
    >`SELECT f.name,f.mime,f.content FROM studio_os.publication_assets f JOIN studio_os.publications n ON n.id=f.publication_id JOIN studio_os.tasks t ON t.id=n.task_id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE f.id=${assetId} AND n.id=${publicationId} AND t.id=${taskId} AND (${identity.role === 'admin'} OR (m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id))`;
    if (!file) throw new NotFoundException();
    return file;
  }
  async remove(
    identity: Identity,
    taskId: string,
    publicationId: string,
    assetId: string,
  ) {
    contributor(identity);
    uuid(taskId);
    uuid(publicationId);
    uuid(assetId);
    return this.db.client.begin(async (tx) => {
      await this.lock(tx, identity, taskId, publicationId);
      if (
        !(
          await tx`DELETE FROM studio_os.publication_assets WHERE id=${assetId} AND publication_id=${publicationId} RETURNING id`
        ).length
      )
        throw new NotFoundException();
      await tx`INSERT INTO studio_os.publication_asset_events(publication_id,asset_id,actor_id,action) VALUES(${publicationId},${assetId},${identity.id},'deleted')`;
      return { ok: true };
    });
  }
}
