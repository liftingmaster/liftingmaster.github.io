import { getCharacter } from '../core/characters.js';

/** 形態ごとの体格 */
const BODY = [
  { headR: 20, headY: 34, bodyRx: 18, bodyRy: 16, bodyY: 66, legLen: 6, eyeR: 3.2 },
  { headR: 17, headY: 30, bodyRx: 21, bodyRy: 22, bodyY: 64, legLen: 12, eyeR: 3.0 },
  { headR: 15, headY: 26, bodyRx: 25, bodyRy: 27, bodyY: 62, legLen: 16, eyeR: 2.8 },
];

const SILHOUETTE = '#b9b9c4';
const ACCENT = '#ff4d6d';

/** 色を暗く／明るくする（#rrggbb 前提） */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const next = Math.round(v + (amount > 0 ? (255 - v) * amount : v * amount));
    return Math.max(0, Math.min(255, next));
  });
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** 体・頭・目・口・足の共通骨格 */
function skeleton(p, palette) {
  const { main, dark, light } = palette;
  const bodyTop = p.bodyY - p.bodyRy;
  const legY = p.bodyY + p.bodyRy - 2;
  return `
  <ellipse cx="50" cy="${p.bodyY}" rx="${p.bodyRx}" ry="${p.bodyRy}" fill="${main}"/>
  <ellipse cx="50" cy="${p.bodyY + 3}" rx="${p.bodyRx * 0.6}" ry="${p.bodyRy * 0.6}" fill="${light}"/>
  <rect x="${50 - p.bodyRx * 0.55}" y="${legY}" width="7" height="${p.legLen}" rx="3.5" fill="${dark}"/>
  <rect x="${50 + p.bodyRx * 0.55 - 7}" y="${legY}" width="7" height="${p.legLen}" rx="3.5" fill="${dark}"/>
  <circle cx="50" cy="${p.headY}" r="${p.headR}" fill="${main}"/>
  <circle cx="${50 - p.headR * 0.38}" cy="${p.headY - 2}" r="${p.eyeR}" fill="#2b2b33"/>
  <circle cx="${50 + p.headR * 0.38}" cy="${p.headY - 2}" r="${p.eyeR}" fill="#2b2b33"/>
  <circle cx="${50 - p.headR * 0.38 + 1}" cy="${p.headY - 3.2}" r="${p.eyeR * 0.35}" fill="#ffffff"/>
  <circle cx="${50 + p.headR * 0.38 + 1}" cy="${p.headY - 3.2}" r="${p.eyeR * 0.35}" fill="#ffffff"/>
  <path d="M ${50 - 4} ${p.headY + p.headR * 0.35} q 4 4 8 0" stroke="#2b2b33" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <ellipse cx="50" cy="${bodyTop}" rx="0.1" ry="0.1" fill="none"/>`;
}

/** 第2進化のオーラ */
function aura(palette) {
  return `<circle cx="50" cy="52" r="46" fill="none" stroke="${palette.light}" stroke-width="2" opacity="0.5"/>`;
}

