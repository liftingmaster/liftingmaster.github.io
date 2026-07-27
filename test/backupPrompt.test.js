import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSuggestBackup, BACKUP_QUIET_DAYS } from '../js/core/backupPrompt.js';

const NOW = '2026-07-27T10:00:00.000Z';

function daysBefore(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

const noMilestone = { evolved: false, unlocked: false, levelBefore: 9, levelAfter: 9 };
const evolved = { evolved: true, unlocked: false, levelBefore: 20, levelAfter: 20 };
const unlocked = { evolved: false, unlocked: true, levelBefore: 20, levelAfter: 20 };

test('BACKUP_QUIET_DAYS は14', () => {
  assert.equal(BACKUP_QUIET_DAYS, 14);
});

test('節目がなければ、未バックアップでも false', () => {
  assert.equal(shouldSuggestBackup(noMilestone, null, NOW), false);
  assert.equal(shouldSuggestBackup(noMilestone, undefined, NOW), false);
  assert.equal(shouldSuggestBackup({ ...evolved, evolved: false }, null, NOW), false);
});

test('節目があり、一度もバックアップしていなければ true', () => {
  assert.equal(shouldSuggestBackup(evolved, null, NOW), true);
  assert.equal(shouldSuggestBackup(evolved, undefined, NOW), true);
  assert.equal(shouldSuggestBackup(unlocked, null, NOW), true);
});

test('節目があっても、14日未満なら false', () => {
  const lastBackupAt = daysBefore(NOW, 13);
  assert.equal(shouldSuggestBackup(evolved, lastBackupAt, NOW), false);
});

test('節目があり、ちょうど14日空いていれば true', () => {
  const lastBackupAt = daysBefore(NOW, 14);
  assert.equal(shouldSuggestBackup(evolved, lastBackupAt, NOW), true);
});

test('節目があり、14日より大きく空いていれば true', () => {
  const lastBackupAt = daysBefore(NOW, 30);
  assert.equal(shouldSuggestBackup(evolved, lastBackupAt, NOW), true);
});

test('直近にバックアップ済みなら、進化していても false', () => {
  const lastBackupAt = daysBefore(NOW, 1);
  assert.equal(shouldSuggestBackup(evolved, lastBackupAt, NOW), false);
});

test('新しい仲間が増えた節目でも同じ規則が働く', () => {
  const lastBackupAt = daysBefore(NOW, 1);
  assert.equal(shouldSuggestBackup(unlocked, lastBackupAt, NOW), false);
  assert.equal(shouldSuggestBackup(unlocked, daysBefore(NOW, 14), NOW), true);
});

test('レベル10の倍数をまたぐと節目（9→10）、未バックアップなら true', () => {
  const m = { evolved: false, unlocked: false, levelBefore: 9, levelAfter: 10 };
  assert.equal(shouldSuggestBackup(m, null, NOW), true);
});

test('10→11 はまたいでいないので節目にならない', () => {
  const m = { evolved: false, unlocked: false, levelBefore: 10, levelAfter: 11 };
  assert.equal(shouldSuggestBackup(m, null, NOW), false);
});

test('28→31 は31が属する30台をまたぐので節目になる', () => {
  const m = { evolved: false, unlocked: false, levelBefore: 28, levelAfter: 31 };
  assert.equal(shouldSuggestBackup(m, null, NOW), true);
});

test('19→19 は変化なしなので節目にならない', () => {
  const m = { evolved: false, unlocked: false, levelBefore: 19, levelAfter: 19 };
  assert.equal(shouldSuggestBackup(m, null, NOW), false);
});

test('節目が複数重なっていても判定は変わらない（true）', () => {
  const m = {
    evolved: true, unlocked: true, levelBefore: 9, levelAfter: 10,
  };
  assert.equal(shouldSuggestBackup(m, null, NOW), true);
});
