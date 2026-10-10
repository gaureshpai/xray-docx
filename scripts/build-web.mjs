import {build} from 'esbuild';
await build({entryPoints:['web/worker.mjs'], bundle:true, platform:'browser', format:'iife', target:'es2022', outfile:'public/worker.js', legalComments:'eof'});
console.log('Built browser-only DOCX worker.');
