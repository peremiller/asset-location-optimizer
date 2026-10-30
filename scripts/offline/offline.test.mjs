import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {buildOffline} from './build.mjs';

async function fixture(extra={}){
 const root=await mkdtemp(path.join(tmpdir(),'full-offline-'));
 await mkdir(path.join(root,'privacy'),{recursive:true});await mkdir(path.join(root,'assets'));
 const html='<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\';script-src \'self\';style-src \'self\';worker-src \'none\';connect-src \'self\';frame-src \'none\';object-src \'none\'"></head><body><h1>Public app</h1><script src="/app.js"></script></body></html>';
 await writeFile(path.join(root,'index.html'),html);await writeFile(path.join(root,'privacy/index.html'),html.replace('Public app','Privacy'));
 await writeFile(path.join(root,'app.js'),'globalThis.localTool = 42;');await writeFile(path.join(root,'assets/logo.png'),Buffer.from([0,1,2,3,4,5,255]));
 await writeFile(path.join(root,'_headers'),"/*\n  Content-Security-Policy: default-src 'none';worker-src 'none';frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Permissions-Policy: camera=(), microphone=()\n/privacy/\n  Referrer-Policy: no-referrer\n/privacy\n  Referrer-Policy: same-origin\n");
 await writeFile(path.join(root,'assets/audio.mp3'),Buffer.from([0,1,2,3,4,5,6,7,8,9]));
 await mkdir(path.join(root,'api'));await writeFile(path.join(root,'api/private.json'),'{"secret":true}');
 await writeFile(path.join(root,'.env'),'SECRET=test');
 const report=await buildOffline({directory:root,name:'Test app',chunkBytes:1000,...extra});
 return {root,report};
}

async function harness(root,{stores=new Map(),failPut=0,wrongDigest=false,privatePack=false}={}){
 const listeners={},requests=[];let offline=false,puts=0,skip=false;
 const url=x=>new URL(typeof x==='string'?x:x.url,'https://app.test').href;
 const caches={async keys(){return [...stores.keys()];},async delete(key){return stores.delete(key);},async open(name){
  if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);
  return {async put(key,response){puts++;if(failPut&&puts===failPut)throw Error('Quota exceeded');store.set(url(key),response.clone());},async match(key){return store.get(url(key))?.clone();}};
 }};
 const self={location:{origin:'https://app.test'},clients:{async matchAll(){return[];},async claim(){}},skipWaiting(){skip=true;},addEventListener(type,fn){listeners[type]=fn;}};
 const script=await readFile(path.join(root,'offline-sw.js'),'utf8');
 const config=JSON.parse(script.match(/^const CONFIG = (.*);/)[1]);
 const scope={self,caches,Request,Response,Headers,URL,Set,Map,Uint8Array,TextDecoder,crypto:webcrypto,atob,
  async fetch(request){requests.push(request);if(offline)throw Error('Offline');const parsed=new URL(request.url||request);let body=await readFile(path.join(root,decodeURIComponent(parsed.pathname).replace(config.base,'/')));if(wrongDigest)body=Buffer.from('corrupt');return new Response(body,{headers:{'Cache-Control':privatePack?'private, no-store':'public, max-age=0'}});}
 };
 vm.runInNewContext(script,scope);
 async function event(type,extra={}){let waiting;listeners[type]({waitUntil(p){waiting=p;},...extra});await waiting;}
 return {config,stores,caches,requests,get skip(){return skip;},setOffline(){offline=true;},event,
  async status(type='APP_OFFLINE_STATUS'){let value;await event('message',{data:{type},ports:[{postMessage(v){value=v;}}]});return value;},
  async fetch(pathname,{mode='navigate',method='GET',headers={}}={}){let result;listeners.fetch({request:{url:url(pathname),mode,method,headers:new Headers(headers)},respondWith(p){result=p;}});return result?await result:undefined;},
 };
}

