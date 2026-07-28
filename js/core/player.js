import { levelFromExp } from './exp.js';
import { personalBest, recordedDates } from './stats.js';
import { currentStreak, longestStreak } from './streak.js';
import { evolutionStage, evolutionProgress } from './evolution.js';
import { pendingUnlocks, nextUnlock } from './unlock.js';
import { computeGain } from './gain.js';
import { getCharacter } from './characters.js';

/** 育成中キャラの手持ちエントリ */
export function activeCharEntry(player) {
  const entry = player.chars.find((c) => c.charId === player.activeCharId);
  if (!entry) throw new Error(`activeCharId not in chars: ${player.activeCharId}`);
  return entry;
}

function charEntry(player, charId) {
  const entry = player.chars.find((c) => c.charId === charId);
  if (!entry) throw new Error(`character not owned: ${charId}`);
  return entry;
}

/** これまでに育てたキャラの最高到達レベル */
export function maxLevelEver(player) {
  return player.chars.reduce((max, c) => Math.max(max, levelFromExp(c.exp).level), 1);
}

/** 進化判定に使う実績（プレイヤー本人のもの） */
function achievements(player) {
  return {
    bestNo: personalBest(player.records, 'no'),
    bestOne: personalBest(player.records, 'one'),
    longestStreak: longestStreak(recordedDates(player.records)),
  };
}

/** そのキャラの現在の進化段階 */
export function stageOf(player, charId) {
  const entry = charEntry(player, charId);
  const { level } = levelFromExp(entry.exp);
  return evolutionStage(charId, { level, ...achievements(player) });
}

/**
 * 画面が描くべき進化段階。
 *
 * 記録を直してEXPが減ると、生の stageOf は前の段階へ戻りうる（仕様 §2.2.3）。
 * レベルの数字が下がるのは受け入れるが、「一度見せた進化の姿」が親の入力ミス修正の
 * 副作用で子供の前で格下げされて見えるのは体感の重さが違う。そこで evolvedStages
 * （演出済みの段階）を下限にしたラチェットをかけ、絵だけは戻らないようにする。
 * これは「characterSvg に何を渡すか」だけのための値。進化の判定・新しい進化の検知・
 * 進化条件のチェックリストの正誤には、必ず生の stageOf を使うこと
 * （ラチェットを判定に使うと、ホームの「しんかの じょうけん」と
 * ずかん詳細の表示が食い違う）。
 *
 * evolvedStages は手編集バックアップから来ることがあるので 0〜2 に丸める。
 * 範囲外の値をそのまま返すと js/svg/character.js が undefined を引いて
 * home/party/dex/dexDetail が例外で真っ白になる
 */
export function displayStageOf(player, charId) {
  const entry = charEntry(player, charId);
  const shown = Array.isArray(entry.evolvedStages)
    ? entry.evolvedStages.filter((s) => Number.isFinite(s))
    : [];
  return Math.min(2, Math.max(0, ...shown));
}

/**
 * 「そだてると しんかしそう」なキャラか（控えのままで条件を満たしている）。
 *
 * 進化条件3つのうち、自己ベスト回数と連続日数はプレイヤー共通なので、
 * 以前育てていてレベルだけ足りている控えのキャラは、EXPを1ももらわないまま
 * 潜在段階だけ上がる。実現（絵が変わる）のは育成中に切り替えた瞬間だけなので、
 * 止まっている理由が分かるよう、画面はこの値でヒントを出す
 */
export function canRealizeEvolution(player, charId) {
  return stageOf(player, charId) > displayStageOf(player, charId);
}

/** 次の進化への進捗。最終形態なら null */
export function progressOf(player, charId) {
  const stage = stageOf(player, charId);
  if (stage >= 2) return null;
  const entry = charEntry(player, charId);
  const { level } = levelFromExp(entry.exp);
  return evolutionProgress(charId, stage + 1, { level, ...achievements(player) });
}

/** ニックネームがあればそれ、なければキャラの正式名 */
export function displayName(player, charId) {
  const entry = player.chars.find((c) => c.charId === charId);
  return (entry && entry.nickname) || getCharacter(charId).name;
}

