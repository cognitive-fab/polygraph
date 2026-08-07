#!/usr/bin/env node
// TODO app server — the "shell" the README promises: routes that translate
// HTTP into dispatches, plus presentation-only data (titles, reminders,
// triage suggestions) that never influences a transition and therefore
// lives OUTSIDE the machine, in a plain JSON file.
//
// Usage: node examples/todo-machine/bin/todo-server.mjs [--port 7090]
//
//   http://127.0.0.1:7090/todo   → the TODO app
//   http://127.0.0.1:7090/       → the polyrun read-only ops console
//   everything else              → the polyrun JSON facade
'use strict';

import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../../../polyrun/src/index.mjs';
import { createHttpServer } from '../../../polyrun/src/http.mjs';
import { loadConfig } from '../../../polyrun/src/config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = join(here, '..', 'demo', '.demo-state');
mkdirSync(stateDir, { recursive: true });
const appStorePath = join(stateDir, 'app.json');

// ---- app-side store: presentation data only ---------------------------------

const appStore = existsSync(appStorePath)
  ? JSON.parse(readFileSync(appStorePath, 'utf8'))
  : { titles: {}, reminders: {}, suggestions: {} };
const saveApp = () => writeFileSync(appStorePath, JSON.stringify(appStore, null, 2));

// ---- runtime: config's machine, this server's handlers ----------------------

const config = await loadConfig(join(here, '..', 'polyrun.config.mjs'));
config.handlers = {
  // Deterministic edge: deliver the reminder (here: record it for the UI).
  // Redelivery after a crash retries under the same idempotency key, so the
  // keyed write makes duplicates harmless.
  notifyUser: async (p, idemKey, ctx) => {
    const seen = (appStore.reminders[ctx.instanceId] ??= []);
    if (!seen.includes(idemKey)) { seen.push(idemKey); saveApp(); }
    return { delivered: true };
  },
  // The fuzzy middle: one model call would go here. Deterministic stand-in:
  // suggest DROP after a spent budget. The suggestion is presentation data —
  // it goes to the UI, and a human clicks the ordinary COMPLETE/DROP.
  suggestTriage: async (p, idemKey, ctx) => {
    appStore.suggestions[ctx.instanceId] =
      { suggestion: 'drop', why: `snoozed ${p.snoozeCount}× and still not done` };
    saveApp();
    return appStore.suggestions[ctx.instanceId];
  },
};
const rt = await createRuntime(config);
rt.startWorkers(config.poll ?? {});

const facade = createHttpServer(rt);
const facadeListener = facade.listeners('request')[0];
const page = readFileSync(join(here, '..', 'web', 'todo.html'), 'utf8');

const json = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
};
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
    catch { reject(new Error('invalid JSON body')); }
  });
  req.on('error', reject);
});

const args = process.argv.slice(2);
const flagIdx = args.indexOf('--port');
const port = Number(flagIdx >= 0 ? args[flagIdx + 1] : 7090);

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && path === '/todo') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page);
    }

    // Create: the ONLY app route with logic, and the logic is bookkeeping —
    // remember the title, create the instance, optionally set the due date.
    if (req.method === 'POST' && path === '/app/todos') {
      const body = await readBody(req);
      const title = String(body.title ?? '').trim();
      if (!title) return json(res, 400, { error: 'title is required' });
      const instanceId = `todo-${randomUUID().slice(0, 8)}`;
      await rt.create('todo', instanceId);
      appStore.titles[instanceId] = title;
      saveApp();
      if (typeof body.dueAt === 'string' && body.dueAt !== '') {
        await rt.dispatch(instanceId, 'SET_DUE', { dueAt: body.dueAt }, `set-due:create`);
      }
      return json(res, 201, { instanceId });
    }

    // List: machine snapshots joined with presentation data.
    if (req.method === 'GET' && path === '/app/todos') {
      const rows = await rt.list('todo');
      const out = [];
      for (const r of rows) {
        const id = r.instance_id;
        out.push({
          instanceId: id,
          title: appStore.titles[id] ?? id,
          status: r.status,
          seq: r.seq,
          state: r.state,
          reminders: (appStore.reminders[id] ?? []).length,
          suggestion: r.state.todoState === 'needsTriage' ? (appStore.suggestions[id] ?? null) : null,
        });
      }
      out.sort((a, b) => (a.status === b.status ? a.instanceId.localeCompare(b.instanceId) : a.status === 'active' ? -1 : 1));
      return json(res, 200, out);
    }

    return facadeListener(req, res);
  } catch (err) {
    return json(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[todo] app:         http://127.0.0.1:${port}/todo`);
  console.log(`[todo] ops console: http://127.0.0.1:${port}/`);
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[todo] ${signal} — draining`);
  server.closeIdleConnections?.();
  await Promise.race([new Promise((r) => server.close(r)), new Promise((r) => setTimeout(r, 10_000))]);
  rt.stopWorkers();
  await rt.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
