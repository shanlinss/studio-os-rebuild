import { BadRequestException } from '@nestjs/common';
export function objectInput(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new BadRequestException();
  return value as Record<string, unknown>;
}
export function shortText(value: unknown, max = 100): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new BadRequestException();
  return value.trim();
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException();
  return value.toLowerCase();
}
export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new BadRequestException();
  return Number(value);
}
export function httpsUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048)
    throw new BadRequestException();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException();
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new BadRequestException();
  return url.toString();
}

export function longText(value: unknown, max = 2000): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    throw new BadRequestException();
  return value.trim();
}

export function webLink(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048)
    throw new BadRequestException();
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error();
    return url.toString();
  } catch {
    throw new BadRequestException();
  }
}

// Optional notes/row instructions accept a blank value without weakening required text.
export function optionalLongText(value: unknown, max = 2000): string {
  return value === undefined || (typeof value === 'string' && !value.trim())
    ? ''
    : longText(value, max);
}
