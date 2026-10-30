import {readFile,writeFile,readdir,mkdir,rm,stat,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const mime={html:'text/html; charset=utf-8',js:'application/javascript; charset=utf-8',mjs:'application/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json; charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',avif:'image/avif',gif:'image/gif',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',txt:'text/plain; charset=utf-8',xml:'application/xml; charset=utf-8',pdf:'application/pdf',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',mp4:'video/mp4',webm:'video/webm',vtt:'text/vtt; charset=utf-8',webmanifest:'application/manifest+json; charset=utf-8',csv:'text/csv; charset=utf-8'};
const generated=new Set(['offline-client.js','offline.css','offline-manifest.webmanifest','offline-report.json','offline-sw.js']);
function forbidden(relative){return relative.split('/').some(x=>x.startsWith('.')||['node_modules','api','private','uploads','user-data'].includes(x))||/\.(map|pem|key|p12|pfx|sqlite|db)$/i.test(relative);}
async function walk(root,relative=''){
 const files=[];
 for(const e of (await readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const rel=path.posix.join(relative,e.name);
  if(forbidden(rel))continue;
  if(e.isSymbolicLink())throw new Error('Offline publishing refuses symlink: '+rel);
  if(e.isDirectory())files.push(...await walk(root,rel));else if(e.isFile())files.push(rel);
 }
 return files;
}
function permitFirstParty(policy){
 if(policy.includes("'strict-dynamic'")||/\bsandbox\b/i.test(policy))throw new Error('Nonce/strict-dynamic or sandbox CSP requires an app-specific offline integration');
 const directives=policy.split(';').map(x=>x.trim()).filter(Boolean);
 const inherited=directives.find(x=>x.split(/\s+/)[0].toLowerCase()==='default-src')?.split(/\s+/).slice(1)||[];
 for(const key of ['worker-src','script-src','style-src','connect-src','font-src']){
  const index=directives.findIndex(x=>x.split(/\s+/)[0].toLowerCase()===key);
  if(index<0){const values=inherited.filter(x=>x!=="'none'");if(!values.includes("'self'"))values.push("'self'");directives.push(key+' '+values.join(' '));continue;}
  const values=directives[index].split(/\s+/).slice(1).filter(x=>x!=="'none'");
  if(!values.includes("'self'"))values.push("'self'");
  directives[index]=key+' '+values.join(' ');
 }
 for(const key of ['script-src-elem','style-src-elem']){
  const index=directives.findIndex(x=>x.split(/\s+/)[0].toLowerCase()===key);
  if(index>=0){const values=directives[index].split(/\s+/).slice(1).filter(x=>x!=="'none'");if(!values.includes("'self'"))values.push("'self'");directives[index]=key+' '+values.join(' ');}
 }
 return directives.join('; ');
}
function instrument(html,base){
 html=html.replace(/<script\b[^>]*\bdata-app-offline-client\b[^>]*>\s*<\/script>/gi,'').replace(/<link\b[^>]*\bdata-app-offline-style\b[^>]*>/gi,'');
 html=html.replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])Content-Security-Policy\1[^>]*>/gi,tag=>tag.replace(/content\s*=\s*(["'])([\s\S]*?)\1/i,(_,q,value)=>'content='+q+permitFirstParty(value)+q));
 const tags=`<link rel="stylesheet" href="${base}offline.css" data-app-offline-style><script src="${base}offline-client.js" defer data-app-offline-client></script>`;
 if(!/<\/head\s*>/i.test(html))throw new Error('Offline HTML requires a head element');
 return html.replace(/<\/head\s*>/i,tags+'</head>');
}
function externalDependencies(files){
 const runtime=new Set(),links=new Set();
 for(const {relative,body} of files){
  if(!/\.(html|css|[cm]?js)$/i.test(relative))continue;
  const s=body.toString('utf8');
  for(const match of s.matchAll(/<(?:script|iframe|audio|video|source|img)\b[^>]*?src\s*=\s*["'](https?:\/\/[^"']+|\/\/[^"']+)["']/gi))runtime.add(match[1]);
  for(const match of s.matchAll(/<link\b[^>]*>/gi)){
   const rel=match[0].match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1]||'';
   const href=match[0].match(/\bhref\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/i)?.[1];
   if(href&&/\b(?:stylesheet|preload|modulepreload|icon|manifest)\b/i.test(rel))runtime.add(href);
  }
  for(const match of s.matchAll(/(?:@import\s+(?:url\()?\s*["']?|url\(\s*["']?)(https?:\/\/[^"')\s]+|\/\/[^"')\s]+)/gi))runtime.add(match[1]);
  for(const match of s.matchAll(/(?:fetch|EventSource|WebSocket)\(\s*["'`]([^"'`]+)["'`]/gi))links.add(match[1]);
 }
 return {runtime:[...runtime].sort(),fetches:[...links].sort()};
}
function headerRules(text){
 const rules=[];let rule;
 for(const line of text.split(/\r?\n/)){
  if(!line.trim()||line.trim().startsWith('#'))continue;
  if(!/^\s/.test(line)){rule={pattern:line.trim(),headers:{}};rules.push(rule);continue;}
  const m=/^\s+([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
  if(rule&&m)rule.headers[m[1].toLowerCase()]=m[2];
 }
 return rules;
}
function headersFor(url,rules){
 const result={};
 for(const rule of rules){
  if(!rule.pattern.startsWith('/'))continue;
  const pattern='^'+rule.pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*')+'$';
  if(new RegExp(pattern).test(url))Object.assign(result,rule.headers);
 }
 return result;
}
function publicHeaders(headers,url){
 if(headers['set-cookie']||headers['www-authenticate']||/\b(?:private|no-store)\b/i.test(headers['cache-control']||''))throw new Error('Private or no-store static response cannot enter the public offline bundle: '+url);
 return Object.fromEntries(Object.entries(headers).filter(([name])=>!/^(?:authorization|proxy-authenticate|content-encoding|content-length|transfer-encoding|connection|keep-alive|trailer|upgrade)$/i.test(name)));
}

export async function buildOffline({directory='dist',base='/',name='This app',limits='External websites, cloud services, live data, streaming and account actions still require internet.',spa=false,chunkBytes=2*1024*1024}={}){
 const root=path.resolve(directory);
 if(!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))throw new Error('Offline base must be an absolute directory path ending in /');
 if(!await stat(path.join(root,'index.html')).then(x=>x.isFile()).catch(()=>false))throw new Error('No published index.html in '+root);
 await rm(path.join(root,'offline-packs'),{recursive:true,force:true});
 for(const file of generated)await rm(path.join(root,file),{force:true});
 let published=await walk(root);
 const fontMap=await readFile(path.join(here,'vendor/google-fonts.json'),'utf8').then(JSON.parse).catch(()=>null);
 if(fontMap){
  await cp(path.join(here,'vendor/assets'),path.join(root,'offline-fonts'),{recursive:true});
  for(const relative of published.filter(p=>/\.(?:html|css)$/i.test(p))){
   const original=await readFile(path.join(root,relative),'utf8');let text=original;
   for(const [url,file] of Object.entries(fontMap.stylesheets))text=text.split(url).join(base+'offline-fonts/'+file);
   if(text!==original)await writeFile(path.join(root,relative),text);
  }
 }
 const existingWorkers=[];
 for(const relative of published.filter(p=>/\.(?:html|[cm]?js)$/i.test(p))){const code=await readFile(path.join(root,relative),'utf8');if(/serviceWorker\s*\.\s*register\s*\(/.test(code))existingWorkers.push(relative);}
 if(existingWorkers.length)throw new Error('Existing service worker integration requires an explicit merge before using the static engine: '+existingWorkers.join(', '));
 const headers=published.filter(p=>p==='_headers');
 for(const file of headers){const original=await readFile(path.join(root,file),'utf8');await writeFile(path.join(root,file),original.replace(/(Content-Security-Policy:\s*)([^\r\n]*)/gi,(_,prefix,policy)=>prefix+permitFirstParty(policy)));}
 const rules=headerRules(await readFile(path.join(root,'_headers'),'utf8').catch(()=>''));
 for(const file of published.filter(p=>/\.html$/i.test(p)))await writeFile(path.join(root,file),instrument(await readFile(path.join(root,file),'utf8'),base));
 const css=await readFile(path.join(here,'style.css'),'utf8');
 await writeFile(path.join(root,'offline.css'),css);
 const client=await readFile(path.join(here,'client.js'),'utf8');
 await writeFile(path.join(root,'offline-client.js'),client.replace('/* APP_OFFLINE_CLIENT_CONFIG */',JSON.stringify({base,name,limits})));
 published=(await walk(root)).filter(p=>!['_headers','_redirects'].includes(p));
 const files=[];
 for(const relative of published){
  const body=await readFile(path.join(root,relative));
  const url=base+relative.split('/').map(encodeURIComponent).join('/');
  files.push({relative,path:url,type:mime[relative.split('.').at(-1).toLowerCase()]||'application/octet-stream',headers:publicHeaders(headersFor(url,rules),url),size:body.length,sha256:sha(body),body});
 }
 const routes={};
 for(const f of files.filter(f=>f.relative.endsWith('.html'))){
  routes[f.path]={path:f.path};
  if(f.relative.endsWith('index.html')){
   const canonical=f.path.slice(0,-10);routes[canonical]={path:f.path};
   if(canonical!==base)routes[canonical.slice(0,-1)]={path:f.path,redirect:canonical};
  }else routes[f.path.slice(0,-5)]={path:f.path,redirect:f.path};
 }
 for(const [url,route] of Object.entries(routes))route.headers=publicHeaders(headersFor(url,rules),url);
 const groups=[];let group=[],bytes=0;
 for(const file of files){if(group.length&&bytes+file.size>chunkBytes){groups.push(group);group=[];bytes=0;}group.push(file);bytes+=file.size;}
 if(group.length)groups.push(group);
 await mkdir(path.join(root,'offline-packs'),{recursive:true});
 const packs=[];
 for(let index=0;index<groups.length;index++){
  const group=groups[index];const archive=JSON.stringify({schema:1,files:group.map(f=>({path:f.path,body:f.body.toString('base64')}))});
  const pack={path:base+`offline-packs/${index}.json`,sha256:sha(archive),files:group.map(f=>f.path),bytes:Buffer.byteLength(archive)};
  await writeFile(path.join(root,'offline-packs',`${index}.json`),archive);packs.push(pack);
 }
 const manifest=files.map(({body,relative,...f})=>f);
 const sw=await readFile(path.join(here,'worker.js'),'utf8');
 const version=sha(JSON.stringify({manifest,routes,base,spa,worker:sha(sw)})).slice(0,20);
 const config={schema:1,version,base,name,limits,spa,files:manifest,routes,packs,bytes:files.reduce((s,f)=>s+f.size,0)};
 await writeFile(path.join(root,'offline-sw.js'),sw.replace('/* APP_OFFLINE_CONFIG */',JSON.stringify(config)));
 const dependencies=externalDependencies(files);
 const report={schema:1,version,automatic:true,staticFiles:files.length,htmlPages:files.filter(f=>f.relative.endsWith('.html')).length,totalBytes:config.bytes,packRequests:packs.length,externalRuntimeDependencies:dependencies.runtime,externalFetches:dependencies.fetches,limits,scope:base};
 await writeFile(path.join(root,'offline-report.json'),JSON.stringify(report,null,2)+'\n');
 return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);const value=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
 console.log(JSON.stringify(await buildOffline({directory:value('--dir')||'dist',base:value('--base')||'/',name:value('--name')||'This app',limits:value('--limits'),spa:args.includes('--spa')})));
}
