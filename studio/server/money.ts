import { BadRequestException } from '@nestjs/common';
// Decimal strings cross the API boundary; integer cents are the stored fact.
export function optionalMoney(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value))
    throw new BadRequestException();
  const [whole, fraction = ''] = value.split('.'),
    cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 2147483647)
    throw new BadRequestException();
  return cents;
}
export function moneyText(cents: number | null): string | null {
  return cents === null
    ? null
    : Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
}
