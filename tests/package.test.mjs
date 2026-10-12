import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import JSZip from 'jszip';
import {DocxRaySDK} from '../web/sdk.mjs';

const sample = readFileSync('public/sample.docx');
async function changed(path, update) {
  const zip = await JSZip.loadAsync(sample);
  zip.file(path, update(await zip.file(path).async('string')));
  return zip.generateAsync({type:'uint8array'});
}

test('package relationships reject a forged namespace', async () => {
  const bytes = await changed('_rels/.rels', xml => xml.replaceAll('http://schemas.openxmlformats.org/package/2006/relationships', 'urn:forged'));
  await assert.rejects(new DocxRaySDK().inspect(bytes), /relationships/i);
});

test('a suffix-only officeDocument type cannot identify the main document', async () => {
  const bytes = await changed('_rels/.rels', xml => xml.replace('http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'urn:forged/officeDocument'));
  await assert.rejects(new DocxRaySDK().inspect(bytes), /main document/i);
});

test('foreign namespace content type overrides cannot identify the main document', async () => {
  const bytes = await changed('[Content_Types].xml', xml => xml.replace('<Override PartName="/word/document.xml"', '<Override xmlns="urn:forged" PartName="/word/document.xml"'));
  await assert.rejects(new DocxRaySDK().inspect(bytes), /main document/i);
});

test('failed inspection clears readable state and export is unavailable', async () => {
  const sdk = new DocxRaySDK();
  await sdk.inspect(sample);
  const broken = await changed('word/document.xml', () => '<wrong/>');
  await assert.rejects(sdk.inspect(broken), /document root/i);
  await assert.rejects(sdk.download('word/document.xml'), /inspect/i);
  await assert.rejects(sdk.exportXml(), /inspect/i);
  assert.throws(() => sdk.paragraph(0), /inspect/i);
  await sdk.inspect(sample);
  assert.ok((await sdk.download('word/document.xml')).length);
});

test('strict relationship namespaces and absolute main part paths remain supported', async () => {
  const bytes = await changed('_rels/.rels', xml => xml.replaceAll('http://schemas.openxmlformats.org/package/2006/relationships', 'http://purl.oclc.org/ooxml/package/relationships').replace('http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument').replace('Target="word/document.xml"', 'Target="/word/document.xml"'));
  assert.equal((await new DocxRaySDK().inspect(bytes)).mainPart, 'word/document.xml');
});
