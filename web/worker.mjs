import {DocxRaySDK} from './sdk.mjs';
const sdk = new DocxRaySDK();
let queue = Promise.resolve();
self.onmessage = ({data}) => {queue = queue.then(() => dispatch(data));};
async function dispatch(data) {
  const {id, action} = data;
  try {
    let result;
    if (action === 'inspect') result = await sdk.inspect(new Uint8Array(await data.file.arrayBuffer()), data.filename, message => self.postMessage({id,progress:message}));
    else if (action === 'part') result = await sdk.part(data.path);
    else if (action === 'paragraph') result = sdk.paragraph(data.index);
    else if (action === 'download') result = await sdk.download(data.path);
    else if (action === 'export') result = await sdk.exportXml();
    else throw new Error('Unknown SDK operation.');
    if (result instanceof Uint8Array) self.postMessage({id,result}, [result.buffer]);
    else self.postMessage({id,result});
  } catch (error) {self.postMessage({id,error:error.message || 'Could not process this document in browser memory.'});}
}
