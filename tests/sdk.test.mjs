import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import JSZip from 'jszip';
import {DocxRaySDK} from '../web/sdk.mjs';
const sample = readFileSync('public/sample.docx');
const reviewed = readFileSync('tests/reviewed.docx');
test('browser SDK exposes every XML and relationship part without rewriting bytes', async () => {
  const sdk = new DocxRaySDK();
  const result = await sdk.inspect(sample);
  const original = await JSZip.loadAsync(sample);
  const exported = await JSZip.loadAsync(await sdk.exportXml());
  for (const part of result.parts) {
    assert.equal(part.bytes, (await original.file(part.path).async('uint8array')).length);
    assert.deepEqual(await sdk.download(part.path), await original.file(part.path).async('uint8array'));
    if (part.kind === 'xml') {
      assert.equal((await sdk.part(part.path)).xml, await original.file(part.path).async('string'));
      assert.deepEqual(await exported.file(part.path).async('uint8array'), await original.file(part.path).async('uint8array'));
    }
  }
});
test('browser SDK exposes comments, deleted text and revision markup', async () => {
  const sdk = new DocxRaySDK();
  const result = await sdk.inspect(reviewed);
  assert.equal(result.comments[0].text, 'Check this wording.');
  for (const type of ['ins','del','moveFrom','moveTo']) assert.ok(result.revisions.some(revision => revision.type === type));
  assert.ok(result.revisions.some(revision => revision.text === 'Deleted words'));
  assert.match((await sdk.part('word/comments.xml')).xml, /Check this wording/);
});
test('a valid DOCX larger than 3 MB works and binary downloads remain byte-identical', async () => {
  const zip = await JSZip.loadAsync(sample);
  const media = randomBytes(4_000_000);
  zip.file('word/media/large.bin', media);
  const large = await zip.generateAsync({type:'uint8array', compression:'STORE'});
  assert.ok(large.length > 3_000_000);
  const sdk = new DocxRaySDK();
  const result = await sdk.inspect(large, 'large.docx');
  assert.ok(result.parts.some(part => part.path === 'word/media/large.bin'));
  assert.deepEqual(await sdk.download('word/media/large.bin'), new Uint8Array(media));
  const part = await sdk.part('word/media/large.bin');
  assert.equal(part.kind, 'binary');
  assert.match(part.note, /first 512 bytes/);
});
test('invalid and macro-enabled packages are rejected', async () => {
  const sdk = new DocxRaySDK();
  await assert.rejects(sdk.inspect(new Uint8Array([1,2,3])), /ZIP/);
  const zip = await JSZip.loadAsync(sample);
  const types = await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml', types.replace('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml','application/vnd.ms-word.document.macroEnabled.main+xml'));
  await assert.rejects(sdk.inspect(await zip.generateAsync({type:'uint8array'})), /macro-free/);
});
test('DTD markup stays raw and is not executed by the review parser', async () => {
  const zip = await JSZip.loadAsync(sample);
  zip.file('word/comments.xml', '<!DOCTYPE root [<!ENTITY x "boom">]><root>&x;</root>');
  const sdk = new DocxRaySDK();
  const result = await sdk.inspect(await zip.generateAsync({type:'uint8array'}));
  assert.ok(result.warnings.some(warning => warning.includes('DTD')));
  assert.match((await sdk.part('word/comments.xml')).xml, /<!ENTITY/);
});

test('UTF-16 and UTF-32 raw parts preserve Unicode and download encoding', async () => {
  const text = '<?xml version="1.0"?><root>café 日本語</root>';
  for (const encoding of ['utf16','utf32']) {
    const zip = await JSZip.loadAsync(sample);
    let bytes;
    if (encoding === 'utf16') bytes = Buffer.concat([Buffer.from([255,254]), Buffer.from(text,'utf16le')]);
    else {
      const points = [...text].map(char => char.codePointAt(0));
      bytes = Buffer.alloc(4 + points.length * 4);
      bytes.set([255,254,0,0]);
      points.forEach((point,index) => bytes.writeUInt32LE(point,4+index*4));
    }
    zip.file('customXml/unicode.xml', bytes);
    const sdk = new DocxRaySDK();
    await sdk.inspect(await zip.generateAsync({type:'uint8array'}));
    assert.equal((await sdk.part('customXml/unicode.xml')).xml,text);
    assert.deepEqual(await sdk.download('customXml/unicode.xml'),new Uint8Array(bytes));
  }
});