test('The entire static app, an unvisited page, binary assets and data are saved automatically',async()=>{
 const {root,report}=await fixture();const w=await harness(root);await w.event('install');await w.event('activate');
 const status=await w.status();assert.equal(status.ready,true);assert.equal(status.saved,report.staticFiles);assert.equal(w.skip,true);
 assert.equal(w.requests.length,report.packRequests);assert.ok(w.requests.every(r=>r.credentials==='omit'));
 const before=w.requests.length;w.setOffline();
 const privacy=await w.fetch('/privacy/');assert.match(await privacy.text(),/Privacy/);assert.equal(privacy.headers.get('Referrer-Policy'),'no-referrer');
 const page=await w.fetch('/');assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.match(page.headers.get('Content-Security-Policy'),/worker-src 'self'/);assert.equal(page.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(page.headers.get('Permissions-Policy'),'camera=(), microphone=()');
 const redirect=await w.fetch('/privacy');assert.equal(redirect.status,308);assert.equal(redirect.headers.get('Referrer-Policy'),'same-origin');
 assert.deepEqual([...new Uint8Array(await(await w.fetch('/assets/logo.png',{mode:'cors'})).arrayBuffer())],[0,1,2,3,4,5,255]);
 assert.match(await(await w.fetch('/app.js?v=12',{mode:'cors'})).text(),/localTool/);assert.equal(w.requests.length,before);
});
test('No foreign, API, private, auth or write request is intercepted; known HEAD and local media ranges work offline',async()=>{
 const {root}=await fixture();const w=await harness(root);await w.event('install');w.setOffline();
 for(const url of ['/api/private.json','https://other.test/app.js','/account/private'])assert.equal(await w.fetch(url),undefined);
 assert.equal(await w.fetch('/app.js',{method:'POST'}),undefined);
 assert.equal(await w.fetch('/app.js',{headers:{Authorization:'private'}}),undefined);
 const head=await w.fetch('/assets/logo.png',{method:'HEAD',mode:'cors'});assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(head.headers.get('content-length'),'7');
 const range=await w.fetch('/assets/audio.mp3',{mode:'cors',headers:{Range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 2-5/10');assert.deepEqual([...new Uint8Array(await range.arrayBuffer())],[2,3,4,5]);
 const suffix=await w.fetch('/assets/audio.mp3',{mode:'cors',headers:{Range:'bytes=-2'}});assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())],[8,9]);
 assert.equal((await w.fetch('/assets/audio.mp3',{mode:'cors',headers:{Range:'bytes=100-200'}})).status,416);
 assert.equal(w.config.files.some(f=>f.path.includes('/api/')||f.path.includes('.env')),false);
});
test('Readiness detects an evicted or corrupted file and automatic repair restores the whole release',async()=>{
 const {root}=await fixture();const w=await harness(root);await w.event('install');
 const cache=[...w.stores.values()][0];cache.delete('https://app.test/assets/logo.png');assert.equal((await w.status()).ready,false);
 assert.equal((await w.status('APP_OFFLINE_ENSURE')).ready,true);
 const prior=cache.get('https://app.test/app.js');cache.set('https://app.test/app.js',new Response('changed',{headers:prior.headers}));
 assert.equal((await w.status()).ready,false);assert.equal((await w.status('APP_OFFLINE_ENSURE')).ready,true);
});
test('A failed or mismatched release preserves the previous complete cache and unrelated data',async()=>{
 const {root}=await fixture();const old=await harness(root);await old.event('install');await old.caches.open('private-records');const oldKey=[...old.stores.keys()][0];
 await writeFile(path.join(root,'app.js'),'globalThis.changed = 43;');await buildOffline({directory:root,name:'Test app',chunkBytes:1000});
 const broken=await harness(root,{stores:old.stores,wrongDigest:true});await assert.rejects(broken.event('install'));assert.equal(broken.skip,false);assert.equal(broken.stores.has(oldKey),true);assert.equal(broken.stores.has('private-records'),true);
 const privateWorker=await harness(root,{stores:old.stores,privatePack:true});await assert.rejects(privateWorker.event('install'));
 const repaired=await harness(root,{stores:old.stores});await repaired.event('install');await repaired.event('activate');assert.equal((await repaired.status()).ready,true);assert.equal(repaired.stores.has(oldKey),true);
});
test('Interrupted writes resume without deleting the old complete release',async()=>{
 const {root}=await fixture();const w=await harness(root,{failPut:5});await assert.rejects(w.event('install'));assert.equal((await w.status()).ready,false);
 const resumed=await harness(root,{stores:w.stores});await resumed.event('install');assert.equal((await resumed.status()).ready,true);
});
test('The generator is idempotent, narrows CSP changes to first-party capabilities, and reports external runtime dependencies',async()=>{
 const {root,report}=await fixture();const before=await readFile(path.join(root,'index.html'),'utf8');
 const repeat=await buildOffline({directory:root,name:'Test app',chunkBytes:1000});assert.equal(repeat.version,report.version);
 const html=await readFile(path.join(root,'index.html'),'utf8');assert.equal(html,before);assert.match(html,/worker-src 'self'/);assert.match(html,/frame-src 'none'/);assert.match(html,/object-src 'none'/);
 assert.equal((html.match(/data-app-offline-client/g)||[]).length,1);
 await writeFile(path.join(root,'remote.html'),'<html><head></head><body><script src="https://cdn.example/test.js"></script></body></html>');
 const changed=await buildOffline({directory:root,name:'Test app'});assert.deepEqual(changed.externalRuntimeDependencies,['https://cdn.example/test.js']);
 await writeFile(path.join(root,'legacy.js'),"navigator.serviceWorker.register('/legacy-worker.js');");await assert.rejects(buildOffline({directory:root}),/explicit merge/);
});
test('An explicitly verified SPA fallback remains inside its public scope',async()=>{
 const {root}=await fixture({spa:true,base:'/tools/'});const w=await harness(root);await w.event('install');w.setOffline();
 assert.match(await(await w.fetch('/tools/deep/never-visited')).text(),/Public app/);assert.equal(await w.fetch('/outside'),undefined);assert.equal(await w.fetch('/tools/api/private'),undefined);
});
test('Public archives cannot bypass explicit private or no-store response policies, and inherited CSP capabilities survive',async()=>{
 const {root}=await fixture();
 for(const header of ['Cache-Control: private, no-store','Set-Cookie: session=private','WWW-Authenticate: Bearer']){
  await writeFile(path.join(root,'_headers'),'/*\n  '+header+'\n');
  await assert.rejects(buildOffline({directory:root}),/Private or no-store/);
 }
 await writeFile(path.join(root,'_headers'),"/*\n  Content-Security-Policy: default-src 'self' 'unsafe-inline' https://public.example; frame-ancestors 'none'\n  Content-Encoding: gzip\n");
 await buildOffline({directory:root});const w=await harness(root);await w.event('install');
 const page=await w.fetch('/');assert.match(page.headers.get('Content-Security-Policy'),/script-src 'self' 'unsafe-inline' https:\/\/public\.example/);assert.equal(page.headers.get('Content-Encoding'),null);
});
