/**
 * 取り込んだキャラ画像を人が目で確認するためのページを作る。
 * 画像を base64 で埋め込むので、このHTML1枚だけで開ける。
 *
 *   node tools/make-art-preview.js hinoko
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CHARACTERS, getCharacter } from '../js/core/characters.js';
import { characterSvg } from '../js/svg/character.js';

const id = process.argv[2];
if (!id) {
  console.error('usage: node tools/make-art-preview.js <charId>');
  process.exit(2);
}
const char = getCharacter(id);

const dataUri = (n) => `data:image/png;base64,${readFileSync(`js/img/${id}-${n}.png`).toString('base64')}`;
const imgs = [0, 1, 2].map(dataUri);
const stageName = ['さいしょ', 'だい1しんか', 'だい2しんか'];

const row = (title, note, cell) => `
  <section>
    <h2>${title}</h2>
    <p class="note">${note}</p>
    <div class="row">${[0, 1, 2].map((s) => `<figure>${cell(s)}<figcaption>${stageName[s]}</figcaption></figure>`).join('')}</div>
  </section>`;

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${char.name} の絵の確認</title>
<style>
  body { font-family: "Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif; background:#fff; color:#2b2b33; margin:0; padding:24px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:17px; margin:0 0 4px; }
  .lead { color:#666; margin:0 0 24px; font-size:14px; }
  section { margin-bottom:32px; padding-bottom:24px; border-bottom:1px solid #eee; }
  .note { color:#888; font-size:13px; margin:0 0 12px; }
  .row { display:flex; gap:20px; flex-wrap:wrap; align-items:flex-end; }
  figure { margin:0; text-align:center; }
  figcaption { font-size:12px; color:#888; margin-top:6px; }
  .checker { background-image:
      linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),
      linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%);
    background-size:16px 16px; background-position:0 0,0 8px,8px -8px,-8px 0px; }
  .appbg { background:#f4f7fb; }
  .card { background:#fff; border-radius:18px; box-shadow:0 2px 10px rgba(40,50,70,.10); padding:12px; }
  img { display:block; }
  .sil { filter: grayscale(1) brightness(0) opacity(.28); }
  .sizes { display:flex; gap:24px; align-items:flex-end; }
</style></head><body>

<h1>${char.name}（${char.type}）の絵の確認</h1>
<p class="lead">背景を自動で透過にしました。以下を見て、そのまま使えるか判断してください。</p>

${row('1. 透過の確認（市松模様の上）',
  '市松模様がキャラの周りにきちんと見えていればOK。灰色の四角い縁や、もやが残っていたら失敗です。',
  (s) => `<div class="checker" style="padding:8px"><img src="${imgs[s]}" width="220" height="220"></div>`)}

${row('2. アプリの背景の上（実物大）',
  'ホーム画面では200pxで表示されます。縁に灰色のふちどりが出ていないか見てください。',
  (s) => `<div class="appbg card"><img src="${imgs[s]}" width="200" height="200"></div>`)}

${row('3. ずかんの未解放シルエット',
  'まだ手に入れていないキャラはこの見え方になります。形が分かる影になっていればOK。',
  (s) => `<div class="card" style="background:#fff"><img class="sil" src="${imgs[s]}" width="120" height="120"></div>`)}

${row('4. いまのコードで描いている絵（比較用）',
  '差し替え前の状態です。見比べてください。',
  (s) => `<div class="appbg card">${characterSvg(id, s, { size: 200 })}</div>`)}

<section style="border:none">
  <h2>5. 小さく表示したとき</h2>
  <p class="note">なかま画面は100px、ずかん一覧は90pxです。この大きさで何のキャラか分かるかを見てください。</p>
  <div class="sizes">
    ${[200, 160, 100, 90, 86].map((px) => `<figure><div class="appbg card"><img src="${imgs[2]}" width="${px}" height="${px}"></div><figcaption>${px}px</figcaption></figure>`).join('')}
  </div>
</section>

</body></html>`;

writeFileSync(`tools/art-preview-${id}.html`, html);
console.log(`tools/art-preview-${id}.html を作りました（${(html.length / 1024).toFixed(0)}KB）`);
