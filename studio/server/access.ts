import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Identity } from './auth';

const restricted = new Set([
  'finance',
  'payroll',
  'credentials',
  'roles',
  'settings',
  'accounts',
]);
const ordinary = new Set(['operations', 'knowledge']);
const surfaces = new Set([
  'api',
  'attachment',
  'export',
  'search',
  'statistics',
]);
export type AccessSurface =
  'api' | 'attachment' | 'export' | 'search' | 'statistics';
export type ServerResource = {
  id: string;
  classification: string;
  objectKey?: string;
};
export function requireContributor(identity: Identity | undefined) {
  if (!identity) throw new UnauthorizedException();
  if (!['admin', 'employee'].includes(identity.role))
    throw new ForbiddenException();
}

export function requireAdministrator(identity: Identity | undefined) {
  if (!identity) throw new UnauthorizedException();
  if (identity.role !== 'admin') throw new ForbiddenException();
}

// Infrastructure contract only: lookup and scope MUST come from trusted server
// metadata/policy, never request fields. No default scope, even for administrators.
export class ResourceGate {
  constructor(
    private readonly lookup: (id: string) => Promise<ServerResource | null>,
    private readonly scope: (
      identity: Identity,
      resource: ServerResource,
      surface: AccessSurface,
    ) => Promise<boolean>,
  ) {}
  async run<T>(
    identity: Identity | undefined,
    id: string,
    surface: AccessSurface,
    action: (resource: ServerResource) => Promise<T>,
  ): Promise<T> {
    if (!identity) throw new UnauthorizedException();
    if (
      !['admin', 'employee'].includes(identity.role) ||
      !surfaces.has(surface)
    )
      throw new ForbiddenException();
    const resource = await this.lookup(id);
    if (
      !resource ||
      resource.id !== id ||
      (!restricted.has(resource.classification) &&
        !ordinary.has(resource.classification))
    )
      throw new ForbiddenException();
    if (restricted.has(resource.classification)) requireAdministrator(identity);
    if ((await this.scope(identity, resource, surface)) !== true)
      throw new ForbiddenException();
    return action(resource);
  }
}
