/** Parse Cloudflare's Worker download without treating a multipart envelope as source. */
import {createHash} from 'node:crypto';
const sha256=b=>createHash('sha256').update(b).digest('hex');
const allowed=/(?:javascript|ecmascript|text\/plain|octet-stream)/i;
export async function extractWorkerSource(response) {
  if(!response?.ok)throw Error('WORKER_CONTENT_HTTP_'+(response?.status??'UNKNOWN'));
  const mime=response.headers.get('content-type')||'';
  const prefix=mime.toLowerCase().split(';')[0].trim();
  if(prefix==='multipart/form-data') {
    const form=await response.formData(),fields=[...form.entries()];
    if(!fields.length)throw Error('EMPTY_WORKER_MULTIPART');
    const metadataPart=form.get('metadata');
    let metadata={};
    if(metadataPart!==null) {
      try {
        const str=typeof metadataPart==='string'?metadataPart:await metadataPart.text();
        metadata=JSON.parse(str);
      } catch {throw Error('WORKER_METADATA_INVALID');}
    }
    const named=metadata?.main_module||metadata?.body_part||
      response.headers.get('cf-worker-main-module-part')||
      response.headers.get('cf-worker-body-part');
    const sourceParts=fields.filter(([key,p])=>key!=='metadata'&&(
      /\.(?:m?js|ts|jsx)$/.test(key)||
      (typeof p!=='string'&&(/\.(?:m?js|ts|jsx)$/.test(p.name||'')||allowed.test(p.type||'')))
    ));
    const selected=named?form.get(named):sourceParts.length===1?sourceParts[0][1]:null;
    if(selected===null||selected===undefined)throw Error('WORKER_SOURCE_PART_AMBIGUOUS');
    const data=Buffer.from(typeof selected==='string'?selected:await selected.arrayBuffer());
    if(!data.length)throw Error('WORKER_SOURCE_EMPTY');
    return {data,format:'multipart',selectedPart:named||sourceParts[0][0],
      fileParts:sourceParts.length,totalParts:fields.length,sha256:sha256(data)};
  }
  if(!/javascript|ecmascript|text\/plain|octet-stream/i.test(prefix))
    throw Error('WORKER_CONTENT_TYPE_UNEXPECTED');
  const data=Buffer.from(await response.arrayBuffer());
  if(!data.length)throw Error('WORKER_SOURCE_EMPTY');
  return {data,format:'direct',selectedPart:null,fileParts:1,totalParts:1,sha256:sha256(data)};
}
