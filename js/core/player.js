import { levelFromExp } from './exp.js';
import { personalBest, recordedDates } from './stats.js';
import { currentStreak, longestStreak } from './streak.js';
import { evolutionStage, evolutionProgress } from './evolution.js';
import { pendingUnlocks, nextUnlock } from './unlock.js';
import { computeGain, pickDayWinnerMode, EXP_MODES } from './gain.js';
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

/**
 * evolvedStages の配列から「実際に演出済みの段階」を 0〜2 に丸めて取り出す。
 *
 * displayStageOf と maxEvolvedStageEver の共通処理。evolvedStages は手編集
 * バックアップから来ることがあるので、真偽値・文字列・undefined などの
 * 非数値混入を Number.isFinite で除外してから Math.max/Math.min で丸める
 * （2026-07-30 欠陥3。displayStageOf 側の丸めと食い違うと、片方は絵を
 * 出せるのにもう片方（ぴかりの解放判定）だけ NaN で壊れる、という矛盾が起きる）。
 */
function clampedStages(evolvedStages) {
  return Array.isArray(evolvedStages)
    ? evolvedStages.filter((s) => Number.isFinite(s))
    : [];
}

/**
 * これまでに「実現した」（evolvedStages に積まれた）進化段階の最大値。
 *
 * 2026-07-30: ぴかりの解放条件（unlockOnEvolvedStage）の判定に使う。
 * stageOf（潜在段階）ではなく evolvedStages を見るのは、控えのキャラが
 * 条件を満たしただけでは解放してはいけないため（進化ゲートと同じ理由）。
 * evolvedStages が無い/空のキャラは無視するので、誰も進化していなければ 0。
 */
