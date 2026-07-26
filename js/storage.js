import { CHARACTERS } from './core/characters.js';

export const STORAGE_KEY = 'liftingmaster.v1';
const SCHEMA_VERSION = 1;
const VALID_CHAR_IDS = new Set(CHARACTERS.map((c) => c.id));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createInitialState() {
  return { version: SCHEMA_VERSION, activePlayerId: null, players: [] };
}

export function createPlayer({ id, name, starterId, now }) {
  return {
    id,
    name,
    createdAt: now,
    records: [],
    pending: [],
    activeCharId: starterId,
    chars: [{ charId: starterId, nickname: null, exp: 0, unlockedAt: now, evolvedStages: [] }],
    pendingEffects: [],
    settings: {
      approvalEnabled: false,
      passwordHash: null,
      passwordSalt: null,
      secretQuestion: null,
      secretAnswerHash: null,
    },
  };
}

/** 'YYYY-MM-DD' が実在する日付か */
function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validateRecord(r, where, errors) {
  if (!r || typeof r !== 'object') { errors.push(`${where}: 記録がオブジェクトでない`); return; }
  if (typeof r.id !== 'string' || r.id === '') errors.push(`${where}: id が不正`);
  if (!isValidDate(r.date)) errors.push(`${where}: date が不正 (${r.date})`);
  if (r.mode !== 'no' && r.mode !== 'one') errors.push(`${where}: mode が不正 (${r.mode})`);
  if (!Number.isInteger(r.count) || r.count < 1 || r.count > 9999) errors.push(`${where}: count が範囲外 (${r.count})`);
  if (typeof r.createdAt !== 'string') errors.push(`${where}: createdAt が不正`);
}

export function validateState(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['状態がオブジェクトでない'] };
  if (obj.version !== SCHEMA_VERSION) errors.push(`version が ${SCHEMA_VERSION} でない`);
  if (!Array.isArray(obj.players)) {
    errors.push('players が配列でない');
    return { ok: false, errors };
  }
  if (obj.activePlayerId !== null && typeof obj.activePlayerId !== 'string') {
    errors.push('activePlayerId が不正');
  }

  obj.players.forEach((p, i) => {
    const where = `players[${i}]`;
    if (!p || typeof p !== 'object') { errors.push(`${where}: プレイヤーが不正`); return; }
    if (typeof p.id !== 'string' || p.id === '') errors.push(`${where}: id が不正`);
    if (typeof p.name !== 'string' || p.name === '' || p.name.length > 20) errors.push(`${where}: name が不正`);

    if (!Array.isArray(p.records)) errors.push(`${where}: records が配列でない`);
    else p.records.forEach((r, j) => validateRecord(r, `${where}.records[${j}]`, errors));

    if (!Array.isArray(p.pending)) errors.push(`${where}: pending が配列でない`);
    else p.pending.forEach((r, j) => validateRecord(r, `${where}.pending[${j}]`, errors));

    if (!Array.isArray(p.chars) || p.chars.length === 0) {
      errors.push(`${where}: chars が不正`);
    } else {
      p.chars.forEach((c, j) => {
        if (!c || typeof c !== 'object') { errors.push(`${where}.chars[${j}]: キャラがオブジェクトでない`); return; }
        if (!VALID_CHAR_IDS.has(c.charId)) errors.push(`${where}.chars[${j}]: 未知のキャラ (${c.charId})`);
        if (!Number.isFinite(c.exp) || c.exp < 0) errors.push(`${where}.chars[${j}]: exp が不正`);
        if (!Array.isArray(c.evolvedStages)) errors.push(`${where}.chars[${j}]: evolvedStages が不正`);
        if (c.nickname !== null && (typeof c.nickname !== 'string' || c.nickname.length > 10)) {
          errors.push(`${where}.chars[${j}]: nickname が不正`);
        }
      });
      if (!p.chars.some((c) => c && c.charId === p.activeCharId)) {
        errors.push(`${where}: activeCharId が手持ちにない`);
      }
    }

    if (!p.settings || typeof p.settings !== 'object') errors.push(`${where}: settings が不正`);
    else if (typeof p.settings.approvalEnabled !== 'boolean') errors.push(`${where}: approvalEnabled が不正`);
  });

  return { ok: errors.length === 0, errors };
}

/**
 * 破損データを退避する。1枠目(`${STORAGE_KEY}.broken`)が空ならそこへ、
 * 埋まっていれば2枠目(`${STORAGE_KEY}.broken.2`)へ上書きする（無制限にキーを増やさないため）。
 * 退避の書き込み自体が失敗しても（クォータ超過など）例外は外に漏らさない。
 * フォレンジック用のコピーを失うことより、起動できなくなることの方が悪いため。
 */
function quarantine(storage, raw) {
  try {
    const key = storage.getItem(`${STORAGE_KEY}.broken`) === null
      ? `${STORAGE_KEY}.broken`
      : `${STORAGE_KEY}.broken.2`;
    storage.setItem(key, raw);
  } catch {
    // 退避に失敗しても起動は続行する
  }
}

/** 破損データは別キーに退避し、初期状態で起動する */
export function load(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { ok: true, state: createInitialState(), recovered: false };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(storage, raw);
    return { ok: true, state: createInitialState(), recovered: true };
  }

  if (!validateState(parsed).ok) {
    quarantine(storage, raw);
    return { ok: true, state: createInitialState(), recovered: true };
  }

  return { ok: true, state: parsed, recovered: false };
}

export function save(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export function exportJson(state) {
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, state: null, errors: [`JSONとして読めない: ${e.message}`] };
  }
  const v = validateState(parsed);
  if (!v.ok) return { ok: false, state: null, errors: v.errors };
  return { ok: true, state: parsed, errors: [] };
}
