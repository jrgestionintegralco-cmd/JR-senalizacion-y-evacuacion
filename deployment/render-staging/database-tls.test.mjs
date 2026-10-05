// Tests the initializer's actual client-construction block; no connect or SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const source = readFileSync(new URL('./database.mjs', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('const client ='), source.indexOf('await client.connect();'));
assert.ok(block.startsWith('const client = new pg.Client('));
assert.doesNotMatch(block, /\.connect\(|\.query\(/);
const construct = new Function('pg', 'url', `${block}\nreturn client;`);
const base = 'postgresql://dummy:dummy@external.example.test/safe_enter_render_staging';

test('initializer explicitly enables verified TLS without changing the URL', () => {
  const url = new URL(base);
  let supplied;
  class ObservedClient extends pg.Client {
    constructor(options) { supplied = options; super(options); }
  }
  const client = construct({ Client: ObservedClient }, url);
  assert.equal(supplied.connectionString, url.href);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
});
test('explicit TLS does not depend on PGSSLMODE, even if it says disable', () => {
  const previous = process.env.PGSSLMODE;
  try {
    for (const value of [undefined, 'disable']) {
      if (value === undefined) delete process.env.PGSSLMODE;
      else process.env.PGSSLMODE = value;
      const client = construct(pg, new URL(base));
      assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
    }
  } finally {
    if (previous === undefined) delete process.env.PGSSLMODE;
    else process.env.PGSSLMODE = previous;
  }
});
test('verified TLS URL options remain accepted', () => {
  const client = construct(pg, new URL(`${base}?sslmode=verify-full`));
  assert.ok(client.connectionParameters.ssl);
  assert.notEqual(client.connectionParameters.ssl.rejectUnauthorized, false);
});
test('URL options cannot silently disable TLS or certificate verification', () => {
  for (const options of ['sslmode=disable', 'ssl=0', 'sslmode=no-verify', 'sslmode=require&uselibpqcompat=true']) {
    assert.throws(() => construct(pg, new URL(`${base}?${options}`)),
      /requires TLS with certificate verification/);
  }
});
