const {test, expect} = require('@playwright/test');
const {readFileSync, promises:fs} = require('node:fs');
const {randomBytes} = require('node:crypto');
const JSZip = require('jszip');
const {spawnSync} = require('node:child_process');

const sample = readFileSync('public/sample.docx');
const reviewed = readFileSync('tests/reviewed.docx');
async function upload(page, bytes=sample, name='uploaded.docx') {
  await page.locator('#file').setInputFiles({name, mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer:Buffer.from(bytes)});
  await expect(page.locator('#status')).toContainText('Inspected');
}
async function download(page, selector) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const result = await pending;
  expect(await result.failure()).toBeNull();
  return {name:result.suggestedFilename(), bytes:await fs.readFile(await result.path())};
}

test.beforeEach(async ({page}) => {
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  await page.goto('/');
});
test.afterEach(async ({page}) => {expect(page.errors).toEqual([]);});

test('sample, raw XML, explorer filter and relationships', async ({page}) => {
  await page.locator('#sample').click();
  await expect(page.locator('#status')).toContainText('Inspected');
  await expect(page.locator('#xml')).toContainText('<w:document');
  await page.locator('#filter').fill('styles.xml');
  await expect(page.locator('#parts button')).toHaveCount(1);
  await page.locator('#parts button').click();
  await expect(page.locator('#xml')).toContainText('<w:styles');
  await page.locator('#relations-tab').click();
  await expect(page.locator('#relations')).toContainText('officeDocument');
});

test('reviews, original single-part bytes and complete XML bundle stay local', async ({page}) => {
  const requests = [];
  page.on('request', request => requests.push({method:request.method(), url:request.url()}));
  await upload(page, reviewed);
  await page.locator('#reviews-tab').click();
  await expect(page.locator('#reviews')).toContainText('Check this wording.');
  await expect(page.locator('#reviews')).toContainText('Deleted words');
  await expect(page.locator('#reviews')).toContainText('word/comments.xml');
  await page.locator('#raw-tab').click();
  const original = await JSZip.loadAsync(reviewed);
  const part = await download(page, '#download');
  expect(part.name).toBe('document.xml');
  expect(part.bytes).toEqual(await original.file('word/document.xml').async('nodebuffer'));
  const bundle = await download(page, '#export');
  const exported = await JSZip.loadAsync(bundle.bytes);
  const paths = Object.keys(original.files).filter(path => /\.(xml|rels)$/i.test(path));
  expect(Object.values(exported.files).filter(file => !file.dir).map(file => file.name).sort()).toEqual(paths.sort());
  for (const path of paths) expect(await exported.file(path).async('nodebuffer')).toEqual(await original.file(path).async('nodebuffer'));
  const networkRequests = requests.filter(request => new URL(request.url).protocol !== 'blob:');
  expect(networkRequests.filter(request => {
    const url = new URL(request.url);
    return request.method !== 'GET' || url.origin !== 'http://127.0.0.1:8123' || !['/worker.js','/favicon.ico'].includes(url.pathname);
  })).toEqual([]);
});

test('keyboard tabs and text mapping still work after a download', async ({page}) => {
  await upload(page);
  await download(page, '#download');
  await page.locator('#raw-tab').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#visual-tab')).toHaveAttribute('aria-selected','true');
  await page.locator('#paragraphs button').filter({hasText:'Hello from DOCX Ray'}).click();
  await expect(page.locator('#snippet')).toContainText('Hello from DOCX Ray');
  await page.keyboard.press('End');
});

test('invalid files fail visibly and a subsequent document succeeds', async ({page}) => {
  await page.locator('#file').setInputFiles({name:'broken.docx',mimeType:'application/octet-stream',buffer:Buffer.from('not a ZIP')});
  await expect(page.locator('#status')).toContainText('Invalid');
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#file')).toBeEnabled();
  await upload(page);
});

test('duplicate ZIP entries reject visibly and a valid document can recover', async ({page}) => {
  const result = spawnSync('python3', ['-c', 'import sys; from tests.test_engine import altered; sys.stdout.buffer.write(altered(extra=[("customXml/duplicate.xml", b"<old/>"),("customXml/duplicate.xml", b"<new/>")]))']);
  expect(result.status).toBe(0);
  await page.locator('#file').setInputFiles({name:'duplicate.docx',mimeType:'application/octet-stream',buffer:result.stdout});
  await expect(page.locator('#status')).toContainText('Duplicate archive entry');
  await expect(page.locator('#workspace')).toBeHidden();
  await upload(page);
});

test('malformed main XML reports an error without showing a repaired document', async ({page}) => {
  const zip = await JSZip.loadAsync(sample);
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p w:rsidR=123/></w:body></w:document>');
  await page.locator('#file').setInputFiles({name:'malformed.docx',mimeType:'application/octet-stream',buffer:await zip.generateAsync({type:'nodebuffer'})});
  await expect(page.locator('#status')).toContainText('Malformed XML');
  await expect(page.locator('#workspace')).toBeHidden();
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Legal \ufffd text</w:t></w:r></w:p></w:body></w:document>');
  await upload(page, await zip.generateAsync({type:'nodebuffer'}), 'legal-unicode.docx');
  await expect(page.locator('#paragraphs')).toContainText('Legal \ufffd text');
  await upload(page);
});

