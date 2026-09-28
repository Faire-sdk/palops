import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses untrusted input, turning schema failures into a 400 with a readable message. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.');
    throw badRequest(field ? `${field}: ${issue?.message}` : (issue?.message ?? 'Invalid input'), 'validation_error');
  }
  return result.data;
}
