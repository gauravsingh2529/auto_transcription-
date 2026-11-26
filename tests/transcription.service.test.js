import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { escapeLike } from '../src/repositories/transcription.repository.js';
import {
  createTranscriptionService,
  deriveTitle,
  normalizeText,
} from '../src/services/transcription.service.js';

/** In-memory stand-in for the PostgreSQL repository (same contract). */
function createFakeRepo() {
  let rows = [];
  let nextId = 1;
  return {
    async create(data) {
      const row = { id: nextId++, ...data, createdAt: new Date().toISOString() };
      rows.unshift(row);
      return row;
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async list({ q, limit, offset }) {
      const filtered = q ? rows.filter((r) => r.text.includes(q) || r.title.includes(q)) : rows;
      return { items: filtered.slice(offset, offset + limit), total: filtered.length };
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      return row;
    },
    async remove(id) {
      const before = rows.length;
      rows = rows.filter((r) => r.id !== id);
      return rows.length < before;
    },
    async ping() {},
  };
}

describe('text helpers', () => {
  it('normalizes whitespace from streaming deltas', () => {
    assert.equal(normalizeText('  aaj   ka\n meeting  '), 'aaj ka meeting');
  });

  it('derives a short title with ellipsis for long text', () => {
    assert.equal(deriveTitle('Hello world'), 'Hello world');
    assert.equal(
      deriveTitle('aaj ka meeting paanch baje hai please mujhe remind kar dena'),
      'aaj ka meeting paanch baje hai please mujhe…',
    );
  });

  it('handles Devanagari text', () => {
    assert.equal(deriveTitle('नमस्ते दुनिया'), 'नमस्ते दुनिया');
  });

  it('escapes LIKE wildcards so search is literal', () => {
    assert.equal(escapeLike('100%_done\\'), '100\\%\\_done\\\\');
  });
});

describe('TranscriptionService', () => {
  let service;
  beforeEach(() => {
    service = createTranscriptionService(createFakeRepo());
  });

  it('creates with a derived title and normalized text', async () => {
    const r = await service.create({ text: '  Kal   office jaana hai ', source: 'gemini-live' });
    assert.equal(r.text, 'Kal office jaana hai');
    assert.equal(r.title, 'Kal office jaana hai');
    assert.equal(r.source, 'gemini-live');
  });

  it('keeps an explicit title', async () => {
    const r = await service.create({ text: 'abc', title: ' My note ', source: 'manual' });
    assert.equal(r.title, 'My note');
  });

  it('paginates and reports totals', async () => {
    for (let i = 0; i < 25; i++) await service.create({ text: `note ${i}`, source: 'manual' });
    const res = await service.list({ page: 3, pageSize: 10 });
    assert.equal(res.items.length, 5);
    assert.deepEqual(res.pagination, { page: 3, pageSize: 10, total: 25, totalPages: 3 });
  });

  it('reports at least one page when empty', async () => {
    const res = await service.list({ page: 1, pageSize: 10 });
    assert.equal(res.pagination.totalPages, 1);
  });

  it('updates and normalizes text', async () => {
    const { id } = await service.create({ text: 'old', source: 'manual' });
    const r = await service.update(id, { text: ' new   text ' });
    assert.equal(r.text, 'new text');
  });

  it('throws 404 for missing records on get/update/remove', async () => {
    for (const call of [() => service.get(999), () => service.update(999, { title: 'x' }), () => service.remove(999)]) {
      await assert.rejects(call, (err) => err.status === 404);
    }
  });

  it('removes a record', async () => {
    const { id } = await service.create({ text: 'bye', source: 'manual' });
    await service.remove(id);
    await assert.rejects(() => service.get(id), (err) => err.status === 404);
  });
});