/** 画面表示に必要な値をまとめて返す */
export function playerView(player, today) {
  const entry = activeCharEntry(player);
  const lv = levelFromExp(entry.exp);
  const dates = recordedDates(player.records);
  const maxLv = maxLevelEver(player);
  return {
    level: lv.level,
    expIntoLevel: lv.expIntoLevel,
    expToNextLevel: lv.expToNextLevel,
    bestNo: personalBest(player.records, 'no'),
    bestOne: personalBest(player.records, 'one'),
    currentStreak: currentStreak(dates, today),
    longestStreak: longestStreak(dates),
    stage: stageOf(player, entry.charId),
    charId: entry.charId,
    charName: displayName(player, entry.charId),
    pendingCount: player.pending.length,
    maxLevelEver: maxLv,
    nextUnlock: nextUnlock(maxLv),
  };
}

/** 深いコピー（構造が単純なJSONなので構造化複製で足りる） */
function clone(player) {
  return JSON.parse(JSON.stringify(player));
}

/**
 * 進化を実現させる（evolvedStages に積む）共通処理。
 *
 * stageBefore+1..stageAfter を**すべて**積むのが要点。evolutionStage は
 * 「条件を満たしている最大の段階」を返すだけで1段ずつ上がる保証がなく、
 * 0→2 の一気進化が実際に起こる。トップ値だけ積むと、あとで潜在段階が1へ落ちて
 * 戻ったときに「絵は第2進化のまま、第1進化の演出が出る」という矛盾が作れる。
 * commitRecord・applyRecordChange・switchChar の3か所で同じ規則を使う。
 *
 * @returns {number|null} 新しく到達した段階（演出に使う）。無ければ null
 */
function realizeEvolution(entry, stageBefore, stageAfter) {
  if (!(stageAfter > stageBefore)) return null;
  if (!Array.isArray(entry.evolvedStages)) entry.evolvedStages = [];
  if (entry.evolvedStages.includes(stageAfter)) return null;
  for (let s = stageBefore + 1; s <= stageAfter; s += 1) {
    if (!entry.evolvedStages.includes(s)) entry.evolvedStages.push(s);
  }
  entry.evolvedStages.sort((a, b) => a - b);
  return stageAfter;
}

/** 確定記録を1件足してEXPを反映する。addRecord と approvePending の共通処理 */
function commitRecord(player, record) {
  const next = clone(player);
  const entry = next.chars.find((c) => c.charId === next.activeCharId);

  const levelBefore = levelFromExp(entry.exp).level;
  const stageBefore = stageOf(next, entry.charId);

  const gain = computeGain({
    records: next.records, record, charId: entry.charId, charExp: entry.exp,
  });

  // どのキャラに何EXP渡したかを記録自身に残す。あとで「なおす／けす」をしたときに、
  // 推定ではなく正確に引き直せるのはこの2つがあるおかげ（仕様 §2.2.2）
  next.records.push({ ...record, charId: entry.charId, grantedExp: gain.exp });
  entry.exp += gain.exp;

  const levelAfter = levelFromExp(entry.exp).level;
  const stageAfter = stageOf(next, entry.charId);

  const evolvedTo = realizeEvolution(entry, stageBefore, stageAfter);

  const ownedIds = next.chars.map((c) => c.charId);
  const unlocks = pendingUnlocks(maxLevelEver(next), ownedIds);

  return {
    player: next,
    result: {
      queued: false,
      exp: gain.exp,
      isPersonalBest: gain.isPersonalBest,
      levelBefore, levelAfter, evolvedTo, unlocks,
    },
  };
}

/**
 * 記録を1件追加する。
 * 承認機能ONなら承認待ちに入れるだけでEXPは動かない。
 */
export function addRecord(player, { id, count, mode, date, now }) {
  const record = { id, date, mode, count, createdAt: now };

  if (player.settings.approvalEnabled) {
    const next = clone(player);
    next.pending.push(record);
    const level = levelFromExp(activeCharEntry(next).exp).level;
    const ownedIds = next.chars.map((c) => c.charId);
    return {
      player: next,
      result: {
        queued: true, exp: 0, isPersonalBest: false,
        levelBefore: level,
        levelAfter: level,
        evolvedTo: null,
        unlocks: pendingUnlocks(maxLevelEver(next), ownedIds),
      },
    };
  }

  return commitRecord(player, record);
}

/**
 * 承認待ちを承認する。count を渡すと回数を直して承認できる。
 * 承認時点の育成キャラにEXPが入る。
 */
export function approvePending(player, { pendingId, count, now }) {
  const queued = player.pending.find((q) => q.id === pendingId);
  if (!queued) throw new Error(`pending not found: ${pendingId}`);

  const withoutQueued = clone(player);
  withoutQueued.pending = withoutQueued.pending.filter((q) => q.id !== pendingId);

  const record = { ...queued, count, approvedAt: now };
  return commitRecord(withoutQueued, record);
}

