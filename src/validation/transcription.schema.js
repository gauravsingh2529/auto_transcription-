import { z } from 'zod';

export const SOURCES = ['gemini-live', 'web-speech', 'manual'];

const title = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1, 'Text cannot be empty').max(50_000);
const language = z.string().trim().max(64);

export const idParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  source: z.enum(SOURCES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export const createBody = z.strictObject({
  title: title.optional(),
  text,
  language: language.optional(),
  source: z.enum(SOURCES).default('manual'),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
});

export const updateBody = z
  .strictObject({
    title: title.optional(),
    text: text.optional(),
    language: language.optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    message: 'Provide at least one of: title, text, language',
  });
