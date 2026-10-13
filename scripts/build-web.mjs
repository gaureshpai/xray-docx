import {build} from 'esbuild';
// JSZip's catalog reader probes optional Node streams inside a guarded try/catch.
// Leave that Node-only module external; browser workers use Uint8Array throughout.
await build({entryPoints:['web/worker.mjs'], bundle:true, platform:'browser', format:'iife', target:'es2022', outfile:'public/worker.js', legalComments:'eof', external:['stream']});
console.log('Built browser-only DOCX worker.');
