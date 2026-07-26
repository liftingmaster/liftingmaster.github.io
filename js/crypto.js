/**
 * 親の承認パスワード用のハッシュ化。
 * 「子供が画面操作だけでは突破できない」ことを目的とした割り切りであり、
 * 開発者ツールを使える人間に対する保護ではない（README に明記する）。
 */

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 16バイトのランダムな salt を hex で返す */
export function makeSalt() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** SHA-256(salt + text) を hex で返す */
export async function hashText(salt, text) {
  const data = new TextEncoder().encode(`${salt}:${text}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

/** ハッシュと照合する */
export async function verifyText(salt, hash, text) {
  if (typeof hash !== 'string' || hash === '') return false;
  return (await hashText(salt, text)) === hash;
}
