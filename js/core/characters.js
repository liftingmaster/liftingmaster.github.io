/** モードごとのEXP係数 */
export const MODE_RATE = { no: 3, one: 1 };

/** 開始時に選べる御三家 */
export const STARTER_IDS = ['hinoko', 'shizuku', 'happa'];

/**
 * 9体のキャラ定義。
 * evolutions[].oneCount が null のときは、その段階はノーバウンドでしか進化できない。
 * 数値はゲームバランスの調整点。ここだけを変えれば難易度を調整できる。
 */
export const CHARACTERS = [
  {
    id: 'hinoko', no: 1, name: 'ひのこ', type: 'ほのお', color: '#ff6b3d',
    dexText: 'しっぽの ほのおは やるきの あかし。れんしゅうを がんばるほど おおきく もえあがる。',
    unlockLevel: 0,
    ability: { id: 'moeagaru', name: 'もえあがる', text: 'じこベストを こうしんした ときの EXPが 1.5ばい' },
    evolutions: [
      { stage: 1, level: 15, noCount: 15, oneCount: 50, streak: 5 },
      { stage: 2, level: 45, noCount: 40, oneCount: null, streak: 14 },
    ],
  },
  {
    id: 'shizuku', no: 2, name: 'しずく', type: 'みず', color: '#3d9bff',
    dexText: 'まいにち すこしずつ みずを ためて そだつ。あわてない せいかくで つづけることが とくい。',
    unlockLevel: 0,
    ability: { id: 'shimikomu', name: 'しみこむ', text: '3にち いじょう れんぞくで きろく している あいだ EXPが 1.2ばい' },
    evolutions: [
      { stage: 1, level: 12, noCount: 10, oneCount: 35, streak: 10 },
      { stage: 2, level: 40, noCount: 25, oneCount: null, streak: 30 },
    ],
  },
  {
    id: 'happa', no: 3, name: 'はっぱ', type: 'くさ', color: '#4caf50',
    dexText: 'せなかの はっぱは ひかりを あびると ぐんぐん のびる。ちいさい ころほど せいちょうが はやい。',
    unlockLevel: 0,
    ability: { id: 'sukusuku', name: 'すくすく', text: 'レベル20 いかの あいだ EXPが 2ばい' },
    evolutions: [
      { stage: 1, level: 18, noCount: 12, oneCount: 40, streak: 7 },
      { stage: 2, level: 50, noCount: 30, oneCount: null, streak: 20 },
    ],
  },
  {
    id: 'pikari', no: 4, name: 'ぴかり', type: 'でんき', color: '#ffd23d',
    dexText: 'いっしゅんの すばやさは だれにも まけない。ボールを おとさない しゅんぱつりょくを もつ。',
    unlockLevel: 30,
    ability: { id: 'inazuma', name: 'いなずま', text: 'ノーバウンドの EXPが 1.5ばい' },
    evolutions: [
      { stage: 1, level: 12, noCount: 20, oneCount: 70, streak: 3 },
      { stage: 2, level: 40, noCount: 60, oneCount: null, streak: 7 },
    ],
  },
  {
    id: 'mokumo', no: 5, name: 'もくも', type: 'そら', color: '#7fd4e8',
    dexText: 'くもに のって ふわふわ とぶ。ボールが はずむ リズムに あわせるのが じょうず。',
    unlockLevel: 40,
    ability: { id: 'fuwafuwa', name: 'ふわふわ', text: 'ワンバウンドの EXPが 2ばい' },
    evolutions: [
      { stage: 1, level: 15, noCount: 18, oneCount: 30, streak: 5 },
      { stage: 2, level: 45, noCount: 45, oneCount: null, streak: 14 },
    ],
  },
  {
    id: 'kirara', no: 6, name: 'きらら', type: 'ほし', color: '#b06bff',
    dexText: 'よぞらの ほしの かけらから うまれた。おおきく そだつほど つよく かがやきだす。',
    unlockLevel: 50,
    ability: { id: 'kirameki', name: 'きらめき', text: 'レベル50 いじょうの あいだ EXPが 1.5ばい' },
    evolutions: [
      { stage: 1, level: 25, noCount: 15, oneCount: 50, streak: 5 },
      { stage: 2, level: 60, noCount: 35, oneCount: null, streak: 14 },
    ],
  },
  {
    id: 'ganro', no: 7, name: 'がんろ', type: 'いわ', color: '#a0785a',
    dexText: 'おもい いわを せおって いても へこたれない。まいにち つづける ちからは いちばん。',
    unlockLevel: 65,
    ability: { id: 'dosshiri', name: 'どっしり', text: '10にち いじょう れんぞくで きろく している あいだ EXPが 1.5ばい' },
    evolutions: [
      { stage: 1, level: 10, noCount: 10, oneCount: 35, streak: 20 },
      { stage: 2, level: 35, noCount: 25, oneCount: null, streak: 50 },
    ],
  },
  {
    id: 'kooru', no: 8, name: 'こおる', type: 'こおり', color: '#6ad9d0',
    dexText: 'こおりの けっしょうを まとう。しずかに あいてを みつめ ここぞという ときに ちからを だす。',
    unlockLevel: 80,
    ability: { id: 'reisei', name: 'れいせい', text: 'ノーバウンドで 20かい いじょう だした ときの EXPが 2ばい' },
    evolutions: [
      { stage: 1, level: 20, noCount: 25, oneCount: 85, streak: 7 },
      { stage: 2, level: 55, noCount: 70, oneCount: null, streak: 21 },
    ],
  },
  {
    id: 'kagero', no: 9, name: 'かげろ', type: 'やみ', color: '#6b5b95',
    dexText: 'レベル100 に とうたつした ものの まえにだけ すがたを あらわす でんせつの そんざい。',
    unlockLevel: 100,
    ability: { id: 'yaminochikara', name: 'やみのちから', text: 'いつでも EXPが 1.3ばい' },
    evolutions: [
      { stage: 1, level: 30, noCount: 30, oneCount: 100, streak: 14 },
      { stage: 2, level: 70, noCount: 100, oneCount: null, streak: 30 },
    ],
  },
];

const BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

/** IDからキャラ定義を取り出す。未知のIDは例外 */
export function getCharacter(id) {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`unknown character id: ${id}`);
  return c;
}
