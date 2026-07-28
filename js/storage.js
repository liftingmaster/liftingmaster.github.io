import { CHARACTERS } from './core/characters.js';
import { stageOf } from './core/player.js';

export const STORAGE_KEY = 'liftingmaster.v1';
const SCHEMA_VERSION = 2;
// v1 = 進化の意味論を変える前（v8まで）。v2 = 控えのキャラは進化しない（v9〜）
const LEGACY_SCHEMA_VERSION = 1;
const VALID_CHAR_IDS = new Set(CHARACTERS.map((c) => c.id));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// アプリが書き出す createdAt/approvedAt は必ず new Date().toISOString() の形
// （例: 2026-07-26T10:00:00.000Z）。バックアップの読み込み経由で任意の文字列が
// 紛れ込むと、画面側でその値を innerHTML に差し込んだときに注入経路になりうるため、
// 保存前にこの形であることを検証しておく
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function createInitialState() {
  return {
    version: SCHEMA_VERSION, activePlayerId: null, players: [], lastBackupAt: null,
  };
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

/** ISO 8601 のタイムスタンプ（new Date().toISOString() の形）か */
function isValidIsoTimestamp(s) {
  if (typeof s !== 'string' || !ISO_TIMESTAMP_RE.test(s)) return false;
  return !Number.isNaN(new Date(s).getTime());
}

function validateRecord(r, where, errors) {
  if (!r || typeof r !== 'object') { errors.push(`${where}: 記録がオブジェクトでない`); return; }
  if (typeof r.id !== 'string' || r.id === '') errors.push(`${where}: id が不正`);
  if (!isValidDate(r.date)) errors.push(`${where}: date が不正 (${r.date})`);
  if (r.mode !== 'no' && r.mode !== 'one') errors.push(`${where}: mode が不正 (${r.mode})`);
  if (!Number.isInteger(r.count) || r.count < 1 || r.count > 9999) errors.push(`${where}: count が範囲外 (${r.count})`);
  if (!isValidIsoTimestamp(r.createdAt)) errors.push(`${where}: createdAt が不正 (${r.createdAt})`);

  // 記録の修正機能（仕様 §2.5・§3.1）で足した4項目。旧データは持っていないので、
  // 無いこと自体は不正としない（lastBackupAt を足したときと同じ扱い）。
  // 値が入っているときだけ、形を厳しく見る
  if (r.charId !== undefined && !VALID_CHAR_IDS.has(r.charId)) {
    errors.push(`${where}: charId が不正 (${r.charId})`);
  }
  if (r.grantedExp !== undefined && (!Number.isFinite(r.grantedExp) || r.grantedExp < 0)) {
    errors.push(`${where}: grantedExp が不正 (${r.grantedExp})`);
  }
  if (r.originalCount !== undefined
    && (!Number.isInteger(r.originalCount) || r.originalCount < 1 || r.originalCount > 9999)) {
    errors.push(`${where}: originalCount が範囲外 (${r.originalCount})`);
  }
  if (r.editedAt !== undefined && !isValidIsoTimestamp(r.editedAt)) {
    errors.push(`${where}: editedAt が不正 (${r.editedAt})`);
  }
}

/**
 * 承認のお知らせ1件。ホーム画面が `[...p.pendingEffects, …]` の形で展開し、
 * 合計を innerHTML に差し込むため、配列でなければ TypeError で承認ボタンが
 * 黙って効かなくなり、数値でなければ NaN や文字列連結が画面に出る。
 * バックアップJSONの手編集は「パスワードもあいことばも忘れたとき」の
 * 正規の復旧手段として案内している以上、手で書かれた値が入ってくる前提で検証する。
 */
function validatePendingEffects(list, where, errors) {
  if (!Array.isArray(list)) { errors.push(`${where}: pendingEffects が配列でない`); return; }
  list.forEach((e, i) => {
    const at = `${where}.pendingEffects[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push(`${at}: オブジェクトでない`); return; }
    if (typeof e.type !== 'string' || e.type === '') errors.push(`${at}: type が不正 (${e.type})`);
    // 種別ごとに形が違う（仕様 §3.3）。
    // - approved: `{ type, count, exp }`。何件みとめたかを出すので count が要る
    // - edited:   `{ type, exp }`。1件の修正につき1エントリなので count は無い。
    //             EXPが減る修正もあるため exp は負の値を受理する
    if (e.type === 'edited') {
      if (!Number.isFinite(e.exp)) errors.push(`${at}: exp が数値でない (${e.exp})`);
    } else {
      if (!Number.isFinite(e.count)) errors.push(`${at}: count が数値でない (${e.count})`);
      if (!Number.isFinite(e.exp)) errors.push(`${at}: exp が数値でない (${e.exp})`);
    }
  });
}

/** パスワード・あいことばの4項目。未設定なら null、設定済みなら文字列 */
function validateCredentials(settings, where, errors) {
  for (const key of ['passwordHash', 'passwordSalt', 'secretQuestion', 'secretAnswerHash']) {
    const v = settings[key];
    if (v !== null && typeof v !== 'string') errors.push(`${where}: ${key} が不正`);
  }
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
  // lastBackupAt は Task 27 で追加した項目。既存の家族のバックアップJSONには
  // 存在しないため、無い（undefined）ことは不正としない。未バックアップとして扱う
  if (obj.lastBackupAt !== undefined && obj.lastBackupAt !== null
    && !isValidIsoTimestamp(obj.lastBackupAt)) {
    errors.push(`lastBackupAt が不正 (${obj.lastBackupAt})`);
  }

  obj.players.forEach((p, i) => {
    const where = `players[${i}]`;
    if (!p || typeof p !== 'object') { errors.push(`${where}: プレイヤーが不正`); return; }
    if (typeof p.id !== 'string' || p.id === '') errors.push(`${where}: id が不正`);
    if (typeof p.name !== 'string' || p.name === '' || p.name.length > 20) errors.push(`${where}: name が不正`);
    if (!isValidIsoTimestamp(p.createdAt)) errors.push(`${where}: createdAt が不正 (${p.createdAt})`);

    validatePendingEffects(p.pendingEffects, where, errors);

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

    if (!p.settings || typeof p.settings !== 'object') {
      errors.push(`${where}: settings が不正`);
    } else {
      if (typeof p.settings.approvalEnabled !== 'boolean') errors.push(`${where}: approvalEnabled が不正`);
      validateCredentials(p.settings, where, errors);
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * v1（v8まで）→ v2（v9〜）のデータ移行。進化の意味論を変えたことへの
 * グランドファザリング（2026-07-28 安部さんの判断）。
 *
 * displayStageOf の定義が「潜在段階と実現段階の大きい方」から「実現段階だけ」に
 * 変わったため、そのまま適用すると、すでに控えのキャラの絵が進化後になっている
 * 端末で**絵が退化**する。「一度見せた進化は取り消さない」という約束を破るので、
 * 読み込みのときに evolvedStages を潜在段階まで埋めておく。
 *
 * 埋め方は「いまの値 ∪ 1..潜在段階」の**和集合**。
 *   - []  ＋潜在1 → [1]
 *   - [1] ＋潜在2 → [1,2]（v8 は max(stageOf, ...) だったので第2進化の絵が出ていた）
 *   - [2] ＋潜在0 → [2] のまま（**縮めない**）
 * 「空の配列だけ埋める」にすると [1]＋潜在2 が素通りして絵が 2→1 に退化する。
 * トップ値だけでなく途中の段階も埋めるのは、evolvedStages が「もう見せた段階」を
 * 表すため。見た目が第2進化なら第1進化は視覚的に通過済みで、
 * トップ値だけ埋めるとあとで第1進化の演出が誤って出る。
 *
 * **いつ走らせるかは state.version だけで決める**（version 1 のときだけ）。
 * 別キーの印では「v8由来のデータ」と「v9で保存したデータ」を区別できず、
 * v9で取ったバックアップを復元するたびに控えのキャラが黙って進化してしまう。
 *
 * **検証より前に呼ぶ**こと。壊れたデータでも例外を外に出さない
 * （load は決して throw しない、が既存の契約）。
 *
 * @returns {boolean} 移行を実行したか（version を書き換えたか）
 */
function migrateToV2(state) {
  if (!state || typeof state !== 'object') return false;
  if (state.version !== LEGACY_SCHEMA_VERSION) return false;

  if (Array.isArray(state.players)) {
    for (const p of state.players) {
      if (!p || typeof p !== 'object' || !Array.isArray(p.chars)) continue;
      for (const c of p.chars) {
        if (!c || typeof c !== 'object' || !Array.isArray(c.evolvedStages)) continue;
        let potential = 0;
        try {
          potential = stageOf(p, c.charId);
        } catch {
          continue; // 壊れたキャラ・記録はここでは直さない。validateState に任せる
        }
        for (let s = 1; s <= potential; s += 1) {
          if (!c.evolvedStages.includes(s)) c.evolvedStages.push(s);
        }
        c.evolvedStages.sort((a, b) => a - b);
      }
    }
  }

  state.version = SCHEMA_VERSION;
  return true;
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

  // 移行は検証より前に。validateState は version 2 しか通さないので、
  // v1データはここで2へ上げてからでないと「壊れたデータ」として退避されてしまう
  const migrated = migrateToV2(parsed);

  if (!validateState(parsed).ok) {
    quarantine(storage, raw);
    return { ok: true, state: createInitialState(), recovered: true };
  }

  // **順序が要**: 移行した結果をディスクへ書く。書けなかったらディスク上の
  // version は 1 のまま残るので、次の起動でやり直せる。
  // 先に version だけ2にして保存に失敗すると、evolvedStages が空のままなのに
  // 移行が二度と走らず、絵が退化したまま戻らない（移行自身が
  // 「一度見せた進化は取り消さない」を破る）
  if (migrated) save(storage, parsed);

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
  // 取り込むJSON自身の version で判断する。v8由来（version 1）なら移行し、
  // v9で取った正当なバックアップ（version 2）には触らない。
  // ここを無条件に移行すると、バックアップを復元するたびに
  // 「そだてると しんかしそう！」だった控えのキャラが全員その場で黙って進化し、
  // 演出が永久に失われる。取り込んだ state の保存は呼び出し側
  // （js/views/settings.js が app.persist() を呼ぶ）が責任を持つ
  migrateToV2(parsed);
  const v = validateState(parsed);
  if (!v.ok) return { ok: false, state: null, errors: v.errors };
  return { ok: true, state: parsed, errors: [] };
}
