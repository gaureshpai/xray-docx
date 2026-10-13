import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import JSZip from 'jszip';
import {DocxRaySDK} from '../web/sdk.mjs';

const revisionTypes = ['ins','del','moveFrom','moveTo','rPrChange','pPrChange','tblPrChange','tblGridChange','trPrChange','tcPrChange','sectPrChange','numberingChange','cellIns','cellDel','cellMerge','customXmlInsRangeStart','customXmlDelRangeStart','customXmlMoveFromRangeStart','customXmlMoveToRangeStart'];
for (const ns of ['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main']) {
  test(`CLI and browser agree on review metadata, current text and original exports (${ns})`, async () => {
    const zip = await JSZip.loadAsync(readFileSync('tests/reviewed.docx'));
    const run = text => `<w:r><w:t>${text}</w:t></w:r>`;
    const box = `<w:r><w:drawing><w:txbxContent><w:p>${run('Removed box')}</w:p></w:txbxContent></w:drawing></w:r>`;
    zip.file('word/document.xml', `<w:document xmlns:w="${ns}"><w:body><w:p>${run('Visible')}<w:r><w:tab/><w:br/><w:cr/><w:noBreakHyphen/><w:softHyphen/></w:r><w:del w:id="1">${run('Removed t')}<w:r><w:delText>Deleted</w:delText></w:r>${box}</w:del><w:moveFrom w:id="2">${run('Moved away')}</w:moveFrom><w:ins w:id="3">${run('Added')}</w:ins><w:moveTo w:id="4">${run('Moved here')}</w:moveTo></w:p></w:body></w:document>`);
    zip.remove('word/comments.xml');
    const comments = `<w:comments xmlns:w="${ns}"><w:comment w:id="7" w:author="Reviewer" w:date="2026-10-13T00:00:00Z"><w:p>${run('First')}</w:p><w:p/><w:p>${run('Last')}<w:del w:id="8"><w:r><w:delText>Old comment</w:delText></w:r></w:del></w:p></w:comment></w:comments>`;
    let commentBytes = Buffer.concat([Buffer.from([255,254]),Buffer.from(comments,'utf16le')]);
    if (ns.includes('purl.oclc')) {
      const points = [...comments].map(c=>c.codePointAt(0));
      commentBytes = Buffer.alloc(4+points.length*4);
      commentBytes.set([255,254,0,0]);
      points.forEach((point,i)=>commentBytes.writeUInt32LE(point,4+i*4));
    }
    zip.file('word/annotations.part', commentBytes);
    zip.file('word/header1.xml', `<w:hdr xmlns:w="${ns}"><w:p>${revisionTypes.map((type,i) => `<w:${type} w:id="${100+i}" w:author="Header">${['ins','del','moveFrom','moveTo'].includes(type) ? run(type) : ''}</w:${type}>`).join('')}</w:p></w:hdr>`);
    zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml').async('string')).replace('/word/comments.xml','/word/annotations.part').replace('</Types>','<Override PartName="/word/header1.xml" ContentType="Application/Vnd.Openxmlformats-Officedocument.Wordprocessingml.Header+Xml"/></Types>'));
    if (ns.includes('purl.oclc')) zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml').async('string')).replace('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml','Application/Vnd.Openxmlformats-Officedocument.Wordprocessingml.Document.Main+Xml'));
    const bytes = await zip.generateAsync({type:'nodebuffer'});
    const sdk = new DocxRaySDK();
    const web = await sdk.inspect(bytes);
    const cli = spawnSync('python3', ['-c', 'import sys,json,tempfile,subprocess,base64; from pathlib import Path; from docx_ray.service import xml_bundle; data=sys.stdin.buffer.read(); t=tempfile.TemporaryDirectory(); p=Path(t.name)/"review.docx"; p.write_bytes(data); r=subprocess.run([sys.executable,"-m","docx_ray.cli",str(p),"--json","--output",str(Path(t.name)/"xml.zip")],capture_output=True,text=True); sys.stdout.write(json.dumps({"result":json.loads(r.stdout),"bundle":base64.b64encode((Path(t.name)/"xml.zip").read_bytes()).decode()})) if r.returncode==0 else sys.stdout.write(r.stdout); sys.stderr.write(r.stderr); sys.exit(r.returncode)'], {input:bytes,maxBuffer:10_000_000});
    assert.equal(cli.status,0,cli.stderr.toString());
    const output = JSON.parse(cli.stdout);
    const python = output.result;
    const cliExport = await JSZip.loadAsync(Buffer.from(output.bundle,"base64"));
    const records = list => list.map(({xml,...record}) => record);
    assert.deepEqual(records(python.comments), records(web.comments));
    assert.deepEqual(records(python.revisions), records(web.revisions));
    assert.deepEqual(python.paragraphs.map(({index,text})=>({index,text})), web.paragraphs);
    assert.deepEqual(web.paragraphs.map(p=>p.text), ['Visible\t\n\n\u2011\u00adAddedMoved here','']);
    assert.equal(web.comments[0].text,'First\n\nLast');
    assert.equal(web.comments[0].part,'word/annotations.part');
    assert.equal(web.revisions.filter(r=>r.part==='word/header1.xml').length,revisionTypes.length);
    const exported = await JSZip.loadAsync(await sdk.exportXml());
    for (const part of python.parts.filter(p=>p.kind==='xml')) {
      assert.equal(part.xml,part.path==='word/annotations.part' ? comments : await zip.file(part.path).async('string'));
      assert.deepEqual(await cliExport.file(part.path).async('nodebuffer'),await zip.file(part.path).async('nodebuffer'));
      assert.deepEqual(await exported.file(part.path).async('nodebuffer'),await zip.file(part.path).async('nodebuffer'));
    }
  });
}

