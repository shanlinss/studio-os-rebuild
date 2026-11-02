import { BadRequestException } from '@nestjs/common';
import { objectInput, longText } from './validation';
export function optionalLabText(value: unknown, max = 2000) {
  return value === undefined || value === null || value === ''
    ? ''
    : longText(value, max);
}
export function labInput(value: unknown) {
  const b = objectInput(value ?? {}, [
    'hypothesis',
    'direction',
    'product',
    'priority',
    'adjustment',
    'testVariable',
    'executionConditions',
    'plannedPublishOn',
  ]);
  if (b.priority !== undefined && typeof b.priority !== 'boolean')
    throw new BadRequestException();
  let date: string | null = null;
  if (
    b.plannedPublishOn !== undefined &&
    b.plannedPublishOn !== null &&
    b.plannedPublishOn !== ''
  ) {
    if (
      typeof b.plannedPublishOn !== 'string' ||
      !/^\d{4}-\d\d-\d\d$/.test(b.plannedPublishOn)
    )
      throw new BadRequestException();
    const parsed = new Date(b.plannedPublishOn + 'T00:00:00Z');
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== b.plannedPublishOn
    )
      throw new BadRequestException();
    date = b.plannedPublishOn;
  }
  return {
    ...(b.executionConditions !== undefined
      ? { executionConditions: optionalLabText(b.executionConditions) }
      : {}),
    hypothesis: optionalLabText(b.hypothesis),
    direction: optionalLabText(b.direction, 100),
    product: optionalLabText(b.product, 200),
    priority: b.priority === true,
    adjustment: optionalLabText(b.adjustment),
    testVariable: optionalLabText(b.testVariable, 200),
    plannedPublishOn: date,
  };
}
