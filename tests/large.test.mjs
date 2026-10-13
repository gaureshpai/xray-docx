import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import JSZip from 'jszip';
import {DocxRaySDK} from '../web/sdk.mjs';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function fixture(body) {
  const zip = await JSZip.loadAsync(readFileSync('public/sample.docx'));
  zip.file('word/document.xml', `<w:document xmlns:w="${WORD}"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({type:'uint8array'});
}

test('a wide paragraph does not exceed the JavaScript function-argument ceiling', async () => {
  const count = 140000;
  const sdk = new DocxRaySDK();
  const result = await sdk.inspect(await fixture(`<w:p>${'<w:r><w:t>x</w:t></w:r>'.repeat(count)}</w:p>`));
  assert.equal(result.paragraphs[0].text.length, count);
  assert.equal(result.summary.runs, count);
});

test('a wide story still discovers its final revision instead of emitting a stack warning', async () => {
  const sdk = new DocxRaySDK();
  const result = await sdk.inspect(await fixture(`${'<w:p/>'.repeat(140000)}<w:p><w:ins w:id="last"><w:r><w:t>Final revision</w:t></w:r></w:ins></w:p>`));
  assert.equal(result.revisions.find(revision => revision.id === 'last')?.text, 'Final revision');
  assert.ok(!result.warnings.some(warning => /call stack/i.test(warning)));
});

test('a wide table row keeps every cell while checking deletion properties', {timeout:20000}, async () => {
  const count = 20000;
  const cells = Array.from({length:count}, (_,index)=>`<w:tc><w:p><w:r><w:t>Cell ${index}</w:t></w:r></w:p></w:tc>`).join('');
  const result = await new DocxRaySDK().inspect(await fixture(`<w:tbl><w:tr>${cells}</w:tr></w:tbl>`));
  assert.equal(result.paragraphs.length,count);
  assert.equal(result.paragraphs[0].text,'Cell 0');
  assert.equal(result.paragraphs.at(-1).text,`Cell ${count-1}`);
});
