import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSalt, hashText, verifyText } from '../js/crypto.js';

test('makeSalt は32文字のhexを返し、毎回違う', () => {
  const a = makeSalt();
  const b = makeSalt();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test('hashText は64文字のhexを返す', async () => {
  assert.match(await hashText('abc123', 'himitsu'), /^[0-9a-f]{64}$/);
});

test('同じ salt と text なら同じハッシュになる', async () => {
  assert.equal(await hashText('salt1', 'himitsu'), await hashText('salt1', 'himitsu'));
});

test('salt が違えばハッシュも違う', async () => {
  assert.notEqual(await hashText('salt1', 'himitsu'), await hashText('salt2', 'himitsu'));
});

test('平文がハッシュに現れない', async () => {
  const h = await hashText('salt1', 'password1234');
  assert.ok(!h.includes('password'));
});

test('verifyText は正しい文字列で true、違えば false', async () => {
  const salt = makeSalt();
  const h = await hashText(salt, '1234');
  assert.equal(await verifyText(salt, h, '1234'), true);
  assert.equal(await verifyText(salt, h, '1235'), false);
  assert.equal(await verifyText(salt, h, ''), false);
});

test('verifyText はハッシュ未設定なら false', async () => {
  assert.equal(await verifyText('salt', null, '1234'), false);
  assert.equal(await verifyText('salt', '', '1234'), false);
});

test('日本語のあいことばも扱える', async () => {
  const salt = makeSalt();
  const h = await hashText(salt, 'いぬのなまえ');
  assert.equal(await verifyText(salt, h, 'いぬのなまえ'), true);
  assert.equal(await verifyText(salt, h, 'ねこのなまえ'), false);
});