/**
 * 記録の並び順。createdAt 昇順、同値なら records 配列の添字を第2キーにする。
 * おうちのひとが短時間に続けて入れると createdAt は完全一致しうるので、
 * ここを決めておかないと同じ操作でも結果が変わってしまう。
 */
function makeOrderCmp(records) {
  const at = new Map(records.map((r, i) => [r.id, i]));
  return (a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return at.get(a.id) - at.get(b.id);
  };
}

/**
 * グループを「空の状態から」リプレイして、キャラごとの付与合計と
 * 各メンバーの grantedExp を出す。records は書き換えない。
 *
 * 文脈（computeGain に渡す records）は「そのメンバーより前に並ぶ記録すべて」。
 * **後に作られた記録は入れない**。ここを全期間にすると、あとから伸びた自己ベストや
 * あとから積んだ連続日数が過去の記録に後付けされ、「回数を増やしたのにEXPが減る」
 * といった逆転が起きる。
 *
 * charExp（すくすく Lv20以下／きらめき Lv50以上 のレベル条件に使う）は
 * **その記録を付けた当時のレベル水準**でなければならない。そこで baseExp
 * （＝そのキャラの全記録ぶんを引いた出発点）から、並び順に沿って
 *   - メンバー: このリプレイで計算し直した値
 *   - メンバー以外: 記録に保存されている grantedExp
 * を足していく（running）。グループ外の記録を足し忘れると baseExp が実質
 * 「今のレベル」になり、Lv1のときに付けた はっぱ の記録を Lv28 で消すと
 * すくすく（×2）が外れて渡した分の半分しか引き戻せない、といったズレが出る。
 *
 * totals はメンバーぶんの付与合計だけ（＝差分に使う額）。running とは別に数える。
 */
function replayGroup(records, specs, baseExp, cmp) {
  const ownerOf = new Map(specs.map((s) => [s.id, s.charId]));
  const running = new Map(baseExp);
  const totals = new Map();
  const granted = new Map();
  const acc = [];
  for (const r of [...records].sort(cmp)) {
    const charId = ownerOf.get(r.id);
    if (charId !== undefined) {
      const gain = computeGain({
        records: acc, record: r, charId, charExp: running.get(charId) || 0,
      });
      running.set(charId, (running.get(charId) || 0) + gain.exp);
      totals.set(charId, (totals.get(charId) || 0) + gain.exp);
      granted.set(r.id, gain.exp);
    } else if (Number.isFinite(r.grantedExp) && running.has(r.charId)) {
      // グループ外・非メンバーの記録は計算し直さない。保存されている値をそのまま
      // 積んで、次のメンバーが「当時の水準」で判定されるようにするだけ
      running.set(r.charId, running.get(r.charId) + r.grantedExp);
    }
    acc.push(r);
  }
  return { totals, granted };
}

/**
 * 確定済み記録1件の回数訂正・削除の共通処理。
 *
 * 方式は「対称な before/after リプレイ」（2026-07-28 第2回改訂）。
 * 同じ日・同じモードのグループを、**変更前と変更後でまったく同じやり方で
 * 2回リプレイし、その差分だけ**をキャラのEXPに反映する。
 *
 *   1. リプレイ対象 = グループの新データ全部 ＋ 対象記録 R 自身
 *      （R が旧データなら持ち主は activeCharId。R 以外の旧データの兄弟は
 *      対象にしない＝EXPを動かさないが、dailyBest などの文脈には参加する）
 *   2. baseExp[c] = max(0, c.exp − そのキャラのグループ内 grantedExp 合計)。
 *      before と after で同じ baseExp を使う
 *   3. exp = max(0, exp + (after − before))。**クランプは最後に1回だけ**
 *
 * 引く側だけクランプしたり、引く基準と足す基準を変えたりすると、
 * 「回数を減らしたのに増える」「0に張り付いたキャラの負債が消えて無からEXPが生まれる」
 * といった保存則の破れが出る。before と after を対称に保つのが要点。
 *
 * @param {boolean} remove true なら削除（count は使わない）
 */