/** キャラ固有パーツ。stage 0/1/2 で増えていく */
const PARTS = {
  hinoko: (s, c) => `
    <path d="M ${62 + s * 2} 70 q 14 -10 6 -24 q 10 12 -2 26 z" fill="${c.main}"/>
    ${s >= 1 ? `<path d="M ${64 + s * 2} 60 q 10 -8 5 -18 q 7 9 -1 19 z" fill="${c.light}"/>` : ''}
    ${s >= 2 ? `<path d="M 26 44 q -8 -10 -2 -18 q 6 8 4 18 z" fill="${c.main}"/>
                <path d="M 74 44 q 8 -10 2 -18 q -6 8 -4 18 z" fill="${c.main}"/>` : ''}`,

  shizuku: (s, c) => `
    <path d="M 50 ${8 + s * 2} q 7 10 0 15 q -7 -5 0 -15 z" fill="${c.light}"/>
    ${s >= 1 ? `<path d="M 24 68 q -12 4 -12 14 q 12 -2 14 -10 z" fill="${c.light}"/>
                <path d="M 76 68 q 12 4 12 14 q -12 -2 -14 -10 z" fill="${c.light}"/>` : ''}
    ${s >= 2 ? `<circle cx="30" cy="34" r="4" fill="${c.light}" opacity="0.8"/>
                <circle cx="70" cy="30" r="5" fill="${c.light}" opacity="0.8"/>` : ''}`,

  happa: (s, c) => `
    <path d="M 50 ${12 + s * 2} q 12 -8 16 2 q -10 8 -16 -2 z" fill="${c.dark}"/>
    ${s >= 1 ? `<path d="M 50 ${16 + s * 2} q -14 -8 -18 3 q 12 8 18 -3 z" fill="${c.dark}"/>` : ''}
    ${s >= 2 ? `<path d="M 22 66 q -10 -12 0 -18 q 6 10 4 18 z" fill="${c.dark}"/>
                <path d="M 78 66 q 10 -12 0 -18 q -6 10 -4 18 z" fill="${c.dark}"/>` : ''}`,

  pikari: (s, c) => `
    <path d="M 37 ${18 - s} l 0 8" stroke="${c.dark}" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="37" cy="${15 - s}" r="2.6" fill="${c.light}"/>
    <path d="M 63 ${18 - s} l 0 8" stroke="${c.dark}" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="63" cy="${15 - s}" r="2.6" fill="${c.light}"/>
    ${s >= 1 ? `<path d="M 78 58 q 9 -3 7 6 M 81 68 q 9 1 6 9" stroke="${c.main}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` : ''}
    ${s >= 2 ? `<circle cx="19" cy="48" r="4.4" fill="${c.light}" opacity="0.85"/>
                <path d="M 19 40 l 0 -5 M 19 56 l 0 5 M 11 48 l -5 0 M 27 48 l 5 0 M 13 42 l -4 -4 M 25 42 l 4 -4 M 13 54 l -4 4 M 25 54 l 4 4" stroke="${c.light}" stroke-width="1.4" stroke-linecap="round"/>` : ''}`,

  mokumo: (s, c) => `
    <ellipse cx="50" cy="${88 - s}" rx="${20 + s * 4}" ry="7" fill="${c.light}" opacity="0.85"/>
    ${s >= 1 ? `<path d="M 22 56 q -14 -6 -16 6 q 12 6 18 0 z" fill="${c.light}"/>
                <path d="M 78 56 q 14 -6 16 6 q -12 6 -18 0 z" fill="${c.light}"/>` : ''}
    ${s >= 2 ? `<ellipse cx="26" cy="24" rx="9" ry="6" fill="${c.light}" opacity="0.7"/>
                <ellipse cx="74" cy="20" rx="11" ry="7" fill="${c.light}" opacity="0.7"/>` : ''}`,

  kirara: (s, c) => `
    <path d="M 50 ${10 + s} l 3 7 l 7 1 l -5 5 l 1 7 l -6 -4 l -6 4 l 1 -7 l -5 -5 l 7 -1 z" fill="${c.light}"/>
    ${s >= 1 ? `<path d="M 22 40 l 2 4 l 4 1 l -3 3 l 1 4 l -4 -2 l -4 2 l 1 -4 l -3 -3 l 4 -1 z" fill="${c.light}"/>` : ''}
    ${s >= 2 ? `<path d="M 80 34 l 2 5 l 5 1 l -4 4 l 1 5 l -4 -3 l -5 3 l 1 -5 l -4 -4 l 5 -1 z" fill="${c.light}"/>
                <path d="M 84 68 l 2 4 l 4 1 l -3 3 l 1 4 l -4 -2 l -4 2 l 1 -4 l -3 -3 l 4 -1 z" fill="${c.light}"/>` : ''}`,

  ganro: (s, c) => `
    <path d="M 50 ${10 - s * 2} l -9 16 l 18 0 z" fill="${c.dark}"/>
    ${s >= 1 ? `<path d="M 28 ${18 - s} l -9 15 l 15 -2 z" fill="${c.dark}"/>
                <path d="M 72 ${18 - s} l 9 15 l -15 -2 z" fill="${c.dark}"/>` : ''}
    ${s >= 2 ? `<path d="M 20 74 l 8 -8 l 8 8 z" fill="${c.dark}"/>
                <path d="M 66 76 l 9 -9 l 9 9 z" fill="${c.dark}"/>` : ''}`,

  kooru: (s, c) => `
    <path d="M 50 ${10 + s} l 0 14 M 44 ${14 + s} l 12 6 M 56 ${14 + s} l -12 6" stroke="${c.light}" stroke-width="2.4" stroke-linecap="round"/>
    ${s >= 1 ? `<path d="M 24 62 l 0 12 M 19 65 l 10 5 M 29 65 l -10 5" stroke="${c.light}" stroke-width="2" stroke-linecap="round"/>` : ''}
    ${s >= 2 ? `<path d="M 78 58 l 0 14 M 72 61 l 12 6 M 84 61 l -12 6" stroke="${c.light}" stroke-width="2.2" stroke-linecap="round"/>` : ''}`,

  kagero: (s, c) => `
    <ellipse cx="50" cy="${92 - s}" rx="${18 + s * 4}" ry="5" fill="${c.dark}" opacity="0.5"/>
    ${s >= 1 ? `<path d="M 24 40 q -10 -14 2 -22 q 2 12 6 20 z" fill="${c.dark}"/>
                <path d="M 76 40 q 10 -14 -2 -22 q -2 12 -6 20 z" fill="${c.dark}"/>` : ''}
    ${s >= 2 ? `<circle cx="26" cy="18" r="2.2" fill="${c.accent}"/>
                <circle cx="74" cy="18" r="2.2" fill="${c.accent}"/>` : ''}`,
};

/**
 * キャラのSVGを文字列で返す。
 * stage: 0=初期 / 1=第1進化 / 2=第2進化
 * options: { size = 100, silhouette = false }
 */
export function characterSvg(charId, stage, options = {}) {
  const char = getCharacter(charId);
  if (!Number.isInteger(stage) || stage < 0 || stage > 2) {
    throw new Error(`invalid stage: ${stage}`);
  }
  const { size = 100, silhouette = false } = options;

  const palette = silhouette
    ? { main: SILHOUETTE, dark: SILHOUETTE, light: SILHOUETTE, accent: SILHOUETTE }
    : { main: char.color, dark: shade(char.color, -0.3), light: shade(char.color, 0.45), accent: ACCENT };

  const p = BODY[stage];
  const parts = PARTS[charId];
  if (!parts) throw new Error(`no parts for character: ${charId}`);

  const body = silhouette
    ? `<ellipse cx="50" cy="${p.bodyY}" rx="${p.bodyRx}" ry="${p.bodyRy}" fill="${SILHOUETTE}"/>
       <circle cx="50" cy="${p.headY}" r="${p.headR}" fill="${SILHOUETTE}"/>`
    : skeleton(p, palette);

  const ariaLabel = silhouette ? 'みかいほうの キャラクター' : char.name;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${ariaLabel}">
  ${stage === 2 && !silhouette ? aura(palette) : ''}
  ${parts(stage, palette)}
  ${body}
</svg>`;
}
