import { notFound } from '../utils/httpError.js';

const TITLE_WORDS = 8;
const TITLE_MAX = 80;

/** Collapses whitespace introduced by streaming deltas ("  hello   world ") -> "hello world". */
export const normalizeText = (text) => text.replace(/\s+/g, ' ').trim();

/** Builds a readable default title from the first few words of the transcript. */
export function deriveTitle(text) {
  const clean = normalizeText(text);
  let candidate = clean.split(' ').slice(0, TITLE_WORDS).join(' ');
  if (candidate.length > TITLE_MAX) candidate = candidate.slice(0, TITLE_MAX).trimEnd();
  return candidate.length < clean.length ? `${candidate}…` : candidate;
}

/**
 * Business layer. Receives the repository by injection so it can be unit-tested
 * with an in-memory fake (see tests/).
 */
export function createTranscriptionService(repo) {
  return {
    async create(input) {
      const text = normalizeText(input.text);
      return repo.create({
        ...input,
        text,
        title: input.title?.trim() || deriveTitle(text),
      });
    },

    async get(id) {
      const record = await repo.findById(id);
      if (!record) throw notFound(`Transcription ${id} not found`);
      return record;
    },

    async list({ q, source, page, pageSize }) {
      const { items, total } = await repo.list({
        q: q || undefined,
        source,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return {
        items,
        pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      };
    },

    async update(id, patch) {
      const clean = { ...patch };
      if (clean.text !== undefined) clean.text = normalizeText(clean.text);
      const record = await repo.update(id, clean);
      if (!record) throw notFound(`Transcription ${id} not found`);
      return record;
    },

    async remove(id) {
      const removed = await repo.remove(id);
      if (!removed) throw notFound(`Transcription ${id} not found`);
    },

    async health() {
      await repo.ping();
    },
  };
}