function applyRecordChange(player, { recordId, count, now, remove }) {
  if (!player.records.some((r) => r.id === recordId)) {
    throw new Error(`record not found: ${recordId}`);
  }

  const next = clone(player);
  const index = next.records.findIndex((r) => r.id === recordId);
  const target = next.records[index];
  const { date, mode } = target;

  const ownedIds = new Set(next.chars.map((c) => c.charId));
  // 「新データ」と言えるのは、charId が今も手持ちにあり grantedExp が数値のときだけ。
  // 手編集バックアップ由来で条件を満たさないものは旧データとして扱う
  const exact = typeof target.charId === 'string'
    && Number.isFinite(target.grantedExp)
    && ownedIds.has(target.charId);
  const estimated = !exact;
  if (estimated) activeCharEntry(next); // 育成キャラが手持ちにない状態はここで弾く
  const ownerOfTarget = exact ? target.charId : next.activeCharId;

  // 記録を書き換える前に、全キャラの「まえ」を控える（stageOf は records を見るため）
  const snapshots = new Map(next.chars.map((c) => [c.charId, {
    exp: c.exp,
    level: levelFromExp(c.exp).level,
    stage: stageOf(next, c.charId),
  }]));

  const cmp = makeOrderCmp(next.records);

  const memberSpecs = next.records
    .filter((r) => r.date === date && r.mode === mode)
    .filter((r) => r.id === recordId
      || (Number.isFinite(r.grantedExp) && ownedIds.has(r.charId)))
    .map((r) => ({ id: r.id, charId: r.id === recordId ? ownerOfTarget : r.charId }));

  // レベル依存特性の判定に使うリプレイの出発点。
  // **全記録**の grantedExp を引いた「何も記録していなかったころの水準」にする。
  // グループ内だけを引くと、あとから積んだEXPが残って実質「今のレベル」になり、
  // 「いつ直したか」で結果が変わってしまう（はっぱ・きらら）。
  // before/after で同じ値を使うことで、引く基準と足す基準のずれも防ぐ
  const grantedByChar = new Map();
  for (const r of next.records) {
    if (Number.isFinite(r.grantedExp) && ownedIds.has(r.charId)) {
      grantedByChar.set(r.charId, (grantedByChar.get(r.charId) || 0) + r.grantedExp);
    }
  }
  const baseExp = new Map(next.chars.map(
    (c) => [c.charId, Math.max(0, c.exp - (grantedByChar.get(c.charId) || 0))],
  ));

  // before: いまの回数のままリプレイ（records は触らずコピーの上で回す）
  const beforeRun = replayGroup(
    next.records.map((r) => ({ ...r })), memberSpecs, baseExp, cmp,
  );

  if (remove) {
    next.records.splice(index, 1);
  } else {
    // originalCount / editedAt は、直接なおした R にだけ書く。
    // リプレイで grantedExp が変わっただけの「兄弟」記録には書かない
    if (target.originalCount === undefined) target.originalCount = target.count;
    target.count = count;
    target.editedAt = now;
    if (estimated) target.charId = ownerOfTarget; // 旧データを新データへ格上げ
  }

  // after: 変更後の回数（削除なら R 抜き）で、まったく同じやり方でリプレイ
  const afterSpecs = remove ? memberSpecs.filter((s) => s.id !== recordId) : memberSpecs;
  const afterRun = replayGroup(next.records, afterSpecs, baseExp, cmp);

  for (const spec of afterSpecs) {
    const rec = next.records.find((r) => r.id === spec.id);
    rec.grantedExp = afterRun.granted.get(spec.id);
  }

  // 差分だけを反映する。クランプはここ1回だけ（途中でクランプすると負債が消える）
  for (const c of next.chars) {
    const diff = (afterRun.totals.get(c.charId) || 0) - (beforeRun.totals.get(c.charId) || 0);
    if (diff !== 0) c.exp = Math.max(0, c.exp + diff);
  }

  // 進化を実現させる（evolvedStages に積む）のは**育成中のキャラだけ**
  // （2026-07-28 安部さんの判断）。進化条件のうち自己ベスト回数と連続日数は
  // プレイヤー共通なので、ここを全キャラに広げると、EXPを1ももらっていない
  // 控えのキャラまで同時に進化してしまう（「1体しかEXPは付与できないのに
  // 2体がなぜ同時に進化する？」）。控えは switchChar で育成中にした瞬間に実現する。
  //
  // EXPの増減・レベルの前後は**全キャラぶん**報告し続ける。兄弟キャラのレベルが
  // 大きく下がることがあり、実行前の確認に必要なため（charChanges）
  const charChanges = [];
  let evolvedTo = null;
  for (const c of next.chars) {
    const snap = snapshots.get(c.charId);
    const expDelta = c.exp - snap.exp;
    let charEvolvedTo = null;
    if (c.charId === next.activeCharId) {
      charEvolvedTo = realizeEvolution(c, snap.stage, stageOf(next, c.charId));
    }
    if (c.charId === ownerOfTarget) evolvedTo = charEvolvedTo;
    // 動いていないキャラは載せない。ただし進化したなら、演出を出すために必ず載せる
    if (expDelta !== 0 || charEvolvedTo !== null) {
      charChanges.push({
        charId: c.charId,
        expDelta,
        levelBefore: snap.level,
        levelAfter: levelFromExp(c.exp).level,
        stageBefore: snap.stage,
        evolvedTo: charEvolvedTo,
      });
    }
  }

  const targetSnap = snapshots.get(ownerOfTarget);
  const targetChar = next.chars.find((c) => c.charId === ownerOfTarget);

  return {
    player: next,
    result: {
      // 見積もりではなく、クランプ後に実際に動いた量（0に張り付いた場合を含む）
      expDelta: targetChar.exp - targetSnap.exp,
      charId: ownerOfTarget,
      levelBefore: targetSnap.level,
      levelAfter: levelFromExp(targetChar.exp).level,
      evolvedTo,
      // 「進化まえの姿」は実際に使った段階でないと嘘になる。evolutionStage は
      // 満たしている最大の段階を返すだけで1段ずつ上がる保証がなく 0→2 も起こる
      stageBefore: targetSnap.stage,
      estimated,
      // グループ再計算で動いた全キャラ。兄弟キャラのレベル低下・進化を
      // 画面が拾えるようにするための一覧
      charChanges,
    },
  };
}