test('binary OOXML media types remain binary in both engines and stay out of XML exports', async () => {
  const zip = await JSZip.loadAsync(readFileSync('tests/reviewed.docx'));
  const paths = ['word/embeddings/object.bin','word/fonts/font.odttf'];
  const types = ['application/vnd.openxmlformats-officedocument.oleObject','application/vnd.openxmlformats-officedocument.obfuscatedFont'];
  const binary = Buffer.from([255,254,0,0,255,0,127]);
  paths.forEach(path=>zip.file(path,binary));
  const xmlPaths = ['customXml/plain.part','customXml/text.part'];
  const xmlTypes = ['application/xml','text/xml; charset=UTF-8'];
  xmlPaths.forEach(path=>zip.file(path,'<root>Original XML</root>'));
  zip.file('[Content_Types].xml',(await zip.file('[Content_Types].xml').async('string')).replace('</Types>',paths.map((path,i)=>`<Override PartName="/${path}" ContentType="${types[i]}"/>`).join('')+xmlPaths.map((path,i)=>`<Override PartName="/${path}" ContentType="${xmlTypes[i]}"/>`).join('')+'</Types>'));
  const bytes = await zip.generateAsync({type:'nodebuffer'});
  const sdk = new DocxRaySDK();
  const web = await sdk.inspect(bytes);
  const cli = spawnSync('python3',['-c','import sys,json,base64; from docx_ray.service import inspect_docx,xml_bundle; data=sys.stdin.buffer.read(); print(json.dumps({"result":inspect_docx(data),"bundle":base64.b64encode(xml_bundle(data)).decode()}))'],{input:bytes});
  assert.equal(cli.status,0,cli.stderr.toString());
  const output = JSON.parse(cli.stdout);
  const webExport = await JSZip.loadAsync(await sdk.exportXml());
  const cliExport = await JSZip.loadAsync(Buffer.from(output.bundle,'base64'));
  for (const path of paths) {
    assert.equal(web.parts.find(p=>p.path===path).kind,'binary');
    assert.equal(output.result.parts.find(p=>p.path===path).kind,'binary');
    assert.match((await sdk.part(path)).note,/Hex preview/);
    assert.deepEqual(Buffer.from(await sdk.download(path)),binary);
    assert.equal(webExport.file(path),null);
    assert.equal(cliExport.file(path),null);
  }
  for (const path of xmlPaths) {
    assert.equal(web.parts.find(p=>p.path===path).kind,'xml');
    assert.equal(output.result.parts.find(p=>p.path===path).kind,'xml');
    assert.equal(await webExport.file(path).async('string'),'<root>Original XML</root>');
    assert.equal(await cliExport.file(path).async('string'),'<root>Original XML</root>');
  }
});
