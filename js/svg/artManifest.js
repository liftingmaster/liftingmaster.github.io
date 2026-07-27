/**
 * どのキャラの・どの形態に、生成した画像（PNG）が用意されているかを1か所で管理する。
 *
 * キャラは今まで全部 SVG（js/svg/character.js のコード）で描いていたが、
 * 見た目を良くするため1体ずつ画像に差し替えていく。差し替え中は画像を持つキャラと
 * 持たないキャラが混在するため、`characterSvg` はここを見て描き分ける。
 *
 * 次のキャラを画像化するときは、ART にキーを1行足すだけでよい
 * （例: shizuku: [0, 1, 2]）。画像ファイル本体は js/img/ に置き、
 * sw.js の ASSETS にも忘れず追加すること（README「配布まえの確認」参照）。
 */
export const ART = {
  hinoko: [0, 1, 2],
};

/** そのキャラ・その形態に画像が用意されているか */
export function hasArt(charId, stage) {
  const stages = ART[charId];
  return Array.isArray(stages) && stages.includes(stage);
}

/**
 * 画像のパスを返す。index.html から見た相対パスで返す
 * （アプリは index.html だけから読み込まれるため）。
 */
export function artPath(charId, stage) {
  return `./js/img/${charId}-${stage}.png`;
}
