const CONFIG = /* APP_OFFLINE_CONFIG */;
const ORIGIN=self.location.origin;
const PREFIX='full-app-offline:'+CONFIG.base+':';
const CACHE=PREFIX+CONFIG.version;
const MARKER=new URL(CONFIG.base+'.offline-complete',ORIGIN).href;
const files=new Map(CONFIG.files.map(file=>[file.path,file]));
const packs=new Map(CONFIG.packs.map(pack=>[pack.path,pack]));
let saving;
async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function batches(items,fn,size=8){for(let start=0;start<items.length;start+=size)await Promise.all(items.slice(start,start+size).map(fn));}
function permitted(response){return response.ok&&!response.redirected&&response.type!=='opaque'&&!/private|no-store/i.test(response.headers.get('cache-control')||'');}
async function download(pack){
 const response=await fetch(new Request(new URL(pack.path,ORIGIN).href,{credentials:'omit',cache:'reload',redirect:'error'}));
 if(!permitted(response))throw Error('Offline files are not publicly available');
 const bytes=await response.arrayBuffer();
 if(await digest(bytes)!==pack.sha256)throw Error('Offline release checksum does not match');
 const archive=JSON.parse(new TextDecoder().decode(bytes));
 if(archive.schema!==1||!Array.isArray(archive.files)||archive.files.length!==pack.files.length)throw Error('Invalid offline archive');
 const expected=new Set(pack.files);const validated=[];
 for(const record of archive.files){
  if(!expected.delete(record.path)||typeof record.body!=='string')throw Error('Unexpected offline file');
  const spec=files.get(record.path);if(!spec)throw Error('Offline file not allowed');
  const decoded=atob(record.body);const body=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  if(body.length!==spec.size||await digest(body)!==spec.sha256)throw Error('Offline file checksum does not match');
  validated.push({spec,body});
 }
 if(expected.size)throw Error('Incomplete offline archive');
 return validated;
}
async function valid(cache,spec,deep=false){
 const response=await cache.match(spec.path);
 if(!response||response.headers.get('x-app-offline-sha256')!==spec.sha256)return false;
 if(!deep)return true;
 const bytes=await response.arrayBuffer();return bytes.byteLength===spec.size&&await digest(bytes)===spec.sha256;
}
async function inspect(deep=true){
 const cache=await caches.open(CACHE);let saved=0;
 await batches(CONFIG.files,async spec=>{if(await valid(cache,spec,deep))saved++;});
 return {type:'APP_OFFLINE_STATUS',ready:saved===CONFIG.files.length,saved,total:CONFIG.files.length,bytes:CONFIG.bytes,pages:Object.keys(CONFIG.routes).filter(p=>p.endsWith('.html')).length,version:CONFIG.version,automatic:true};
}
async function notify(message){for(const client of await self.clients.matchAll({includeUncontrolled:true}))client.postMessage(message);}
async function fill(){
 if(saving)return saving;
 saving=(async()=>{
  const cache=await caches.open(CACHE);let saved=0;
  for(const pack of CONFIG.packs){
   const complete=await Promise.all(pack.files.map(p=>valid(cache,files.get(p),true)));
   if(complete.every(Boolean)){saved+=pack.files.length;continue;}
   const records=await download(pack);
   await batches(records,async({spec,body})=>{
    if(!await valid(cache,spec,true))await cache.put(spec.path,new Response(body,{headers:{...spec.headers,'Content-Type':spec.type,'Content-Length':String(spec.size),'X-App-Offline-Sha256':spec.sha256}}));
   });
   saved+=pack.files.length;
   await notify({type:'APP_OFFLINE_PROGRESS',saved,total:CONFIG.files.length,bytes:CONFIG.bytes});
  }
  const status=await inspect(true);
  if(!status.ready)throw Error('Offline saving incomplete');
  await cache.put(MARKER,new Response(JSON.stringify(status),{headers:{'Content-Type':'application/json'}}));
  await notify(status);return status;
 })().finally(()=>{saving=null;});
 return saving;
}
self.addEventListener('install',event=>event.waitUntil(fill().then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const previous=[],obsoletePartial=[];
 for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE){const cache=await caches.open(key);if(await cache.match(MARKER))previous.push(key);else obsoletePartial.push(key);}
 // Keep one prior complete release for already-open pages. Never touch private
 // app storage or another worker's caches. Failed current installs are retained
 // until a complete replacement succeeds, then obsolete partials can retire.
 await Promise.all([...previous.slice(0,-1),...obsoletePartial].map(key=>caches.delete(key)));
 await self.clients.claim();await notify(await inspect(false));
})()));
function selected(request){
 const url=new URL(request.url);
 if(!['GET','HEAD'].includes(request.method)||url.origin!==ORIGIN||request.headers.has('authorization')||url.pathname.startsWith(CONFIG.base+'api/'))return null;
 if(request.mode==='navigate'){
  if(CONFIG.routes[url.pathname])return CONFIG.routes[url.pathname];
  // Unknown account and private routes must reach their own server handlers.
  // Explicitly published public HTML routes were already resolved above.
  let decoded;try{decoded=decodeURIComponent(url.pathname);}catch{return null;}
  const sensitive=decoded.split('/').some(part=>/^(?:api|private|uploads|user-data|auth|account)$/i.test(part));
  if(CONFIG.spa&&!sensitive&&url.pathname.startsWith(CONFIG.base)&&!url.pathname.split('/').at(-1).includes('.'))return {path:CONFIG.base+'index.html'};
 }
 return files.has(url.pathname)?{path:url.pathname}:null;
}
self.addEventListener('fetch',event=>{
 const selectedFile=selected(event.request);if(!selectedFile)return;
 event.respondWith((async()=>{
  if(selectedFile.redirect)return new Response(null,{status:308,headers:{...selectedFile.headers,Location:new URL(selectedFile.redirect,ORIGIN).href}});
  const cache=await caches.open(CACHE);const cached=await cache.match(selectedFile.path);
  if(cached){
   const responseHeaders=new Headers(cached.headers);for(const [name,value] of Object.entries(selectedFile.headers||{}))responseHeaders.set(name,value);
   if(event.request.method==='HEAD')return new Response(null,{status:cached.status,headers:responseHeaders});
   const range=event.request.headers.get('range');
   if(range){
    const body=await cached.arrayBuffer();const m=/^bytes=(\d*)-(\d*)$/.exec(range);let start,end;
    if(m&&(m[1]||m[2])){start=m[1]?Number(m[1]):Math.max(0,body.byteLength-Number(m[2]));end=m[1]?(m[2]?Math.min(Number(m[2]),body.byteLength-1):body.byteLength-1):body.byteLength-1;}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=body.byteLength)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+body.byteLength}});
    const headers=responseHeaders;headers.set('Content-Range',`bytes ${start}-${end}/${body.byteLength}`);headers.set('Content-Length',String(end-start+1));headers.set('Accept-Ranges','bytes');
    return new Response(body.slice(start,end+1),{status:206,headers});
   }
   return new Response(cached.body,{status:cached.status,headers:responseHeaders});
  }
  try{return await fetch(event.request);}catch{return new Response('This file is not saved yet. Automatic saving resumes when this app is online.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
 })());
});
self.addEventListener('message',event=>{
 const port=event.ports?.[0];if(!port||!['APP_OFFLINE_STATUS','APP_OFFLINE_ENSURE'].includes(event.data?.type))return;
 event.waitUntil((async()=>{
  try{port.postMessage(event.data.type==='APP_OFFLINE_ENSURE'?await fill():await inspect(true));}
  catch(error){port.postMessage({...await inspect(false),ready:false,error:error.message});}
 })());
});
