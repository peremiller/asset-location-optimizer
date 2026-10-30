(() => {
 const CONFIG=/* APP_OFFLINE_CLIENT_CONFIG */;
 let busy=false,ready=false,retryTimer,failures=0;
 function start(){
  const aside=document.createElement('aside');aside.className='app-offline';aside.setAttribute('aria-label','Automatic offline saving');
  const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const button=document.createElement('button');button.type='button';button.textContent='Check offline copy';
  const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Offline details';
  const copy=document.createElement('p');copy.textContent=CONFIG.limits+' Offline saving starts automatically on this device. Keep the app open until saving finishes, keep the device charged and retain browser site data.';
  details.append(summary,copy);aside.append(status,button,details);document.body.append(aside);
  const show=result=>{ready=Boolean(result?.ready);status.textContent=ready?`${navigator.onLine?'Saved automatically':'Offline'} · ${result.saved} files across this app are available on this device.`:navigator.onLine?'Saving the complete app automatically…':'Offline saving will resume when internet returns.';};
  show();
  if(!window.isSecureContext||!('serviceWorker'in navigator)){status.textContent='This browser cannot save an offline app. Use HTTPS and a browser that supports service workers.';button.hidden=true;return;}
  const ask=(worker,type)=>new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(Error('Still saving'));},180000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};worker.postMessage({type},[channel.port2]);});
  async function workerFor(registration){
   const deadline=Date.now()+180000;
   while(Date.now()<deadline){
    if(registration.installing)await new Promise(resolve=>setTimeout(resolve,250));
    else if(registration.waiting)await new Promise(resolve=>setTimeout(resolve,250));
    else if(registration.active)return registration.active;
    else throw Error('Offline installation is waiting');
   }
   throw Error('Still saving');
  }
  const schedule=()=>{clearTimeout(retryTimer);if(navigator.onLine!==false)retryTimer=setTimeout(prepare,[2000,5000,10000,30000,60000][Math.min(failures++,4)]);};
  async function prepare(){
   if(busy)return;busy=true;button.disabled=true;clearTimeout(retryTimer);
   try{
    let registration=await navigator.serviceWorker.getRegistration(CONFIG.base);
    if(navigator.onLine!==false){registration=await navigator.serviceWorker.register(CONFIG.base+'offline-sw.js',{scope:CONFIG.base,updateViaCache:'none'});try{await registration.update();}catch{}}
    if(!registration)throw Error('Open online once');
    const worker=await workerFor(registration);let result=await ask(worker,'APP_OFFLINE_STATUS');
    if(!result.ready&&navigator.onLine!==false)result=await ask(worker,'APP_OFFLINE_ENSURE');
    show(result);if(!result.ready)throw Error(result.error||'Still saving');failures=0;
   }catch{ready=false;status.textContent=navigator.onLine===false?'The complete offline copy is not confirmed. Automatic saving resumes when connected.':'Automatic offline saving is waiting for a working connection or enough browser storage. It will retry.';schedule();}
   finally{busy=false;button.disabled=false;}
  }
  navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='APP_OFFLINE_PROGRESS')status.textContent=`Saving complete app automatically · ${event.data.saved} of ${event.data.total} files.`;if(event.data?.type==='APP_OFFLINE_STATUS')show(event.data);});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!busy)prepare();});
  window.addEventListener('online',prepare);window.addEventListener('offline',()=>{if(ready)status.textContent='Offline · using the complete saved app. '+CONFIG.limits;});
  button.addEventListener('click',prepare);prepare();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
