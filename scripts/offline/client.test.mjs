import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('./client.js',import.meta.url),'utf8')).replace('/* APP_OFFLINE_CLIENT_CONFIG */',JSON.stringify({base:'/',name:'Test',limits:'Cloud needs internet.'}));
function run({online=true,registrationFailure=false}={}){
 const elements=[],listeners={},timers=new Map(),calls=[];let next=0,failed=registrationFailure;
 class Channel{constructor(){this.port1={onmessage:null,close(){}};this.port2={postMessage:data=>queueMicrotask(()=>this.port1.onmessage?.({data}))};}}
 const active={postMessage(message,ports){calls.push(message.type);ports[0].postMessage({ready:true,saved:12,total:12,version:'test'});}};
 const registration={active,async update(){calls.push('update');}};
 const navigator={onLine:online,serviceWorker:{addEventListener(type,fn){listeners[type]=fn;},async getRegistration(){calls.push('getRegistration');return registration;},async register(){calls.push('register');if(failed){failed=false;throw Error('network failure');}return registration;}}};
 const document={readyState:'complete',body:{append(element){elements.push(element);}},createElement(tag){const e={tag,children:[],listeners:{},setAttribute(){},append(...children){e.children.push(...children);},addEventListener(type,fn){e.listeners[type]=fn;}};return e;}};
 const window={isSecureContext:true,addEventListener(type,fn){listeners[type]=fn;}};
 vm.runInNewContext(source,{navigator,document,window,MessageChannel:Channel,Date,Promise,Error,setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}});
 return {elements,calls,listeners,timers,flush:()=>new Promise(setImmediate)};
}
test('A first visit saves automatically without any button interaction',async()=>{
 const app=run();await app.flush();assert.ok(app.calls.includes('register'));assert.ok(app.calls.includes('APP_OFFLINE_STATUS'));
 assert.match(app.elements[0].children[0].textContent,/Saved automatically/);
 assert.equal(app.elements[0].children[1].textContent,'Check offline copy');assert.equal(app.elements[0].children[1].disabled,false);
});
test('A saved app confirms readiness offline without making registration or update network requests',async()=>{
 const app=run({online:false});await app.flush();assert.equal(app.calls.includes('register'),false);assert.equal(app.calls.includes('update'),false);assert.match(app.elements[0].children[0].textContent,/Offline/);
});
test('A failed first save retries automatically with backoff and can finish without a click',async()=>{
 const app=run({registrationFailure:true});await app.flush();const retry=[...app.timers.values()].find(t=>t.ms===2000);assert.ok(retry);assert.match(app.elements[0].children[0].textContent,/will retry/);
 retry.fn();await app.flush();assert.match(app.elements[0].children[0].textContent,/Saved automatically/);
});
