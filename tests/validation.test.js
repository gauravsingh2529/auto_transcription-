import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createBody,
  idParams,
  listQuery,
  updateBody,
} from '../src/validation/transcription.schema.js';

describe('validation schemas', () => {
  it('coerces and defaults list query params', () => {
    assert.deepEqual(listQuery.parse({ page: '2' }), { page: 2, pageSize: 10 });
  });

  it('caps pageSize at 100', () => {
    assert.equal(listQuery.safeParse({ pageSize: '500' }).success, false);
  });

  it('rejects non-numeric ids', () => {
    assert.equal(idParams.safeParse({ id: 'abc' }).success, false);
    assert.equal(idParams.parse({ id: '7' }).id, 7);
  });

  it('defaults source to manual and rejects unknown fields', () => {
    assert.equal(createBody.parse({ text: 'hi' }).source, 'manual');
    assert.equal(createBody.safeParse({ text: 'hi', id: 5 }).success, false);
  });

  it('rejects whitespace-only text', () => {
    assert.equal(createBody.safeParse({ text: '   ' }).success, false);
  });

  it('rejects an unknown source', () => {
    assert.equal(createBody.safeParse({ text: 'hi', source: 'evil' }).success, false);
  });

  it('requires at least one field on update', () => {
    assert.equal(updateBody.safeParse({}).success, false);
    assert.equal(updateBody.safeParse({ title: 'New' }).success, true);
  });
});
