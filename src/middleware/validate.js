import { badRequest } from '../utils/httpError.js';

/**
 * Validates req.params / req.query / req.body against zod schemas.
 * Parsed (coerced + defaulted) values land on req.valid, because Express 5
 * exposes req.query as a read-only getter.
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  for (const part of ['params', 'query', 'body']) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: [part, ...i.path].join('.'),
        message: i.message,
      }));
      return next(badRequest('Validation failed', details));
    }
    req.valid[part] = result.data;
  }
  next();
};
