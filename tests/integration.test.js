// Boots the real Express app + WebSocket gateway on an ephemeral port, with an
// in-memory repository and a fake STT provider: no database or API key needed.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { createTranscriptionService } from '../src/services/transcription.service.js';
import { attachTranscriptionGateway } from '../src/ws/transcription.gateway.js';

function createMemoryRepo() {
  const rows = new Map();
  let id = 0;
  return {
    async create(d) {
      const r = { id: ++id, language: null, durationMs: null, ...d, createdAt: new Date().toISOString() };
      rows.set(r.id, r);
      return r;
    },
    async findById(i) { return rows.get(i) ?? null; },
    async list({ limit, offset, q }) {
      const all = [...rows.values()].reverse().filter((r) => !q || r.text.includes(q));
      return { items: all.slice(offset, offset + limit), total: all.length };
    },
    async update(i, p) {
      const r = rows.get(i);
      if (!r) return null;
      for (const [k, v] of Object.entries(p)) if (v !== undefined) r[k] = v;
      return r;
    },
    async remove(i) { return rows.delete(i); },
    async ping() {},
  };
}

/** Emits one transcript delta per audio frame received. */
class FakeStt extends EventEmitter {
  name = 'gemini-live';
  words = ['Aaj ', 'ka ', 'meeting ', 'paanch ', 'baje ', 'hai'];
  async connect() {}
  sendAudio() {
    const w = this.words.shift();
    if (w) this.emit('transcript', { text: w, languageCode: 'hi-IN' });
  }
  async finish() {}
  close() {}
}

let server;
let wss;
let base;
let wsUrl;

before(async () => {
  const service = createTranscriptionService(createMemoryRepo());
  server = http.createServer(createApp({ service }));
  wss = attachTranscriptionGateway(server, { service, createStt: () => new FakeStt() });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws/transcribe`;
});

after(() => new Promise((r) => {
  for (const c of wss.clients) c.terminate();
  wss.close();
  server.closeAllConnections();
  server.close(r);
}));

const json = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

describe('REST CRUD', () => {
  it('create -> read -> update -> list -> delete', async () => {
    const created = await json('POST', '/api/transcriptions', { text: 'Hello duniya, kaise ho?' });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, 'Hello duniya, kaise ho?');

    const id = created.body.id;
    assert.equal((await json('GET', `/api/transcriptions/${id}`)).body.text, 'Hello duniya, kaise ho?');

    const updated = await json('PATCH', `/api/transcriptions/${id}`, { title: 'Greeting' });
    assert.equal(updated.body.title, 'Greeting');

    const list = await json('GET', '/api/transcriptions?q=duniya');
    assert.equal(list.body.pagination.total, 1);

    assert.equal((await json('DELETE', `/api/transcriptions/${id}`)).status, 204);
    assert.equal((await json('GET', `/api/transcriptions/${id}`)).status, 404);
  });

  it('returns 400 with field details on invalid input', async () => {
    const res = await json('POST', '/api/transcriptions', { text: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'body.text');
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await fetch(`${base}/api/transcriptions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
    });
    assert.equal(res.status, 400);
  });

  it('returns 404 JSON for unknown API routes', async () => {
    assert.equal((await json('GET', '/api/nope')).status, 404);
  });

  it('serves the dashboard', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Speech to Text/);
  });
});

describe('WebSocket live transcription', () => {
  it('streams transcript deltas and persists the session on stop', async () => {
    const ws = new WebSocket(wsUrl);
    const messages = [];
    const done = new Promise((resolve, reject) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        messages.push(msg);
        if (msg.type === 'started') {
          // 6 x 100 ms frames of silence (PCM16 @ 16 kHz)
          for (let i = 0; i < 6; i++) ws.send(Buffer.alloc(3200));
          setTimeout(() => ws.send(JSON.stringify({ type: 'stop' })), 50);
        }
        if (msg.type === 'stopped') resolve();
        if (msg.type === 'error') reject(new Error(msg.message));
      });
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'start' })));
    await done;
    ws.close();

    const text = messages.filter((m) => m.type === 'transcript').map((m) => m.text).join('');
    assert.equal(text, 'Aaj ka meeting paanch baje hai');

    const saved = messages.find((m) => m.type === 'saved');
    assert.ok(saved, 'expected a saved message');
    assert.equal(saved.record.source, 'gemini-live');
    assert.equal(saved.record.language, 'hi-IN');

    const fromApi = await json('GET', `/api/transcriptions/${saved.record.id}`);
    assert.equal(fromApi.body.text, 'Aaj ka meeting paanch baje hai');
  });

  it('rejects unknown control messages', async () => {
    const ws = new WebSocket(wsUrl);
    const msg = await new Promise((resolve) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hack' })));
      ws.on('message', (raw) => resolve(JSON.parse(raw.toString())));
    });
    ws.close();
    assert.equal(msg.type, 'error');
  });
});