test('cancel sample loading and ignore its late response', async ({page}) => {
  let finish;
  const hold = new Promise(resolve => {finish = resolve;});
  await page.route('**/sample.docx', async route => {
    await hold;
    try {await route.fulfill({status:200, body:sample});} catch {}
  });
  await page.locator('#sample').click();
  await expect(page.locator('#status')).toHaveText('Loading the sample…');
  await page.locator('#cancel').click();
  finish();
  await expect(page.locator('#status')).toHaveText('Processing cancelled.');
  await expect(page.locator('#workspace')).toBeHidden();
  await upload(page, reviewed, 'after-cancel.docx');
  await expect(page.locator('#filename')).toHaveText('after-cancel.docx');
});

test('cancel a worker operation and recover with a new file', async ({page}) => {
  let finish;
  const hold = new Promise(resolve => {finish = resolve;});
  await page.route('**/worker.js', async route => {await hold; try {await route.continue();} catch {}});
  await page.locator('#file').setInputFiles({name:'cancel.docx',mimeType:'application/octet-stream',buffer:sample});
  await page.locator('#cancel').click();
  finish();
  await expect(page.locator('#status')).toHaveText('Processing cancelled.');
  await upload(page, reviewed, 'recovered.docx');
  await expect(page.locator('#reviews')).toContainText('Check this wording.');
});

test('large binary parts retain bytes without the old 3 MB cap', async ({page}) => {
  const zip = await JSZip.loadAsync(sample);
  const media = randomBytes(4_000_000);
  zip.file('word/media/large.bin', media);
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml').async('string')).replace('</Types>', '<Override PartName="/word/media/large.bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/></Types>'));
  await upload(page, await zip.generateAsync({type:'nodebuffer',compression:'STORE'}), 'large.docx');
  await page.locator('#filter').fill('large.bin');
  await page.locator('#parts button').click();
  await expect(page.locator('#partinfo')).toContainText('first 512 bytes');
  expect((await download(page, '#download')).bytes).toEqual(media);
});

test('many paragraphs render completely, map the final paragraph and export original XML', async ({page}) => {
  const zip = await JSZip.loadAsync(sample);
  const count = 5000;
  const body = Array.from({length:count}, (_, index) => `<w:p><w:r><w:t>Paragraph ${index}</w:t></w:r></w:p>`).join('');
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  zip.file('word/document.xml', xml);
  await upload(page, await zip.generateAsync({type:'nodebuffer'}), 'many-paragraphs.docx');
  await expect(page.locator('#paragraphs button')).toHaveCount(count);
  await page.locator('#visual-tab').click();
  await page.locator('#paragraphs button').last().click();
  await expect(page.locator('#snippet')).toContainText(`Paragraph ${count-1}`);
  const bundle = await download(page, '#export');
  const exported = await JSZip.loadAsync(bundle.bytes);
  expect(await exported.file('word/document.xml').async('string')).toBe(xml);
  await upload(page);
  await expect(page.locator('#paragraphs button')).toHaveCount(9);
});

test('document markup stays text and the page fits the viewport', async ({page}, testInfo) => {
  const zip = await JSZip.loadAsync(sample);
  zip.file('word/document.xml', (await zip.file('word/document.xml').async('string')).replace('Hello from DOCX Ray.', '&lt;img src=x onerror=alert(1)&gt;'));
  await upload(page, await zip.generateAsync({type:'nodebuffer'}));
  await page.locator('#visual-tab').click();
  await expect(page.locator('#paragraphs')).toContainText('<img src=x');
  await expect(page.locator('#paragraphs img, #xml img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('inspection.png'),fullPage:true});
});

test('removed text boxes stay raw and multi-paragraph reviews link to their original source', async ({page}) => {
  const zip = await JSZip.loadAsync(reviewed);
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  zip.file('word/document.xml', `<w:document xmlns:w="${ns}"><w:body><w:p><w:r><w:t>Visible</w:t></w:r><w:del w:id="20"><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Removed box</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:del></w:p></w:body></w:document>`);
  const comments = `<w:comments xmlns:w="${ns}"><w:comment w:id="30"><w:p><w:r><w:t>First</w:t><w:br/><w:t>line</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>Last</w:t></w:r></w:p></w:comment></w:comments>`;
  zip.file('word/comments.xml', comments);
  await upload(page, await zip.generateAsync({type:'nodebuffer'}));
  await page.locator('#visual-tab').click();
  await expect(page.locator('#paragraphs')).not.toContainText('Removed box');
  await page.locator('#paragraphs button').nth(1).click();
  await expect(page.locator('#snippet')).toContainText('Removed box');
  await page.locator('#reviews-tab').click();
  const card = page.locator('#reviews .relationship').filter({has:page.locator('strong', {hasText:'Comment'})});
  expect(await card.locator('p').innerText()).toBe('First\nline\n\nLast');
  await expect(card.locator('p')).toHaveCSS('white-space', 'pre-wrap');
  await expect(page.locator('#reviews')).toContainText('Removed box');
  await card.getByRole('button', {name:'Open source part'}).click();
  await expect(page.locator('#raw-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#partname')).toHaveText('word/comments.xml');
  await expect(page.locator('#xml')).toHaveText(comments);
  expect((await download(page, '#download')).bytes).toEqual(Buffer.from(comments));
});
