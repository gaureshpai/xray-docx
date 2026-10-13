import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {DocxRaySDK} from '../web/sdk.mjs';
import JSZip from 'jszip';

function extraEntries(entries) {
  const result = spawnSync('python3', ['-c', `
import json,sys
from tests.test_engine import altered
sys.stdout.buffer.write(altered(extra=[(name, text.encode()) for name,text in json.loads(sys.argv[1])]))
`, JSON.stringify(entries)]);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

test('duplicate raw ZIP entries are rejected before the file map overwrites them', async () => {
  const bytes = extraEntries([['customXml/duplicate.xml','<old/>'],['customXml/duplicate.xml','<new/>']]);
  await assert.rejects(new DocxRaySDK().inspect(bytes), /Duplicate archive entry/);
});

test('an unsafe entry cannot be hidden by a later normalized-name collision', async () => {
  const bytes = extraEntries([['../customXml/hidden.xml','<old/>'],['customXml/hidden.xml','<new/>']]);
  await assert.rejects(new DocxRaySDK().inspect(bytes), /Unsafe archive path/);
});

test('unsafe directory entries are validated even when no file uses them', async () => {
  const bytes = extraEntries([['/unsafe/','']]);
  await assert.rejects(new DocxRaySDK().inspect(bytes), /Unsafe archive path/);
});

test('a central-directory count mismatch is rejected', async () => {
  const bytes = Buffer.from(readFileSync('public/sample.docx'));
  const end = bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  bytes.writeUInt16LE(1,end+8);
  bytes.writeUInt16LE(1,end+10);
  await assert.rejects(new DocxRaySDK().inspect(bytes), /entry count/i);
});

test('valid Unicode part paths and directory entries preserve original downloads', async () => {
  const zip = await JSZip.loadAsync(readFileSync('public/sample.docx'));
  zip.file('word/media/日本.bin', new Uint8Array([1,2,3]));
  const sdk = new DocxRaySDK();
  const result = await sdk.inspect(await zip.generateAsync({type:'uint8array'}));
  assert.ok(result.parts.some(part => part.path === 'word/media/日本.bin'));
  assert.deepEqual(await sdk.download('word/media/日本.bin'), new Uint8Array([1,2,3]));
});

for (const [option, args] of [['corrupt','corrupt=True'],['null_name','null_name=True'],['malformed deflate','corrupt=True, deflated=True']]) {
  test(`browser SDK rejects binary integrity fixture: ${option}`, async () => {
    const fixture = spawnSync('python3', ['-c', `import sys; from tests.test_integrity import binary_fixture; sys.stdout.buffer.write(binary_fixture(${args}))`]);
    assert.equal(fixture.status,0,fixture.stderr.toString());
    await assert.rejects(new DocxRaySDK().inspect(fixture.stdout), option === 'null_name' ? /Unsafe archive path/ : /ZIP|CRC|corrupt/i);
  });
}