export function maxEvolvedStageEver(player) {
  return player.chars.reduce((max, c) => {
    const shown = clampedStages(c.evolvedStages);
    return Math.max(max, Math.min(2, Math.max(0, ...shown)));
  }, 0);
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
  const shown = clampedStages(entry.evolvedStages);
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

/**
 * 確定記録を1件足してEXPを反映する。addRecord と approvePending の共通処理。
 *
 * 2026-07-28（EXP頭打ちルール）から**その日全体のリプレイ**になった。
 * 単発の diff のままだと、あとから足した記録が「すでに確定済みの記録の
 * grantedExp を遡って0にする」（＝敗者モードにする）ことができない。
 * editRecord / deleteRecord とまったく同じ「対称な before/after リプレイ」に寄せてある。
 *
 * result.exp は**この記録自身の grantedExp**（＝日の勝敗まで織り込んだ最終値）。
 * キャラのEXPの実際の増分とは一致しないことがある（すでにその日の別の記録が
 * EXPを取っている場合、その分は差し引かれる）。画面はキャラの増減が要るなら
 * levelBefore/levelAfter・charChanges を見ること。
 */
function commitRecord(player, record) {
  const next = clone(player);
  const entry = next.chars.find((c) => c.charId === next.activeCharId);

  const levelBefore = levelFromExp(entry.exp).level;
  const stageBefore = stageOf(next, entry.charId);
  const snapshots = new Map(next.chars.map((c) => [c.charId, {
    exp: c.exp,
    level: levelFromExp(c.exp).level,
    stage: stageOf(next, c.charId),
  }]));

  // 自己ベスト判定は既存どおり「この記録以外の全履歴（モード別）」で見る。
  // モード間の勝敗（頭打ち）には関与させない
  const isPersonalBest = record.count > personalBest(next.records, record.mode);

  // どのキャラに何EXP渡したかを記録自身に残す。あとで「なおす／けす」をしたときに、
  // 推定ではなく正確に引き直せるのはこの2つがあるおかげ（仕様 §2.2.2）
  const added = { ...record, charId: entry.charId, grantedExp: 0 };
  const beforeRecords = next.records.map((r) => ({ ...r }));
  next.records.push(added);

  const ownedIdSet = new Set(next.chars.map((c) => c.charId));
  // 並び順は**常に createdAt 順**。以前は「いま足した記録をこのリプレイでは最後に置く」
  // 例外があったが、これが保存則を破っていた（2026-07-29 欠陥1）。手順 k の after は
  // 「足した記録が最後」の並び、手順 k+1 の before は createdAt 順の並びになるため、
  // **同じ記録集合なのに before_{k+1} ≠ after_k** となり、差分が打ち消し合わない。
  // 承認を21:00→15:00→09:00の順に押すだけでEXPが無から生まれていた。
  //
  // 例外は「承認の順番で合計EXPが変わる」旧挙動を守るために入れられたものだが、
  // その日全体のリプレイになった今は**承認順でEXPが変わらないほうが正しい**
  // （親がどのボタンを先に押すかで子供のEXPが変わってはいけない。2026-07-29 安部さんの判断）。
  const cmp = makeOrderCmp(next.records);
  const baseExp = baseExpOf(next, ownedIdSet);
  const groupIds = dayIds(next.records, record.date);

  const beforeSpecs = dayMemberSpecs(beforeRecords, record.date, ownedIdSet);
  const afterSpecs = dayMemberSpecs(next.records, record.date, ownedIdSet);

  const beforeRun = replayDay(beforeRecords, beforeSpecs, baseExp, cmp, groupIds);
  const afterRun = replayDay(next.records, afterSpecs, baseExp, cmp, groupIds);

  settleDay(next, {
    beforeRecords, beforeSpecs, beforeRun, afterSpecs, afterRun,
  });

  const levelAfter = levelFromExp(entry.exp).level;
  const stageAfter = stageOf(next, entry.charId);

  // 進化を実現させるのは育成中のキャラだけ（2026-07-28 安部さんの判断）
  const evolvedTo = realizeEvolution(entry, stageBefore, stageAfter);

  // その日の勝敗が反転すると、直接触っていない兄弟キャラのEXPまで動く。
  // 確認ダイアログ・演出のために全部報告する（editRecord と同じ契約）
  const charChanges = [];
  for (const c of next.chars) {
    const snap = snapshots.get(c.charId);
    const expDelta = c.exp - snap.exp;
    const charEvolvedTo = c.charId === entry.charId ? evolvedTo : null;
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

  const ownedIds = next.chars.map((c) => c.charId);
  const unlocks = pendingUnlocks(maxLevelEver(next), ownedIds, maxEvolvedStageEver(next));

  return {
    player: next,
    result: {
      queued: false,
      exp: added.grantedExp,
      isPersonalBest,
      levelBefore,
      levelAfter,
      evolvedTo,
      unlocks,
      // その日のEXPを取ったモード。'+0 EXP' の理由を画面が出し分けるのに使う
      dayWinnerMode: afterRun.winnerMode,
      charChanges,
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
        unlocks: pendingUnlocks(maxLevelEver(next), ownedIds, maxEvolvedStageEver(next)),
        // 承認待ちの時点ではEXPは動かないので、日の勝敗もまだ決まらない
        dayWinnerMode: null,
        charChanges: [],
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

/** その日の記録すべての id（EXP頭打ちルールのグループ単位） */
function dayIds(records, date) {
  return new Set(records.filter((r) => r.date === date).map((r) => r.id));
}

/**
 * その日1日ぶんを「空の状態から」リプレイして、勝者モード・キャラごとの付与合計・
 * 各メンバーの grantedExp を出す。records は書き換えない。
 *
 * グループの単位は **「その日全体」**（2026-07-28 EXP頭打ちルール）。
 * 以前は「日付＋モード」だったが、モードをまたいで勝敗を決める必要があるので広げた。
 * そのためモードだけでなく**キャラも跨いだ引き直し**が起きる（育成中でない兄弟キャラの
 * EXPが、直接触っていない記録の勝敗反転で動く）。呼び出し側は charChanges で全部報告する。
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
 *   - その日の外の記録: 記録に保存されている grantedExp
 * を足していく（running）。グループ外の記録を足し忘れると baseExp が実質
 * 「今のレベル」になり、Lv1のときに付けた はっぱ の記録を高レベルで消すと
 * すくすく（×2）が外れて渡した分の半分しか引き戻せない、といったズレが出る。
 *
 * running は**モードごとに分岐**させる。両モードとも「その日の付与ぶんを除いた
 * 同じ水準」から評価しないと、先に処理したモードがすくすく（Lv20以下）を使い切って
 * 後のモードだけ倍率が落ち、**入力の順番で結果が変わる**（旧実装の 1250 vs 1150）。
 * その日の記録は、そのモードの分岐にだけ積む。
 *
 * totals は**勝者モードだけ**のキャラ別合計（＝差分に使う額）。敗者モードの
 * メンバーは granted が 0 になる。
 */
function replayDay(records, specs, baseExp, cmp, groupIds) {
  const ownerOf = new Map(specs.map((s) => [s.id, s.charId]));
  const running = new Map(EXP_MODES.map((m) => [m, new Map(baseExp)]));
  const modeTotals = new Map(EXP_MODES.map((m) => [m, new Map()]));
  const granted = new Map();
  const acc = [];
  for (const r of [...records].sort(cmp)) {
    const charId = ownerOf.get(r.id);
    const run = running.get(r.mode);
    if (charId !== undefined && run) {
      const gain = computeGain({
        records: acc, record: r, charId, charExp: run.get(charId) || 0,
      });
      run.set(charId, (run.get(charId) || 0) + gain.exp);
      const totals = modeTotals.get(r.mode);
      totals.set(charId, (totals.get(charId) || 0) + gain.exp);
      granted.set(r.id, gain.exp);
    } else if (!groupIds.has(r.id) && Number.isFinite(r.grantedExp)) {
      // その日の外・非メンバーの記録は計算し直さない。保存されている値をそのまま
      // 積んで、次のメンバーが「当時の水準」で判定されるようにするだけ。
      // その日の記録は（メンバーでなくても）積まない。積むと「その日の付与ぶんを
      // 除いた水準で両モードを評価する」という前提が崩れる
      for (const m of EXP_MODES) {
        const branch = running.get(m);
        if (branch.has(r.charId)) branch.set(r.charId, branch.get(r.charId) + r.grantedExp);
      }
    }
    acc.push(r);
  }

  const sumOf = (m) => [...modeTotals.get(m).values()].reduce((s, v) => s + v, 0);
  const winnerMode = pickDayWinnerMode({ no: sumOf('no'), one: sumOf('one') });

  // 敗者モードの記録は残るが grantedExp は全部 0（「一番よかった記録1つぶん」だけ）
  for (const s of specs) {
    const rec = records.find((r) => r.id === s.id);
    if (rec && rec.mode !== winnerMode) granted.set(s.id, 0);
  }

  return { totals: modeTotals.get(winnerMode), granted, winnerMode };
}

/**
 * 「その日、そのキャラから取り返す額」をキャラごとに数える。
 *
 * **before は常に「保存値」＝その日の記録に実際に書かれている grantedExp の合計**
 * （2026-07-29 安部さんの指示に差し戻し）。唯一の例外は、額そのものが残っていない
 * 旧データ（v9以前・手編集バックアップ由来で grantedExp が数値でないもの）で、
 * これだけは before 側のリプレイ値で見積もる。
 *
 * この関数は settleDay と対で「記録に書き戻す額」と「expから引く額」を必ず一致させる
 * ためにある。settleDay は afterSpecs の grantedExp を**リプレイ値で無条件に上書き**
 * するので、before をリプレイ値にすると「記録からは消えたのに exp には反映されない差額」
 * が生まれる。保存値で引けば、記録の増減と exp の増減が定義上つねに一致する
 * （exp_new = exp_old − Σ保存値 + Σリプレイ値、記録の合計も同じだけ動く）。
 *
 * ■ 2026-07-29 に一度これを外して失敗した経緯（同じ穴を掘らないための記録）
 * 直前の実装は「isLegacyDay（＝敗者モードなのに0でない値が残っている日）は保存値、
 * それ以外の日は before 側のリプレイ値」と**日ごとに帳簿を切り替えて**いた。理由は
 * 「保存値にすると recordEditSymmetric の S1〜S4 が落ちるから」だったが、その4本は
 * テスト名からして「既知の残留・割り切りの固定」で、コメントに「あるべきは45」と
 * 書いてあった。**あるべき値ではなく割り切りを固定したテスト**を根拠に指示を退けた
 * のが誤りで、差し戻しでその割り切りは3つとも消えた（S1 102→90、S2 2850→2250、
 * S3 0→45）。
 *
 * 切り替え方式が壊れていた理由は2つ。
 *  1. isLegacyDay が見ているのは帳簿の**「形」**であって**「額」が古いか**ではない。
 *     別の日の編集・追加でリプレイ上すくすく(Lv20)／きらめき(Lv50)の線をまたぐと、
 *     形は v11 のまま額だけ古くなり、判定をすり抜けて差額が漏れる。
 *  2. 逆に、v10 のデータが1件も無くても true になる（保存時とリプレイで勝者モードが
 *     入れ替わると、v11 の正しい勝者記録が「敗者なのに0でない」に見える）。
 * 実測（同じ乱数列・20,000セッション）での保存則の破れは、切り替え方式 184件・
 * その前の混成方式 369件に対し、**保存値に統一すると 0 件**だった。
 */
function grantedBeforeByChar(records, specs, beforeRun) {
  const before = new Map();
  for (const s of specs) {
    const rec = records.find((r) => r.id === s.id);
    if (!rec) continue;
    const actual = Number.isFinite(rec.grantedExp)
      ? rec.grantedExp
      : (beforeRun.granted.get(s.id) || 0); // 額が残っていない旧データだけ推定
    before.set(s.charId, (before.get(s.charId) || 0) + actual);
  }
  return before;
}

/**
 * before/after の2回のリプレイ結果を突き合わせて、
 * 各記録の grantedExp と各キャラの exp を確定する。
 *
 * exp = max(0, exp − before + after)。**クランプはここ1回だけ**。
 * 途中でクランプすると、引ききれなかった負債が消えて無からEXPが生まれる。
 *
 * before は**常に保存値**（grantedBeforeByChar）。after は引き直した値。
 * 直下のループが afterSpecs の grantedExp をリプレイ値で上書きするので、
 * この2つを揃えておくことで「記録の合計の増減」と「expの増減」が必ず一致する。
 *
 * ■ 既知の制約（2026-07-29・未修正）: baseExpOf のクランプとの噛み合わせ
 * 「クランプは最終結果に1回だけ」と書いてあるが、実際には baseExpOf 自身が
 * `Math.max(0, c.exp − grantedByChar)` という**独立した2つ目のクランプ**を持っている。
 * 別グループの削除で exp が 0 に張り付いた（負債が切り捨てられた）あと、その負債は
 * どこにも記録されないまま baseExp だけが 0 に持ち上がる。そこへ「保存値どおりに
 * 取り消す」before を当てると、切り捨てられた負債のぶんが**逆に湧く**
 * （recordEditSymmetric.test.js の I5 で +87。差し戻し前の混成方式では +4 だった）。
 * これは before を保存値にするかリプレイ値にするかとは無関係の別種の穴で、
 * 塞ぐには「クランプが効いた時点でその日の保存 grantedExp も辻褄が合うよう落とす」など
 * 帳簿そのものを書き換える必要がある（＝クランプに当たった瞬間に、触っていない日の
 * 記録の grantedExp を勝手に減らす）。影響範囲が「触っていない記録の書き換え」まで
 * 広がるため、安部さんの判断を待つ扱いにして塞いでいない。
 * 「EXPを引ききれないときは溶けるときは溶かす」（＝クランプ自体は許容）は既に
 * 判断済みだが、**逆に湧くのは別の話**なので、判断の経緯ごとここに残す。
 */
function settleDay(next, { beforeRecords, beforeSpecs, beforeRun, afterSpecs, afterRun }) {
  const before = grantedBeforeByChar(beforeRecords, beforeSpecs, beforeRun);

  for (const s of afterSpecs) {
    const rec = next.records.find((r) => r.id === s.id);
    if (rec) rec.grantedExp = afterRun.granted.get(s.id) || 0;
  }

  for (const c of next.chars) {
    const diff = (afterRun.totals.get(c.charId) || 0) - (before.get(c.charId) || 0);
    if (diff !== 0) c.exp = Math.max(0, c.exp + diff);
  }
}

/**
 * リプレイの出発点。**全記録**の grantedExp を引いた「何も記録していなかったころの水準」。
 * その日の中だけを引くと、あとから積んだEXPが残って実質「今のレベル」になり、
 * 「いつ直したか」で結果が変わってしまう（はっぱ・きらら）。
 * before/after で同じ値を使うことで、引く基準と足す基準のずれも防ぐ。
 *
 * ここの `Math.max(0, …)` は settleDay の最終クランプとは**別の2つ目のクランプ**で、
 * 「クランプは最終結果に1回だけ」という設計方針の外側にある。既知の穴の説明は
 * settleDay のコメントを参照（I5 の +87）。
 */
function baseExpOf(next, ownedIds) {
  const grantedByChar = new Map();
  for (const r of next.records) {
    if (Number.isFinite(r.grantedExp) && ownedIds.has(r.charId)) {
      grantedByChar.set(r.charId, (grantedByChar.get(r.charId) || 0) + r.grantedExp);
    }
  }
  return new Map(next.chars.map(
    (c) => [c.charId, Math.max(0, c.exp - (grantedByChar.get(c.charId) || 0))],
  ));
}

/** その日のメンバー（EXPの帰属先が確定している記録）。extraId は対象記録の強制参加用 */
function dayMemberSpecs(records, date, ownedIds, { extraId = null, extraCharId = null } = {}) {
  return records
    .filter((r) => r.date === date)
    .filter((r) => r.id === extraId || (Number.isFinite(r.grantedExp) && ownedIds.has(r.charId)))
    .map((r) => ({ id: r.id, charId: r.id === extraId ? extraCharId : r.charId }));
}

/**
 * 確定済み記録1件の回数訂正・削除の共通処理。
 *
 * 方式は「対称な before/after リプレイ」（2026-07-28 第2回改訂）。
 * グループの単位は 2026-07-28 の EXP頭打ちルールで「日付＋モード」から
 * **「その日全体」**に広がった。**変更前と変更後でまったく同じやり方で
 * 2回リプレイし、その差分だけ**をキャラのEXPに反映する。
 *
 *   1. リプレイ対象 = その日の新データ全部（モード問わず）＋ 対象記録 R 自身
 *      （R が旧データなら持ち主は activeCharId。R 以外の旧データの兄弟は
 *      対象にしない＝EXPを動かさないが、dailyBest などの文脈には参加する）
 *   2. baseExp[c] = max(0, c.exp − そのキャラの**全記録**の grantedExp 合計)。
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
  const { date } = target;

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
  const groupIds = dayIds(next.records, date);

  const memberSpecs = dayMemberSpecs(next.records, date, ownedIds, {
    extraId: recordId, extraCharId: ownerOfTarget,
  });

  const baseExp = baseExpOf(next, ownedIds);

  // before: いまの回数のままリプレイ（records は触らずコピーの上で回す）
  const beforeRecords = next.records.map((r) => ({ ...r }));
  const beforeRun = replayDay(beforeRecords, memberSpecs, baseExp, cmp, groupIds);

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
  const afterRun = replayDay(next.records, afterSpecs, baseExp, cmp, groupIds);

  settleDay(next, {
    beforeRecords, beforeSpecs: memberSpecs, beforeRun, afterSpecs, afterRun,
  });

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
      // その日のEXPを取ったモード（EXP頭打ちルール）
      dayWinnerMode: afterRun.winnerMode,
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