/** 確定済み記録の回数を直す */
export function editRecord(player, { recordId, count, now }) {
  return applyRecordChange(player, {
    recordId, count, now, remove: false,
  });
}

/** 確定済み記録を消す（EXPは渡した分だけ引き戻す） */
export function deleteRecord(player, { recordId, now }) {
  return applyRecordChange(player, {
    recordId, count: null, now, remove: true,
  });
}

/** 承認待ちを削除する（EXPは動かない） */
export function rejectPending(player, pendingId) {
  const next = clone(player);
  next.pending = next.pending.filter((q) => q.id !== pendingId);
  return next;
}

/**
 * 育成キャラを切り替える。
 *
 * 控えのあいだは、条件を満たしていても進化を実現させない（絵も変えない）ため、
 * **切り替えたこの瞬間が、控えのキャラが進化する唯一のタイミング**になる
 * （2026-07-28 安部さんの判断）。潜在段階が実現段階を上回っていれば、
 * その間の段階をすべて evolvedStages に積んで演出用の値を返す。
 *
 * 途中の段階も埋めるのは、evolvedStages が「もう見せた段階」を表すため。
 * 0→2 のときに 2 だけ積むと、あとで第1進化の演出が誤って出る。
 *
 * @returns {{player: object, result: {charId: string, stageBefore: number, evolvedTo: number|null}}}
 *   evolvedTo は「切り替えた瞬間に新しく進化したか」。進化しないなら null
 */
export function switchChar(player, charId) {
  charEntry(player, charId); // 手持ちになければ例外
  const next = clone(player);
  next.activeCharId = charId;

  const entry = next.chars.find((c) => c.charId === charId);
  const stageBefore = displayStageOf(next, charId);
  const potential = stageOf(next, charId);

  const evolvedTo = realizeEvolution(entry, stageBefore, potential);

  return { player: next, result: { charId, stageBefore, evolvedTo } };
}

/** 新しいキャラを受け取る（育成キャラは変わらない） */
export function claimUnlock(player, charId, now) {
  if (player.chars.some((c) => c.charId === charId)) {
    throw new Error(`already owned: ${charId}`);
  }
  getCharacter(charId); // 未知IDなら例外
  const next = clone(player);
  next.chars.push({ charId, nickname: null, exp: 0, unlockedAt: now, evolvedStages: [] });
  return next;
}

/** ニックネームを設定する（空文字なら解除） */
export function setNickname(player, charId, nickname) {
  charEntry(player, charId);
  const next = clone(player);
  const entry = next.chars.find((c) => c.charId === charId);
  const trimmed = String(nickname || '').trim();
  entry.nickname = trimmed === '' ? null : trimmed.slice(0, 10);
  return next;
}
