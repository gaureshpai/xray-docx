import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import JSZip from 'jszip';
import {DocxRaySDK} from '../web/sdk.mjs';
import fixture from './structural-fixture.cjs';

for (const ns of ['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main']) {
  test(`structural table deletions stay in reviews and raw bytes, with web/CLI parity (${ns})`, async () => {
    const bytes = await fixture.deletedTableFixture(ns);
    const sdk = new DocxRaySDK();
    const web = await sdk.inspect(bytes);
    const dir = mkdtempSync(join(tmpdir(),'docx-ray-structural-'));
    try {
      const path = join(dir,'tables.docx'), output = join(dir,'xml.zip');
      writeFileSync(path,bytes);
      const cli = spawnSync('python3',['-m','docx_ray.cli',path,'--json','--output',output],{encoding:'utf8'});
      assert.equal(cli.status,0,cli.stderr);
      const python = JSON.parse(cli.stdout);
      for (const result of [web,python]) {
        assert.deepEqual(result.paragraphs.map(p=>p.text), ['Visible row','','','','Visible cell','Historical properties retained','Paragraph mark retained']);
        const row = result.revisions.find(r=>r.id==='101');
        assert.equal(row.text,'Deleted row\nSecond removed cell');
        assert.equal(row.author,'Row author');
        assert.equal(result.revisions.find(r=>r.id==='102').text,'Deleted cell');
        assert.equal(result.comments[0].text,'Visible comment');
        assert.equal(result.revisions.find(r=>r.id==='109').text,'Removed comment row');
        assert.equal(result.revisions.find(r=>r.id==='110').part,'word/header1.xml');
        assert.equal(result.revisions.find(r=>r.id==='110').text,'Removed header row');
        assert.ok(result.revisions.some(r=>r.id==='104'));
      }
      const records = list=>list.map(({xml,...record})=>record);
      assert.deepEqual(records(web.revisions),records(python.revisions));
      assert.deepEqual(records(web.comments),records(python.comments));
      assert.match(sdk.paragraph(1),/Deleted row/);
      const original = await JSZip.loadAsync(bytes);
      const webExport = await JSZip.loadAsync(await sdk.exportXml());
      const cliExport = await JSZip.loadAsync(readFileSync(output));
      for (const part of web.parts.filter(p=>p.kind==='xml')) {
        const raw = await original.file(part.path).async('nodebuffer');
        assert.deepEqual(Buffer.from(await sdk.download(part.path)),raw);
        assert.deepEqual(await webExport.file(part.path).async('nodebuffer'),raw);
        assert.deepEqual(await cliExport.file(part.path).async('nodebuffer'),raw);
      }
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
}
