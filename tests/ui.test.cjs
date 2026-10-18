// DOM integration tests exercise actual app.js and the bundled browser worker.
// JSDOM does not verify browser rendering or downloads on disk.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const {Worker:NodeWorker} = require('node:worker_threads');
const {join} = require('node:path');
const JSZip = require('jszip');
const python = require('./python.cjs');
const port = 20000 + Math.floor(Math.random() * 20000);
const origin = `http://127.0.0.1:${port}`;
let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout=6000) {
  for (let n = 0; n < Math.ceil(timeout / 20); n++) {
    if (predicate()) return;
    await pause(20);
  }
  throw new Error('Timed out waiting for UI state.');
}
before(async () => {
  server = python.spawnPython(['-m', 'xray_docx.server', '--port', String(port)], {stdio:'pipe'});
  for (let n = 0; n < 100; n++) {
    try {if ((await fetch(`${origin}/`)).ok) return;} catch {}
    await pause(30);
  }
  throw new Error('Static asset server did not start.');
});
after(() => server?.kill());
function app() {
  const dom = new JSDOM(fs.readFileSync('public/index.html', 'utf8'), {url:origin, runScripts:'outside-only'});
  const window = dom.window;
  const downloads = [];
  const requests = [];
  const workers = [];
  const blobs = new Map();
  let nextUrl = 0;
  window.File = File;
  window.Blob = Blob;
  window.AbortController = AbortController;
  window.fetch = (url, options) => {requests.push({url:String(url), options}); return fetch(new URL(url, origin), options);};
  window.Worker = class {
    constructor() {
      this.thread = new NodeWorker(join(__dirname, 'worker-thread.cjs'));
      workers.push(this.thread);
      this.thread.on('message', data => this.onmessage?.({data}));
      this.thread.on('error', error => this.onerror?.(error));
    }
    postMessage(data) {this.thread.postMessage(data);}
    terminate() {this.thread.terminate();}
  };
  window.matchMedia = () => ({matches:true});
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.URL.createObjectURL = blob => {const url = `blob:test-${nextUrl++}`; blobs.set(url, blob); return url;};
  window.URL.revokeObjectURL = url => blobs.delete(url);
  window.HTMLAnchorElement.prototype.click = function() {downloads.push({name:this.download, blob:blobs.get(this.href)});};
  window.eval(fs.readFileSync('public/sdk-client.js', 'utf8'));
  window.eval(fs.readFileSync('public/app.js', 'utf8'));
  const $ = id => window.document.getElementById(id);
  function upload(data, name='uploaded.docx') {
    Object.defineProperty($('file'), 'files', {configurable:true, value:[new File([data], name)]});
    $('file').dispatchEvent(new window.Event('change'));
  }
  return {window, $, downloads, requests, upload, close:() => {workers.forEach(worker => worker.terminate()); window.close();}};
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
    assert.match(ui.$('xml').textContent, /\n\s+<w:/);
    assert.match(ui.$('parts').textContent, /word\/styles.xml/);
    const appPart = [...ui.$('parts').querySelectorAll('button')].find(button => button.textContent.includes('docProps/app.xml'));
    appPart.click();
    await until(() => /<Application(?:\s[^>]*)?>Xray DOCX<\/Application>/.test(ui.$('xml').textContent));
    assert.match(ui.$('xml').textContent, /\n\s+<Application>/);
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
    await until(() => ui.$('xml').textContent.includes('<w:styles'));
    ui.$('raw-tab').dispatchEvent(new ui.window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
    assert.equal(ui.$('visual-panel').hidden, false);
    ui.$('paragraphs').children[1].click();
    await until(() => ui.$('snippet').textContent.includes('Hello from Xray DOCX'));
    assert.match(ui.$('snippet').textContent, /Hello from Xray DOCX/);
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
    assert.equal(ui.downloads[1].name, 'xray-docx-xml.zip');
    const bytes = new Uint8Array(await ui.downloads[1].blob.arrayBuffer());
    assert.equal(String.fromCharCode(...bytes.slice(0,2)), 'PK');
  } finally {ui.close();}
});
test('invalid files show useful errors', async () => {
  const ui = app();
  try {
    ui.upload('text', 'wrong.doc');
    assert.match(ui.$('status').textContent, /Choose a .docx/);
    ui.upload('not a zip');
    await until(() => ui.$('status').classList.contains('error') && !ui.$('file').disabled);
    assert.match(ui.$('status').textContent, /Invalid.*ZIP/);
    assert.equal(ui.$('workspace').hidden, true);
  } finally {ui.close();}
});
test('failed sample downloads clear busy state', async () => {
  const ui = app();
  try {
    ui.window.fetch = async () => {throw new Error('Network unavailable');};
    ui.$('sample').click();
    await until(() => ui.$('status').textContent === 'Network unavailable');
    assert.equal(ui.$('file').disabled, false);
    assert.equal(ui.$('sample').disabled, false);
  } finally {ui.close();}
});
test('document text containing markup stays text instead of executable DOM', async () => {
  const fixture = python.spawnPythonSync(['-c', `
import io,sys,zipfile
out=io.BytesIO()
with zipfile.ZipFile('public/sample.docx') as src,zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as dst:
 for item in src.infolist():
  raw=src.read(item.filename)
  if item.filename=='word/document.xml':
    raw=raw.replace(b'Hello from Xray DOCX.', b'&lt;img src=x onerror=alert(1)&gt;')
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

test('uploads and exports send no document bytes over the network', async () => {
  const ui = app();
  try {
    ui.upload(fs.readFileSync('tests/reviewed.docx'));
    await until(() => ui.$('status').textContent.startsWith('Inspected'));
    ui.$('reviews-tab').click();
    assert.match(ui.$('reviews').textContent, /Check this wording/);
    assert.match(ui.$('reviews').textContent, /Deleted words/);
    ui.$('export').click();
    await until(() => ui.downloads.length === 1);
    assert.equal(ui.requests.length, 0);
  } finally {ui.close();}
});

test('the UI accepts a valid document above the former 3 MB cap', async () => {
  const {randomBytes} = require('node:crypto');
  const archive = await JSZip.loadAsync(fs.readFileSync('public/sample.docx'));
  archive.file('word/media/large.bin',randomBytes(4_000_000));
  const bytes = await archive.generateAsync({type:'uint8array',compression:'STORE'});
  const ui = app();
  try {
    ui.upload(bytes, 'large.docx');
    await until(() => ui.$('status').textContent.startsWith('Inspected'));
    assert.equal(ui.$('filename').textContent,'large.docx');
    assert.match(ui.$('parts').textContent,/large.bin/);
    assert.equal(ui.requests.length,0);
  } finally {ui.close();}
});

test('cancelled sample fetch cannot reopen a document after it resolves', async () => {
  const ui = app();
  try {
    let finish;
    ui.window.fetch = () => new Promise(resolve => {finish = resolve;});
    ui.$('sample').click();
    ui.$('cancel').click();
    finish({ok:true, blob:async () => new Blob([fs.readFileSync('public/sample.docx')])});
    await pause(500);
    assert.equal(ui.$('workspace').hidden, true);
    assert.equal(ui.$('status').textContent, 'Processing cancelled.');
    assert.equal(ui.$('export').disabled, true);
    ui.upload(fs.readFileSync('tests/reviewed.docx'), 'after-cancel.docx');
    await until(() => ui.$('status').textContent.startsWith('Inspected'));
    assert.equal(ui.$('filename').textContent, 'after-cancel.docx');
  } finally {ui.close();}
});

test('cancelled worker operation stays cancelled and can recover with a new file', async () => {
  const ui = app();
  try {
    ui.upload(fs.readFileSync('public/sample.docx'));
    ui.$('cancel').click();
    await pause(50);
    assert.equal(ui.$('status').textContent, 'Processing cancelled.');
    assert.equal(ui.$('workspace').hidden, true);
    assert.equal(ui.$('download').disabled, true);
    ui.upload(fs.readFileSync('tests/reviewed.docx'));
    await until(() => ui.$('status').textContent.startsWith('Inspected'));
    assert.match(ui.$('reviews').textContent, /Check this wording/);
  } finally {ui.close();}
});

test('many-paragraph inspection renders every mapping without an argument-count crash', async () => {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync('public/sample.docx'));
  const count = 140000;
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${'<w:p/>'.repeat(count)}<w:p><w:r><w:t>Final paragraph</w:t></w:r></w:p></w:body></w:document>`);
  const ui = app();
  try {
    ui.upload(await zip.generateAsync({type:'uint8array'}));
    await until(() => ui.$('status').textContent.startsWith('Inspected') || ui.$('status').classList.contains('error'), 60000);
    assert.match(ui.$('status').textContent, /^Inspected/);
    assert.equal(ui.$('paragraphs').children.length, count + 1);
    ui.$('paragraphs').lastChild.click();
    await until(() => ui.$('snippet').textContent.includes('Final paragraph'));
  } finally {ui.close();}
});
