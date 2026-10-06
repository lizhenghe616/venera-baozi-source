const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../baozi.js'), 'utf8');
const host = 'https://www.baozimh.com';
function setup(setting) {
  const state = { calls: [], fixtures: {}, disposed: 0, response: null, postExtra: null, cookies: [] };
  const context = vm.createContext({
    ComicSource: class { loadSetting(key) { return key === 'image_server' ? setting : undefined; } },
    ComicDetails: class { constructor(value) { Object.assign(this, value); } },
    Cookie: class { constructor(value) { Object.assign(this, value); } },
    UI: { showMessage() {} },
    Convert: { decodeBase64: value => Uint8Array.from(Buffer.from(value, 'base64')) },
    Network: {
      get: async url => { state.calls.push(url); return state.response || { status: 200, body: url }; },
      post: async (url, headers, data, extra) => { state.postExtra = extra; return state.response || { status: 200, body: '{}' }; },
      setCookies: (url, cookies) => { state.cookies.push(...cookies); },
    },
    HtmlDocument: class {
      constructor(url) { this.fixture = state.fixtures[url] || {}; }
      querySelector() { return { text: '2026年10月6日', attributes: { src: 'https://static-tw.baozimh.com/cover/demo.jpg' } }; }
      querySelectorAll(selector) {
        if (this.fixture.fail) throw Error('fixture parse failure');
        if (selector.includes('amp-img')) return this.fixture.images || [];
        if (selector.includes('next_chapter')) return this.fixture.next || [];
        if (selector.includes('chapter-items') && selector.includes('> a')) return this.fixture.chapters || [];
        return [];
      }
      dispose() { state.disposed++; }
    },
  });
  vm.runInContext(source + '\nglobalThis.baozi = new Baozi();', context);
  return { b: context.baozi, state };
}
const image = url => ({ attributes: { src: url } });
const link = (url, text = '下一頁') => ({ attributes: { href: url }, text });

test('catalog metadata and update URL agree with the script', () => {
  const { b } = setup();
  const entry = JSON.parse(fs.readFileSync(path.join(__dirname, '../index.json')))[0];
  assert.equal(entry.key, b.key);
  assert.equal(entry.version, b.version);
  assert.equal(entry.name, b.name);
  assert.equal(entry.fileName, 'baozi.js');
  assert.equal(b.url, 'https://raw.githubusercontent.com/lizhenghe616/venera-baozi-source/main/baozi.js');
  assert.equal(b.baseUrl, host);
});

test('web verification rejects challenge and off-site pages', () => {
  const { b } = setup();
  const check = b.account.loginWithWebview.checkStatus;
  assert.equal(check(host + '/', '包子漫畫'), true);
  assert.equal(check(host + '/__gatekeeper_challenge/start', '包子漫畫'), false);
  assert.equal(check(host + '/', '包子漫画 安全验证'), false);
  assert.equal(check('https://www.baozimh.com.evil.example/', '包子漫畫'), false);
  assert.throws(() => b.checkResponse({ status: 403, body: '{"error":"challenge_required"}' }));
});

test('CDN fallback is finite and preserves the full image path', () => {
  const { b } = setup();
  const original = 'https://s1.bzcdn.net/scomic/demo/0/818/1.jpg?x=1';
  let config = b.comic.onImageLoad(original);
  const urls = [];
  while (config) {
    urls.push(config.url);
    assert.equal(config.headers.Referer, host + '/');
    config = config.onLoadFailed ? config.onLoadFailed() : null;
    assert(urls.length <= 3);
  }
  assert.deepEqual(urls, [
    'https://as.baozimh.com/scomic/demo/0/818/1.jpg?x=1',
    'https://as-rsa1-usla.baozicdn.com/scomic/demo/0/818/1.jpg?x=1',
    original,
  ]);
  const manual = setup('original').b.comic.onImageLoad(original);
  assert.equal(manual.url, original);
  assert.equal(manual.onLoadFailed, undefined);
  const unrelated = b.comic.onImageLoad('https://other.example/scomic/demo.jpg');
  assert.equal(unrelated.url, 'https://other.example/scomic/demo.jpg');
  assert.equal(unrelated.onLoadFailed, undefined);
});

test('actual chapter links support cross-server same-chapter pagination', async () => {
  const { b, state } = setup();
  const first = host + '/user/page_direct?comic_id=demo&section_slot=0&chapter_slot=818';
  const second = 'https://reader.baozimh.com/comic/chapter/demo/0_818_2.html';
  state.fixtures[first] = { images: [image('https://s1.bzcdn.net/1.jpg')], next: [link(second)] };
  state.fixtures[second] = { images: [image('https://s1.bzcdn.net/1.jpg'), image('https://s2.bzcdn.net/2.jpg')], next: [link('0_819.html', '下一章')] };
  assert.deepEqual(Array.from((await b.comic.loadEp('demo', first)).images), ['https://s1.bzcdn.net/1.jpg', 'https://s2.bzcdn.net/2.jpg']);
  assert.deepEqual(state.calls, [first, second]);
  assert.equal(state.disposed, 2);
  state.calls = [];
  await assert.rejects(b.comic.loadEp('demo', '0'));
  assert.equal(state.calls.length, 0);
});

test('entry requests reject mirrors but asset requests accept CDN URLs', async () => {
  const { b, state } = setup();
  await assert.rejects(b.getPage('https://cn.bzmgcn.com/'));
  assert.equal(state.calls.length, 0);
  assert.equal(b.resourceUrl('//s1.baozicdn.com/a.jpg'), 'https://s1.baozicdn.com/a.jpg');
  for (const value of ['javascript:alert(1)', 'file:///a', 'https://user:pass@host/a', 'https://good.example\\@bad.example/a']) assert.equal(b.resourceUrl(value), null);
});

test('covers are restored and HTML documents are always released', async () => {
  const { b, state } = setup();
  assert.equal(b.parseJsonComic({ topic_img: 'demo.jpg' }).cover, 'https://static-tw.baozimh.com/cover/demo.jpg');
  const details = await b.comic.loadInfo('demo');
  assert.equal(details.cover, 'https://static-tw.baozimh.com/cover/demo.jpg');
  assert.equal(state.disposed, 1);
  state.fixtures[host + '/search?q=bad'] = { fail: true };
  await assert.rejects(b.search.load('bad', [], 1));
  assert.equal(state.disposed, 2);
});

test('password request bodies are masked and invalid login tokens are rejected', async () => {
  const { b, state } = setup();
  state.response = { status: 200, body: '{"data":null}' };
  await assert.rejects(b.account.login('fixture-user', 'fixture-password'));
  assert.equal(state.postExtra.maskDataInLog, true);
  assert.equal(state.cookies.length, 0);
});
