import { svgFallback } from '../svg/character.js';

/**
 * 画像（<img>）の読み込みに失敗したとき、同じキャラ・形態のSVGに描き直す。
 *
 * <img> の error イベントはバブリングしないため、キャプチャ段階で1つだけ
 * 登録し、アプリが将来描く全ての <img>（今はひのこの3形態だけだが、
 * 画像化されるキャラが増えるほど自動的にカバーする）をここでまとめて拾う。
 * js/app.js の boot() から一度だけ呼ぶ。
 *
 * 状態を持たずに描き直せるよう、必要な情報は characterSvg() が <img> に
 * 埋め込んだ data-char-id / data-stage / data-size / data-silhouette から読む。
 */
export function installImgFallback(target = document) {
  target.addEventListener('error', (event) => {
    const img = event.target;
    if (!img || img.tagName !== 'IMG') return;
    const { charId, stage, size, silhouette } = img.dataset;
    if (!charId || stage === undefined) return; // このアプリのキャラ画像ではない

    // 差し替え後のSVGが何らかの理由でまた失敗しても、無限ループしないための印
    if (img.dataset.fallbackDone === '1') return;
    img.dataset.fallbackDone = '1';

    try {
      const svg = svgFallback(charId, Number(stage), {
        size: Number(size) || 100,
        silhouette: silhouette === 'true',
      });
      const wrapper = document.createElement('div');
      wrapper.innerHTML = svg;
      const svgEl = wrapper.firstElementChild;
      if (svgEl && img.parentNode) img.replaceWith(svgEl);
    } catch {
      // 描き直しにも失敗したら、壊れた画像アイコンのまま諦める
      // （ここで例外を投げ直すとアプリ全体が止まりかねないため握りつぶす）
    }
  }, true); // error はバブリングしないため capture 必須
}
