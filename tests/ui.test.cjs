// DOM integration tests exercise actual app.js against the real Python HTTP API.
// JSDOM does not verify browser rendering or downloads on disk.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawn, spawnSync} = require('node:child_process');
const {JSDOM} = require('jsdom');
const port = 20000 + Math.floor(Math.random() * 20000);
const origin = `http://127.0.0.1:${port}`;
let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let n = 0; n < 300; n++) {
    if (predicate()) return;
    await pause(20);
  }
  throw new Error('Timed out waiting for UI state.');
}
before(async () => {
  server = spawn(process.env.PYTHON || 'python3', ['-m', 'docx_ray.server', '--port', String(port)], {stdio:'pipe'});
  for (let n = 0; n < 100; n++) {
    try {if ((await fetch(`${origin}/api/health`)).ok) return;} catch {}
    await pause(30);
  }
  throw new Error('Python API did not start.');
});
after(() => server?.kill());
function app() {
  const dom = new JSDOM(fs.readFileSync('public/index.html', 'utf8'), {url:origin, runScripts:'outside-only'});
  const window = dom.window;
  const downloads = [];
  const blobs = new Map();
  let nextUrl = 0;
  window.File = File;
  window.Blob = Blob;
  window.AbortController = AbortController;
  window.fetch = (url, options) => fetch(new URL(url, origin), options);
  window.matchMedia = () => ({matches:true});
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.URL.createObjectURL = blob => {const url = `blob:test-${nextUrl++}`; blobs.set(url, blob); return url;};
  window.URL.revokeObjectURL = url => blobs.delete(url);
  window.HTMLAnchorElement.prototype.click = function() {downloads.push({name:this.download, blob:blobs.get(this.href)});};
  window.eval(fs.readFileSync('public/app.js', 'utf8'));
  const $ = id => window.document.getElementById(id);
  function upload(data, name='uploaded.docx') {
    Object.defineProperty($('file'), 'files', {configurable:true, value:[new File([data], name)]});
    $('file').dispatchEvent(new window.Event('change'));
  }
  return {window, $, downloads, upload, close:() => window.close()};
}
async function sample(ui) {
  ui.$('sample').click();
  await until(() => ui.$('status').textContent.startsWith('Inspected'));
}
test('sample inspection renders raw XML, stats, parts and steps', async () => {
  const ui = app();
  try {
    await sample(ui);
    assert.equal(ui.$('workspace').hidden, false);
    assert.equal(ui.$('filename').textContent, 'sample.docx');
    assert.equal(ui.$('steps').children.length, 5);
    assert.equal(ui.$('stats').children.length, 6);
    assert.match(ui.$('xml').textContent, /<w:document/);
    assert.match(ui.$('parts').textContent, /word\/styles.xml/);
  } finally {ui.close();}
});
test('filter and keyboard tabs expose paragraph-to-XML mapping and relationships', async () => {
  const ui = app();
  try {
    await sample(ui);
    ui.$('filter').value = 'styles.xml';
    ui.$('filter').dispatchEvent(new ui.window.Event('input'));
    assert.equal(ui.$('parts').children.length, 1);
    ui.$('parts').firstChild.click();
    assert.equal(ui.$('partname').textContent, 'word/styles.xml');
    ui.$('raw-tab').dispatchEvent(new ui.window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
    assert.equal(ui.$('visual-panel').hidden, false);
    ui.$('paragraphs').children[1].click();
    assert.match(ui.$('snippet').textContent, /Hello from DOCX Ray/);
    ui.$('relations-tab').click();
    assert.equal(ui.$('relations-panel').hidden, false);
    assert.match(ui.$('relations').textContent, /officeDocument/);
  } finally {ui.close();}
});
test('all-parts and single-part downloads contain original bytes', async () => {
  const ui = app();
  try {
    await sample(ui);
    ui.$('download').click();
    await until(() => ui.downloads.length === 1);
    assert.equal(ui.downloads[0].name, 'document.xml');
    assert.match(await ui.downloads[0].blob.text(), /<w:document/);
    await until(() => !ui.$('export').disabled);
    ui.$('export').click();
    await until(() => ui.downloads.length === 2);
    assert.equal(ui.downloads[1].name, 'docx-ray-xml.zip');
    const bytes = new Uint8Array(await ui.downloads[1].blob.arrayBuffer());
    assert.equal(String.fromCharCode(...bytes.slice(0,2)), 'PK');
  } finally {ui.close();}
});
test('invalid files and oversized files show useful errors', async () => {
  const ui = app();
  try {
    ui.upload('text', 'wrong.doc');
    assert.match(ui.$('status').textContent, /Choose a .docx/);
    ui.upload(new Uint8Array(3000001));
    assert.match(ui.$('status').textContent, /up to 3 MB/);
    ui.upload('not a zip');
    await until(() => ui.$('status').classList.contains('error') && !ui.$('file').disabled);
    assert.match(ui.$('status').textContent, /Invalid.*ZIP/);
    assert.equal(ui.$('workspace').hidden, true);
  } finally {ui.close();}
});
test('failed API requests clear busy state', async () => {
  const ui = app();
  try {
    ui.window.fetch = async () => {throw new Error('Network unavailable');};
    ui.upload(fs.readFileSync('public/sample.docx'));
    await until(() => ui.$('status').textContent === 'Network unavailable');
    assert.equal(ui.$('file').disabled, false);
    assert.equal(ui.$('sample').disabled, false);
  } finally {ui.close();}
});
test('document text containing markup stays text instead of executable DOM', async () => {
  const fixture = spawnSync('python3', ['-c', `
import io,sys,zipfile
out=io.BytesIO()
with zipfile.ZipFile('public/sample.docx') as src,zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as dst:
 for item in src.infolist():
  raw=src.read(item.filename)
  if item.filename=='word/document.xml':
   raw=raw.replace(b'Hello from DOCX Ray.', b'&lt;img src=x onerror=alert(1)&gt;')
  dst.writestr(item,raw)
sys.stdout.buffer.write(out.getvalue())`]);
  assert.equal(fixture.status, 0);
  const ui = app();
  try {
    ui.upload(fixture.stdout);
    await until(() => ui.$('status').textContent.startsWith('Inspected'));
    assert.match(ui.$('paragraphs').textContent, /<img src=x/);
    assert.equal(ui.$('paragraphs').querySelectorAll('img').length, 0);
    assert.equal(ui.$('xml').querySelectorAll('img').length, 0);
  } finally {ui.close();}
});
