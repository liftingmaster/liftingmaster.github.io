/**
 * テスト用の最小 DOM シム。lifting-master の view（js/views/*.js）が実際に
 * 使っている API だけを実装する（createElement / innerHTML / querySelector /
 * addEventListener など）。jsdom 等の外部依存を増やさずに、DOMを直接触っている
 * render() 関数（例: js/views/recordInput.js, js/views/result.js）を
 * 実装コードを書き換えずに実際に駆動して検証するために使う。
 *
 * 対応していないもの（今のテストで不要なもの）は素直にエラーにするか、
 * 何もしない実装にしてある。新しい view を検証する際に足りない機能があれば
 * ここへ追加すること（js/ 配下の実装側は変更しない）。
 */

const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'source']);

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attributes = {};
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.style = new Proxy({}, { set: (t, k, v) => { t[k] = v; return true; } });
    this._text = '';
    this.disabled = false;
    this.value = '';
  }

  get id() { return this.attributes.id || ''; }

  set id(v) { this.attributes.id = v; }

  get className() { return this.attributes.class || ''; }

  set className(v) { this.attributes.class = v; }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(v) { this.children = []; this._text = String(v); }

  setAttribute(k, v) { this.attributes[k] = String(v); }

  getAttribute(k) { return this.attributes[k]; }

  appendChild(node) { node.parent = this; this.children.push(node); return node; }

  append(...nodes) { for (const n of nodes) this.appendChild(n); }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  get innerHTML() { return this._html || ''; }

  set innerHTML(html) {
    this._html = String(html);
    this._text = '';
    this.children = parseHtml(String(html)).map((n) => { n.parent = this; return n; });
  }

  insertAdjacentHTML(where, html) {
    if (where !== 'beforeend') throw new Error(`unsupported: ${where}`);
    for (const n of parseHtml(String(html))) this.appendChild(n);
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  /** テスト側から発火させる */
  fire(type, ev = {}) {
    for (const fn of this.listeners[type] || []) fn(ev);
  }

  focus() {}

  click() { this.fire('click'); }

  _walk(out = []) {
    for (const c of this.children) { out.push(c); c._walk(out); }
    return out;
  }

  matches(sel) {
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return this.className.split(/\s+/).includes(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }

  querySelector(sel) { return this._walk().find((n) => n.matches(sel)) || null; }

  querySelectorAll(sel) { return this._walk().filter((n) => n.matches(sel)); }
}

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*(\/?)>/g;

function parseAttrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) {
    if (m[1]) out[m[1]] = m[2] === undefined ? '' : m[2];
  }
  return out;
}

function parseHtml(html) {
  const rootChildren = [];
  const stack = [];
  let last = 0;
  const push = (node) => {
    if (stack.length === 0) rootChildren.push(node);
    else stack[stack.length - 1].appendChild(node);
  };
  const pushText = (text) => {
    if (!text.trim()) return;
    const t = new El('#text');
    t._text = text;
    push(t);
  };
  TAG_RE.lastIndex = 0;
  let m = TAG_RE.exec(html);
  while (m) {
    pushText(html.slice(last, m.index));
    const closing = m[0].startsWith('</');
    const tag = m[1].toLowerCase();
    if (closing) {
      // 対応する開始タグまで閉じる
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
      }
    } else {
      const el = new El(tag);
      el.attributes = parseAttrs(m[2] || '');
      push(el);
      if (!VOID.has(tag) && m[3] !== '/') stack.push(el);
    }
    last = m.index + m[0].length;
    m = TAG_RE.exec(html);
  }
  pushText(html.slice(last));
  return rootChildren;
}

/**
 * globalThis に最小限の document/window/localStorage/navigator を生やす。
 * node --test はテストファイルごとにプロセス/コンテキストを分けるため、
 * ここでの globalThis 汚染が他のテストファイルへ漏れることはない。
 */
export function installDom() {
  const document = {
    createElement: (tag) => new El(tag),
    body: new El('body'),
    getElementById: (id) => document.body.querySelector(`#${id}`),
    querySelectorAll: (sel) => document.body.querySelectorAll(sel),
    addEventListener() {},
  };
  const appRoot = new El('div');
  appRoot.id = 'app';
  document.body.appendChild(appRoot);

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  globalThis.document = document;
  globalThis.window = { scrollTo() {} };
  globalThis.localStorage = localStorage;
  Object.defineProperty(globalThis, 'navigator', {
    value: {}, writable: true, configurable: true,
  });
  globalThis.alert = (m) => { globalThis.__alerts.push(m); };
  globalThis.__alerts = [];
  return { document, appRoot, El };
}
