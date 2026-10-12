import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import JSZip from 'jszip';
import {DocxRaySDK} from '../web/sdk.mjs';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function fixture(path, xml) {
  const zip = await JSZip.loadAsync(readFileSync('public/sample.docx'));
  zip.file(path, xml);
  return zip.generateAsync({type:'uint8array'});
}

test('main XML with an unquoted attribute is rejected rather than silently repaired', async () => {
  const bytes = await fixture('word/document.xml', `<w:document xmlns:w="${WORD}"><w:body><w:p w:rsidR=123><w:r><w:t>text</w:t></w:r></w:p></w:body></w:document>`);
  await assert.rejects(new DocxRaySDK().inspect(bytes), /XML/i);
});

test('forbidden XML control characters are rejected in the main document', async () => {
  const bytes = await fixture('word/document.xml', `<w:document xmlns:w="${WORD}"><w:body><w:p><w:r><w:t>bad\u0000text</w:t></w:r></w:p></w:body></w:document>`);
  await assert.rejects(new DocxRaySDK().inspect(bytes), /XML/i);
});

test('malformed optional review XML stays available as raw bytes with a warning', async () => {
  const raw = `<w:comments xmlns:w="${WORD}"><w:comment w:id=1><w:p><w:r><w:t>text</w:t></w:r></w:p></w:comment></w:comments>`;
  const sdk = new DocxRaySDK();
  const result = await sdk.inspect(await fixture('word/comments.xml', raw));
  assert.equal(result.comments.length, 0);
  assert.ok(result.warnings.some(warning => warning.includes('word/comments.xml')));
  assert.equal((await sdk.part('word/comments.xml')).xml, raw);
  assert.deepEqual(await sdk.download('word/comments.xml'), new TextEncoder().encode(raw));
});
