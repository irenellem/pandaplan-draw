// node --test test/worker.test.mjs  — the real Worker module against an in-memory R2.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../worker/pandaplan-draw-api.mjs';
import { callWorker, fakeR2 } from './fakeR2.mjs';

const file = (name, title = '') => JSON.stringify({ kind: 'drawio', version: 1, name, title, xml: '<mxfile/>', updatedAt: new Date().toISOString() });
const put = (env, q, body) => callWorker(worker, env, `/api/draw/backup?${q}`, { method: 'PUT', body });
const list = async (env) => (await callWorker(worker, env, '/api/draw/backups')).json();
const day = () => new Date().toISOString().slice(0, 10);

test('PUT with no folder param stores an unfiled copy (day folder), listed with folder ""', async () => {
  const env = { BACKUPS: fakeR2() };
  const j = await (await put(env, 'name=plan', file('plan'))).json();
  assert.equal(j.key, `draws/${day()}/plan.pandadraw`);
  const l = await list(env);
  assert.equal(l.items[0].folder, '');
});

test('PUT keeps the title in customMetadata and the list returns it, exactly', async () => {
  const env = { BACKUPS: fakeR2() };
  const title = 'PR# 123 – QC Report';
  await put(env, `name=pr-123-qc-report&folder=qa&title=${encodeURIComponent(title)}`, file('pr-123-qc-report', title));
  const o = env.BACKUPS.objects.get('draws/qa/pr-123-qc-report.pandadraw');
  assert.equal(o.customMetadata.title, title);
  assert.equal(o.customMetadata.source, 'pandaplan-draw');
  assert.equal((await list(env)).items[0].title, title);
  const got = await (await callWorker(worker, env, `/api/draw/backup?key=${encodeURIComponent('draws/qa/pr-123-qc-report.pandadraw')}`)).json();
  assert.equal(got.title, title);
});

test('a title never reaches the key, and is clamped to 120 characters (code points)', async () => {
  const env = { BACKUPS: fakeR2() };
  const long = '🐼'.repeat(130);
  const j = await (await put(env, `name=safe&folder=f&title=${encodeURIComponent('../../' + long)}`, file('safe'))).json();
  assert.equal(j.key, 'draws/f/safe.pandadraw');
  const t = env.BACKUPS.objects.get(j.key).customMetadata.title;
  assert.equal([...t].length, 120);
  assert.ok(!t.includes('�') && /^\.\.\/\.\.\/🐼+$/u.test(t), 'no split surrogate pair');
});

test('the list says when it is cut at 400 items', async () => {
  const env = { BACKUPS: fakeR2() };
  for (let i = 0; i < 450; i++) await env.BACKUPS.put(`draws/f/n${i}.pandadraw`, '{}');
  const l = await list(env);
  assert.equal(l.items.length, 400);
  assert.equal(l.count, 450);
  assert.equal(l.truncated, true);
});

test('DELETE with folder="" removes only the unfiled copies of that name', async () => {
  const env = { BACKUPS: fakeR2() };
  await env.BACKUPS.put(`draws/${day()}/plan.pandadraw`, file('plan'));
  await env.BACKUPS.put('draws/2026-01-02/plan.pandadraw', file('plan'));
  await env.BACKUPS.put('draws/team/plan.pandadraw', file('plan'));
  const j = await (await callWorker(worker, env, '/api/draw/backup?name=plan&folder=', { method: 'DELETE' })).json();
  assert.equal(j.deleted, 2);
  assert.deepEqual([...env.BACKUPS.objects.keys()], ['draws/team/plan.pandadraw']);
});

test('DELETE with a folder removes only that folder; with no folder param, every copy (old contract)', async () => {
  const env = { BACKUPS: fakeR2() };
  await env.BACKUPS.put('draws/a/plan.pandadraw', file('plan'));
  await env.BACKUPS.put('draws/b/plan.pandadraw', file('plan'));
  await callWorker(worker, env, '/api/draw/backup?name=plan&folder=a', { method: 'DELETE' });
  assert.deepEqual([...env.BACKUPS.objects.keys()], ['draws/b/plan.pandadraw']);
  await env.BACKUPS.put('draws/2026-01-02/plan.pandadraw', file('plan'));
  const j = await (await callWorker(worker, env, '/api/draw/backup?name=plan', { method: 'DELETE' })).json();
  assert.equal(j.deleted, 2);
});
