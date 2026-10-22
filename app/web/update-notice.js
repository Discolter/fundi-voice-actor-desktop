// A lightweight, desktop-only update notice. The signed launcher performs installation.
const CHECK_INTERVAL=10*60*1000;
const VERSION=/^\d+\.\d+\.\d+$/;

export function startUpdateNotice({api,label,beforeRestart=async()=>true}) {
  if(typeof document==='undefined')return;
  const key='fundi-update-notice-dismissed-'+label.toLowerCase();
  let shownVersion='',checking=false,restarting=false;

  function hide() {
    document.querySelector('#fundi-update-notice')?.remove();
    shownVersion='';
  }
  function display(info) {
    if(!info?.available || !VERSION.test(info.latestVersion||'') || !VERSION.test(info.currentVersion||'')) {
      hide();return;
    }
    if(sessionStorage.getItem(key)===info.latestVersion){hide();return;}
    if(shownVersion===info.latestVersion&&document.querySelector('#fundi-update-notice'))return;
    hide();
    shownVersion=info.latestVersion;
    const notice=document.createElement('aside');
    notice.id='fundi-update-notice';
    notice.className='fundi-update-notice';
    notice.setAttribute('role','status');
    const title=document.createElement('strong');
    title.textContent='Доступно обновление '+label;
    const details=document.createElement('p');
    details.textContent='Версия '+info.currentVersion+' → '+info.latestVersion+'. Можно обновить программу, не переустанавливая её.';
    const actions=document.createElement('div');actions.className='fundi-update-actions';
    const later=document.createElement('button');later.type='button';later.className='fundi-update-later';later.textContent='Позже';
    later.addEventListener('click',()=>{sessionStorage.setItem(key,info.latestVersion);hide();});
    const main=document.createElement('button');main.type='button';main.className='fundi-update-restart';
    main.textContent=info.canRestart?'Перезапустить и обновить':'Открыть выпуск';
    main.addEventListener('click',async()=>{
      if(restarting)return;
      if(!info.canRestart){window.open(info.releaseUrl,'_blank','noopener,noreferrer');return;}
      restarting=true;main.disabled=true;
      try {
        const ready=await beforeRestart();
        if(ready===false){restarting=false;main.disabled=false;return;}
        await api('update/restart',{});
        main.textContent='Перезапускаем…';
        later.disabled=true;
      }catch(error){
        details.textContent=error?.message||'Не удалось перезапустить программу. Закрой её и запусти лаунчер вручную.';
        restarting=false;main.disabled=false;
      }
    });
    actions.append(later,main);notice.append(title,details,actions);document.body.append(notice);
  }
  async function check() {
    if(checking||restarting)return;
    checking=true;
    try {display(await api('update/check'));}catch{ /* Offline mode must not interrupt Studio or Actor. */ }
    finally{checking=false;}
  }
  check();
  return window.setInterval(check,CHECK_INTERVAL);
}
