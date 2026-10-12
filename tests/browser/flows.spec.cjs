const {test, expect} = require('@playwright/test');
const {readFileSync, promises:fs} = require('node:fs');
const {randomBytes} = require('node:crypto');
const JSZip = require('jszip');

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

test('malformed main XML reports an error without showing a repaired document', async ({page}) => {
  const zip = await JSZip.loadAsync(sample);
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p w:rsidR=123/></w:body></w:document>');
  await page.locator('#file').setInputFiles({name:'malformed.docx',mimeType:'application/octet-stream',buffer:await zip.generateAsync({type:'nodebuffer'})});
  await expect(page.locator('#status')).toContainText('Malformed XML');
  await expect(page.locator('#workspace')).toBeHidden();
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
  await upload(page, await zip.generateAsync({type:'nodebuffer',compression:'STORE'}), 'large.docx');
  await page.locator('#filter').fill('large.bin');
  await page.locator('#parts button').click();
  await expect(page.locator('#partinfo')).toContainText('first 512 bytes');
  expect((await download(page, '#download')).bytes).toEqual(media);
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
