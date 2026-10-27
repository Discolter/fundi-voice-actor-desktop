import {formatBytes,storageMeter,transferPanel,fileStatus} from './file-tools.js';
import {ageBadge} from './age.js';
import {startUpdateNotice} from './update-notice.js';
import {openFileBrowser} from './file-browser.js';
import {STAGES,THEMES,escapeHTML as e,today,isDebt,dueLabel,stageLabel,matches,selectDebts,groupProjects,reviewedRole,messageKind,hasAssignedRole,actorWorkloadClass,ACTOR_ROLE_SORTS,sortActorRoles,sortActorProjects,actorProjectWorkload,visibleAcceptedRoles,acceptedHiddenRoles} from './core.js';
const paths={projects:'M3 4h7l2 3h9v14H3Z',debts:'m12 3 10 18H2ZM12 9v5M12 18h.01',sync:'M3 11a9 9 0 0 1 15-6l3 3M21 3v5h-5M21 13a9 9 0 0 1-15 6l-3-3M3 21v-5h5',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l-1 3-3 1-2 3 2 3-1 3 3 2 3-1 2 4 3-1 1-3 3-1 2-3-2-3 1-3-3-2-3 1-2-4Z',logout:'M9 3H3v18h6M12 12h10m-5-5 5 5-5 5',chevron:'m9 5 7 7-7 7',search:'M21 21l-5-5M17 10a7 7 0 1 0-14 0 7 7 0 0 0 14 0Z',check:'m5 12 4 4L19 6',close:'m6 6 12 12M18 6 6 18'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.projects}"/></svg>`;
paths.files='M14 2H5v20h14V7ZM14 2v6h5M8 13h8M8 17h5';
paths.bell='M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4';
paths.vacation='M12 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM5 21h14M8 11h8';
paths.history='M3 4h18v5H3zM5 9v11h14V9M9 13h6M10 3v3M14 3v3';
const app=document.querySelector('#app'),modal=document.querySelector('#modal');
let state={authenticated:false,server:'',username:'',view:null,error:'',lastSync:'',busy:false};
let ui={page:'projects',query:'',filter:'all',roleSort:'default',activate:false,recover:false,theme:'aurora',motion:true,expanded:new Set(),collapsed:new Set()},token='',formBusy=false,lastStatus='';
try{const saved=JSON.parse(localStorage.getItem('fundi-actor-appearance')||'{}');if(THEMES.some(t=>t[0]===saved.theme))ui.theme=saved.theme;if(saved.motion===false)ui.motion=false;if(ACTOR_ROLE_SORTS.some(([id])=>id===saved.roleSort))ui.roleSort=saved.roleSort;}catch{}
let notificationLimit=50,recordingRoleFilter='',hiddenTransferId='';
function renderTransferNotice(){document.querySelector('#file-transfer-slot').innerHTML=transferPanel(state.transfer,'actor-',hiddenTransferId);}
const roles=()=>(Array.isArray(state.view?.feed?.roles)?state.view.feed.roles:[]).map(role=>reviewedRole(role,state.view?.reviews||[],state.mailbox?.pending||[]));
const unread=()=>Number(state.mailbox?.unread)||0;
const stamp=value=>value?new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Ещё не обновляли';
async function api(route,body){
  const response=await fetch('/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-Fundi-Key':token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json().catch(()=>({error:'Перезапусти Fundi Voice Actor.'}));
  if(!response.ok)throw new Error(result.error||'Не удалось выполнить действие.');return result;
}
function toast(text,error=false){const node=document.createElement('div');node.className='toast'+(error?' error':'');node.textContent=text;document.querySelector('#toasts').append(node);setTimeout(()=>node.remove(),error?9000:4000);}
function appearance(){document.body.dataset.theme=ui.theme;document.body.dataset.motion=ui.motion?'on':'off';}
function vacationDay(value){return value ? new Date(value+'T12:00:00').toLocaleDateString('ru-RU') : 'дата пока неизвестна';}
function vacationView(){
  const unavailable=state.vacationApiAvailable!==true;
  const info=state.vacation||{};
  const v=info.current;
  const history=Array.isArray(info.history)?info.history:[];
  const statuses={active:'В отпуске',planned:'Запланирован',completed:'Завершён',ended:'Вернулся к работе',cancelled:'Отменён'};
  if(unavailable) return `<section class="vacation-panel"><h2>Отпуск</h2><p class="muted">${e(state.vacationError||'Система отпусков пока недоступна. Попробуй обновить приложение.')}</p><button class="btn ghost" data-action="sync">${icon('sync')} Обновить</button></section>`;
  let form='';
  if(!v){
    form=`<section class="vacation-panel"><div class="vacation-icon">${icon('vacation')}</div><h2>Нужен отпуск?</h2><p class="muted">Выбери даты, чтобы руководитель знал, когда тебя не стоит назначать на новые роли. Одобрение не требуется, уже назначенные роли сохранятся.</p>
      <form id="vacation-create-form" class="vacation-form">
      <label>Первый день отпуска<input type="date" name="startDate" value="${today()}" min="${today()}" required></label>
      <label>Последний день (необязательно)<input type="date" name="endDate" min="${today()}"></label>
      <label>Причина (необязательно, видна только руководителю)<textarea name="reason" maxlength="800" rows="3" placeholder="Можно не заполнять"></textarea></label>
      <button type="submit" class="btn primary">Уйти в отпуск</button></form></section>`;
  }else{
    form=`<section class="vacation-panel"><div class="vacation-icon">${icon('vacation')}</div><h2>${e(statuses[v.status]||v.status)}</h2>
      <p class="muted">С ${e(vacationDay(v.startDate))} по ${e(vacationDay(v.endDate))}. ${v.status==='active'?'Ты сейчас недоступен для новых назначений.':'Отпуск начнётся автоматически в указанную дату.'}</p>
      <form id="vacation-update-form" class="vacation-form">
      <label>Изменить дату возвращения<input type="date" name="endDate" value="${e(v.endDate||'')}" min="${e(v.startDate)}"></label>
      <label>Причина (необязательно)<textarea name="reason" maxlength="800" rows="3">${e(v.reason||'')}</textarea></label>
      <button type="submit" class="btn primary">Сохранить изменения</button></form>
      <button type="button" class="btn ghost vacation-end" data-action="vacation-end">${v.status==='planned'?'Отменить отпуск':'Вернуться к работе'}</button></section>`;
  }
  const historyHTML=history.slice(0,30).map(item=>`<div class="vacation-history-item"><strong>${e(statuses[item.status]||item.status)}</strong><small>${e(vacationDay(item.startDate))} — ${e(vacationDay(item.endDate))}</small>${item.reason?`<p>${e(item.reason)}</p>`:''}</div>`).join('');
  return form+`<section class="vacation-panel vacation-history"><h2>История отпусков</h2>${historyHTML||'<p class="muted">Истории отпусков пока нет.</p>'}</section>`;
}
function render(){
  appearance();
  if(!state.authenticated){renderLogin();return;}
  const all=roles(),active=visibleAcceptedRoles(all,state.view?.hiddenRoleIds),archived=acceptedHiddenRoles(all,state.view?.hiddenRoleIds),debts=active.filter(isDebt),projects=groupProjects(active);
  const focused=document.activeElement?.id==='search',caret=focused?document.activeElement.selectionStart:0;
  app.innerHTML=`<div class="actor-shell"><aside class="actor-sidebar"><div class="actor-brand"><img src="brand-mark.png" alt=""><span>Fundi Voice<small>Actor</small></span></div><nav><button class="nav-item ${ui.page==='projects'?'active':''}" data-page="projects">${icon('projects')}<span>Проекты</span><b>${projects.length}</b></button><button class="nav-item ${ui.page==='debts'?'active':''}" data-page="debts">${icon('debts')}<span>Мои долги</span><b>${debts.length}</b></button><button class="nav-item ${ui.page==='history'?'active':''}" data-page="history">${icon('history')}<span>История</span><b>${archived.length}</b></button><button class="nav-item ${ui.page==='files'?'active':''}" data-action="recordings" aria-current="${ui.page==='files'?'page':'false'}">${icon('files')}<span>Мои файлы</span></button></nav><div class="actor-profile"><div class="profile-initial">${e(state.username.slice(0,1).toUpperCase())}</div><div><strong>${e(state.username)}</strong><small>Актёр студии</small></div><button class="icon-btn" data-action="settings" aria-label="Настройки" title="Настройки">${icon('settings')}</button></div><button class="nav-item vacation-sidebar ${ui.page==='vacation'?'active':''}" data-page="vacation">${icon('vacation')}<span>Отпуск</span>${state.vacation?.current?.status==='active'?'<b>В отпуске</b>':''}</button></aside><main class="actor-main"><header class="actor-top"><div><span class="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</span><h1>${ui.page==='vacation'?'Отпуск':ui.page==='files'?'Мои файлы':ui.page==='projects'?'Твои проекты':ui.page==='history'?'История ролей':'Мои долги'}</h1></div><div class="actor-tools"><button class="icon-btn notification-bell" data-action="messages" aria-label="Уведомления" title="Уведомления">${icon('bell')}<b data-message-count ${unread()||state.mailbox?.failed?.length?'':'hidden'}>${unread()||(state.mailbox?.failed?.length?'!':'')}</b></button><label class="actor-search">${icon('search')}<input id="search" placeholder="Найти роль или проект" value="${e(ui.query)}"></label><button class="btn ghost icon-text" data-action="sync" ${state.busy?'disabled':''}>${icon('sync')}${state.busy?'Обновляем…':'Обновить'}</button></div></header><div class="sync-line"><span class="sync-dot ${state.error?'offline':''}"></span><span>${state.error?'Нет свежего обновления':'Обновлено'} · ${e(stamp(state.lastSync))}</span></div>${state.error?`<div class="offline-note">${e(state.error)} Сохранённые назначения доступны для просмотра.</div>`:''}<div class="actor-content">${ui.page==='vacation'?vacationView():ui.page==='files'?actorFilesContent(''):ui.page==='projects'?renderProjects(active):ui.page==='history'?renderHistory(archived):renderDebts(active)}</div><footer>Назначения обновляются раз в минуту, пока приложение работает. Закрытие окна оставляет приложение в трее.</footer></main></div>`;
  if(focused){const input=document.querySelector('#search');input.focus();input.setSelectionRange(caret,caret);}
}
function renderRecovery(){
 const server=state.server||'https://fundi-voice-cloud.onrender.com';
 app.innerHTML=`<main class="auth-shell"><section class="auth-card"><div class="auth-brand"><img src="brand-mark.png" alt=""><div><strong>Fundi Voice</strong><span>Actor</span></div></div>
 <h1>Восстановление доступа</h1>
 <p class="auth-sub">Отправь запрос руководителю студии. После проверки он выдаст новый код приглашения. Все твои роли сохранятся.</p>
 <form id="recovery-form">
 <label>Сервер<input name="server" type="url" value="${e(server)}" required></label>
 <label>Логин, Telegram или имя актёра<input name="identifier" maxlength="128" required autocomplete="username" placeholder="Логин, @Telegram или имя"></label>
 <p class="form-error" id="recovery-error" role="alert"></p>
 <button class="btn primary auth-submit" type="submit">Отправить запрос</button>
 </form><div class="auth-footer"><button class="btn ghost" data-action="back-login" type="button">Назад ко входу</button></div>
 </section></main>`;
}
function renderLogin(){
  if(ui.recover){renderRecovery();return;}
  const server=state.server||'https://fundi-voice-cloud.onrender.com';
  app.innerHTML=`<main class="auth-shell"><section class="auth-card"><div class="auth-brand"><img src="brand-mark.png" alt=""><div><strong>Fundi Voice</strong><span>Actor</span></div></div><h1>${ui.activate?'Добро пожаловать в состав':'С возвращением'}</h1><p class="auth-sub">${ui.activate?'Вставь приглашение и создай свой аккаунт.':'Твои проекты, роли и сроки — в одном месте.'}</p><div class="auth-tabs"><button data-auth="login" class="${!ui.activate?'active':''}">Вход</button><button data-auth="activate" class="${ui.activate?'active':''}">По приглашению</button></div><form id="auth-form"><label>Сервер<input name="server" type="url" value="${e(server)}" required autocomplete="url"></label>${ui.activate?'<label>Приглашение<textarea name="code" rows="2" required placeholder="Код или всё сообщение от руководителя"></textarea></label>':''}<label>Логин<input name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,31}" autocomplete="username" placeholder="Твой ник латиницей"></label><label>Пароль<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="${ui.activate?'new-password':'current-password'}" placeholder="От 10 символов"></label>${ui.activate?'<label>Повтори пароль<input name="confirm" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>':''}<p class="form-error" id="auth-error" role="alert">${e(state.error)}</p><button class="btn primary auth-submit" type="submit" ${formBusy?'disabled':''}>${formBusy?'Подключаемся…':ui.activate?'Создать аккаунт':'Войти'}</button></form><div class="auth-footer"><button type="button" class="btn ghost" data-action="recover">Забыли пароль?</button><span>Приглашение выдаёт руководитель студии.</span><button class="icon-btn" data-action="settings" title="Тема" aria-label="Тема">${icon('settings')}</button></div></section></main>`;
}
function empty(title,text){return `<div class="actor-empty"><div>${icon('projects')}</div><h2>${e(title)}</h2><p>${e(text)}</p></div>`;}
const telegramSourceLink=url=>typeof url==='string'&&/^https:\/\/(?:t\.me|telegram\.me)\/[A-Za-z0-9_+/-]+\/?$/.test(url);
function roleSortControl(){
  return `<label class="actor-role-sort-label" for="actor-role-sort"><span>${ui.page==='debts'?'Сортировка ролей':'Сортировка аниме по сумме реплик'}</span><select id="actor-role-sort" aria-label="${ui.page==='debts'?'Сортировка ролей':'Сортировка аниме по суммарному количеству реплик'}">${ACTOR_ROLE_SORTS.map(([id,label])=>`<option value="${id}" ${ui.roleSort===id?'selected':''}>${e(label)}</option>`).join('')}</select></label>`;
}
function renderProjects(all){
  const projects=sortActorProjects(groupProjects(all,ui.query),ui.roleSort);
  if(!projects.length)return empty(ui.query?'Ничего не найдено':'Нет ролей в проектах',ui.query?'Попробуй другой запрос.':'Принятые роли могут находиться во вкладке «История».');
  return `<div class="actor-role-sort-bar">${roleSortControl()}</div><div class="project-stack">${projects.map((p,index)=>{
    const debt=p.roles.filter(isDebt).length,done=p.roles.filter(r=>r.status==='done').length;
    const sources=[...new Set(p.roles.map(r=>r.sourceUrl).filter(telegramSourceLink))];
    const projectSource=sources.length===1?sources[0]:'';
    const title=projectSource?`<a class="project-source-link" href="${e(projectSource)}" target="_blank" rel="noopener noreferrer" title="Открыть исходники в Telegram">${e(p.title)} ↗</a>`:`${e(p.title)}`;

    return `<details class="actor-project" data-project="${e(p.id)}" ${ui.expanded.has(p.id)||(projects.length<4&&!ui.collapsed.has(p.id))?'open':''}><summary><span class="project-monogram">${e(p.title.slice(0,1))}</span><span class="project-heading"><strong>${title}</strong><small>${p.season?'Сезон '+e(p.season)+' · ':''}${p.episodes.size} сер. · ${p.roles.length} рол. · ${actorProjectWorkload(p).known?`Σ ${actorProjectWorkload(p).total} репл.${actorProjectWorkload(p).missing?' (частично)':''}`:'Реплики не указаны'}</small></span><span class="project-meta">${ageBadge(p.roles[0]?.projectCreatedAt,true)}${debt?`<span class="debt-count">${debt} к записи</span>`:`<span class="all-done">${done===p.roles.length?'Всё принято':'В работе'}</span>`}</span>${icon('chevron')}</summary><div class="project-episodes">${[...p.episodes.values()].sort((a,b)=>Number(a.number)-Number(b.number)).map(ep=>`<section class="actor-episode"><h3>${ep.number?'Серия '+e(ep.number):e(ep.title||'Серия')}${ep.title&&ep.number?` <span>· ${e(ep.title)}</span>`:''}${[...new Set(ep.roles.map(r=>r.sourceUrl).filter(telegramSourceLink))][0]?` <a class="episode-source-link" href="${e([...new Set(ep.roles.map(r=>r.sourceUrl).filter(telegramSourceLink))][0])}" target="_blank" rel="noopener noreferrer">Исходники ↗</a>`:''}</h3><div class="role-list">${sortActorRoles(ep.roles,ui.roleSort).map(r=>roleRow(r,false)).join('')}</div></section>`).join('')}</div></details>`;
  }).join('')}</div>`;
}
function renderHistory(hiddenRoles){
  const filtered=hiddenRoles.filter(r=>matches(r,ui.query));
  if(!filtered.length)return empty(ui.query?'В истории ничего не найдено':'История пока пуста',
    ui.query?'Попробуй другой запрос.':'Здесь будут находиться принятые роли, скрытые тобой или руководителем.');
  const projects=groupProjects(filtered);
  return `<section class="actor-history-intro"><div>${icon('history')}<strong>Завершённые роли</strong></div><p>Эти роли скрыты из активных проектов, но сохранены в студии. Ты или руководитель можете вернуть любую роль обратно.</p></section>
    <div class="actor-history-stack">${[...projects.values()].map(p=>`<section class="actor-history-project">
      <h2>${e(p.title)}${p.season?' · Сезон '+e(p.season):''}</h2>
      ${[...p.episodes.values()].sort((a,b)=>Number(a.number||0)-Number(b.number||0)).map(ep=>`<div class="actor-history-episode">
      <h3>${ep.number?'Серия '+e(ep.number):e(ep.title||'Серия')}${ep.title&&ep.number?' · '+e(ep.title):''}</h3>
      <div class="actor-history-role-list">${ep.roles.map(r=>roleRow(r,true,true)).join('')}</div>
      </div>`).join('')}
    </section>`).join('')}</div>`;
}
function roleRow(role,showProject=true,hidden=false){
  const late=role.due&&role.due<today()&&isDebt(role);
  const review=role.review,waiting=role.queued||review?.state==='pending',accepted=role.status==='done';
  const canSubmit=enabled=>enabled&&!role.queued&&!accepted;
  const submitLabel=role.queued?'Отправляем…':accepted?'Принято':waiting?'Отправить повторно':role.status==='retake'?'Сдать исправленное':'Сдать на проверку';
  const feedback=review?.messageText&&(review.messageKind==='note'||review.messageKind===review.state)?review.messageText:'';
  const enabled=state.view?.reviewApiAvailable===true;
  return `<div class="actor-role-wrap"><div class="actor-role" data-status="${e(role.status)}"><div class="role-name"><strong>${e(role.character)}</strong>${Number.isInteger(role.lineCount)&&role.lineCount>=0?`<small class="actor-role-lines ${actorWorkloadClass(role.lineCount)}" title="${role.lineCount<=50?'Мало реплик (0–50)':role.lineCount<=100?'Средний объём (51–100)':'Много реплик (101+)'}">Реплик: ${role.lineCount}</small>`:''}${showProject?`<small>${e(role.projectTitle)} · ${role.season?'С'+e(role.season)+' · ':''}${role.episodeNumber?'Серия '+e(role.episodeNumber):e(role.episodeTitle||'Серия')}</small>`:''}</div><span class="role-stage stage-${e(role.status)}">${e(role.reviewLabel)}</span>${['waiting','retake','recording'].includes(role.status)?`<label class="actor-recording-check" title="Отметить начало записи"><input type="checkbox" class="recording-toggle" data-role="${e(role.roleId)}" ${role.status==='recording'?'checked':''}> В записи</label>`:''}${ageBadge(role.createdAt)}<span class="role-due ${late?'overdue':''}">${late?'Просрочено · ':''}${e(dueLabel(role.due))}</span>${accepted?`<button class="btn ghost actor-role-visibility" data-action="role-visibility" data-role="${e(role.roleId)}" data-hidden="${hidden?'false':'true'}">${hidden?'Вернуть в мои роли':'Скрыть из кабинета'}</button>`:''}<button class="btn ${waiting||accepted?'ghost':'primary'} submit-role" data-action="submit-role" data-role="${e(role.roleId)}" ${!canSubmit(enabled)?'disabled':''} title="${!enabled?'Руководителю нужно обновить сервер до Cloud 0.3.1':role.queued?'Дождись завершения предыдущей отправки':accepted?'Роль принята':'Загрузить запись и сдать на проверку'}">${submitLabel}</button></div>${feedback?`<div class="role-feedback" data-kind="${e(review.messageKind)}"><strong>${e(messageKind(review.messageKind))}</strong><p>${e(feedback)}</p></div>`:''}</div>`;
}
document.addEventListener('change',async event=>{
  const input=event.target.closest?.('.recording-toggle');
  if(!input)return;
  const desired=input.checked;input.disabled=true;
  try{
    state=await api('recording',{roleId:input.dataset.role,recording:desired});
    render();
    toast(desired?'Отмечено: запись начата.':'Отметка записи снята.');
  }catch(err){input.checked=!desired;input.disabled=false;toast(err.message||'Не удалось обновить статус',true);}
});
function showSubmission(roleId){
  const role=roles().find(item=>item.roleId===roleId);if(!role)return;
  modal.dataset.view='submit';
  const uploaded=(state.files||[]).filter(f=>f.roleId===roleId&&f.status==='ready').length;
  modal.innerHTML=`<div class="modal-head"><div><h2 id="modal-title">${role.review?.state==='pending'?'Повторная сдача':role.status==='retake'?'Сдать исправленное':'Сдать на проверку'}</h2><span class="muted">${e(role.character)} · ${e(role.projectTitle)} · ${role.episodeNumber?'Серия '+e(role.episodeNumber):'Серия'}</span></div><button class="icon-btn" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></div><div class="submission-upload"><p class="review-intro">Выбери готовую запись или ZIP с дублями. После загрузки программа сама сдаст роль и уведомит руководителя.</p><button class="btn primary" data-action="upload-recording" data-role="${e(roleId)}" ${state.transfer?.state==='running'?'disabled':''}>Выбрать запись и загрузить</button><p class="file-hint">WAV, ZIP, FLAC, MP3, OGG · до 2 ГиБ на файл. Перед выбором закончи экспорт записи.</p>${state.fileError?`<p class="file-error">${e(state.fileError)}</p>`:''}${storageMeter(state.usedBytes,state.quotaBytes)}<button class="btn ghost" data-action="role-recordings" data-role="${e(roleId)}">Загруженные записи${uploaded?' · '+uploaded:''}</button></div><details class="file-telegram"><summary>Запись отправлена в Telegram</summary><p class="file-hint">Если передал файл в рабочем чате, отправь уведомление о сдаче отдельно.</p><button class="btn ghost" data-action="confirm-submit" data-role="${e(roleId)}">Файл отправлен — сдать</button></details>`;
  if(!modal.open)modal.showModal();
}
async function showActorFiles(roleId=''){
  recordingRoleFilter=roleId;state=await api('files/refresh',{});
  if(roleId)renderActorFiles();else{ui.page='files';ui.query='';modal.close();render();}
  renderTransferNotice();
}
function refreshFilesView(){if(modal.open&&modal.dataset.view==='recordings')renderActorFiles();else render();}
function renderActorFiles(){
  const scroll=modal.querySelector('.recording-list')?.scrollTop||0;
  modal.dataset.view='recordings';
  modal.innerHTML=`<div class="modal-head"><div><h2 id="modal-title">Записи роли</h2><span class="muted">Готовые и незавершённые загрузки</span></div><button class="icon-btn" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></div>${actorFilesContent(recordingRoleFilter)}`;
  if(!modal.open)modal.showModal();modal.querySelector('.recording-list').scrollTop=scroll;
}
function actorFilesContent(roleId){
  const items=(state.files||[]).filter(f=>(!roleId||f.roleId===roleId)&&(!ui.query||f.fileName.toLocaleLowerCase('ru').includes(ui.query.toLocaleLowerCase('ru'))));
  const busy=state.transfer?.state==='running';
  return `${storageMeter(state.usedBytes,state.quotaBytes)}<div class="file-toolbar"><button class="btn ghost" data-action="refresh-recordings">Обновить список</button></div>${state.fileError?`<p class="file-error">${e(state.fileError)}</p>`:''}<div class="recording-list">${items.map(f=>{
    const role=roles().find(r=>r.roleId===f.roleId);
    return `<article class="recording-entry"><strong>${e(f.fileName)}</strong><div class="recording-context">${role?e(role.character+' · '+role.projectTitle):'Роль больше не назначена тебе'}</div><div class="recording-meta"><span>${e(formatBytes(f.size))}</span><span>${e(stamp(f.createdAt))}</span><span>${e(fileStatus(f.status))}</span></div><div class="recording-actions">${role&&f.status!=='deleting'?`<button class="btn ghost" data-action="confirm-recording" data-file="${e(f.fileId)}" ${busy||role.queued?'disabled':''}>${f.status==='ready'?'Сдать загруженное':'Проверить загрузку'}</button>`:''}<button class="btn ghost danger" data-action="delete-recording" data-file="${e(f.fileId)}" ${busy?'disabled':''}>${f.status==='deleting'?'Повторить удаление':'Удалить из облака'}</button></div></article>`;
  }).join('')||'<div class="recording-empty">Файлов пока нет. Открой роль и нажми «Сдать на проверку».</div>'}</div><p class="file-hint">Здесь можно удалить готовую запись или незавершённую загрузку и освободить место. Во время передачи сначала нажми «Отменить передачу».</p>`;
}
function showMessages(){
  const scroll=modal.querySelector('.notification-list')?.scrollTop||0;
  modal.dataset.view='messages';
  const messages=[...(state.mailbox?.messages||[])].sort((a,b)=>b.id-a.id),failed=state.mailbox?.failed||[];
  const messagesToolbar=messages.length?`<div class="notification-toolbar"><span class="muted">История сообщений</span><button class="btn ghost delete-all" data-action="delete-all-messages">Удалить все</button></div>`:'';
  modal.innerHTML=`<div class="modal-head"><div><h2 id="modal-title">Уведомления</h2><span class="muted">${unread()?unread()+' непрочитанных':'Все прочитаны'}</span></div><button class="icon-btn" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></div>${messagesToolbar}${failed.length?`<p class="form-error">Не отправлено: ${e(failed.at(-1).error)} Можно повторить сдачу из списка ролей.</p><button class="btn ghost" data-action="dismiss-failed">Убрать ошибки</button>`:''}<div class="notification-list">${messages.slice(0,notificationLimit).map(item=>`<article class="notification-item ${item.read?'':'unread'}" data-kind="${e(item.kind||'')}"><div class="notification-item-head"><strong>${e(messageKind(item.kind))}</strong><time>${e(stamp(item.createdAt))}</time></div><div class="notification-role">${e(item.role?.character||'Неизвестная роль')} · ${e(item.role?.projectTitle||'Проект')} · ${item.role?.episodeNumber?'Серия '+e(item.role.episodeNumber):'Серия'}</div>${item.text&&item.text!==messageKind(item.kind)?`<p>${e(item.text)}</p>`:''}<div class="notification-actions">${item.role?.roleId&&hasAssignedRole(roles(),item.role?.roleId)?`<button class="btn ghost" data-action="message-role" data-message="${item.id}" data-role="${e(item.role.roleId)}">Открыть роль</button>`:''}${(item.kind==='retake'||item.kind==='note'||item.kind==='status_retake')&&hasAssignedRole(roles().filter(role=>role.status!=='done'&&!role.queued),item.role?.roleId)?`<button class="btn ghost" data-action="submit-role" data-role="${e(item.role.roleId)}">Сдать исправленное</button>`:''}<button class="btn ghost delete-message" data-action="delete-message" data-message="${item.id}">Удалить</button>${!item.read?`<button class="btn ghost" data-action="read-message" data-message="${item.id}">Прочитано</button>`:''}</div></article>`).join('')||'<p class="muted">Назначения ролей, решения руководителя и изменения статусов появятся здесь.</p>'}</div>${messages.length>notificationLimit?'<button class="btn ghost" data-action="more-messages">Показать ещё</button>':''}`;
  if(!modal.open)modal.showModal();modal.querySelector('.notification-list').scrollTop=scroll;
}
function updateMessageBadge(){const node=document.querySelector('[data-message-count]');if(node){const failed=state.mailbox?.failed?.length||0;node.textContent=unread()||(failed?'!':'');node.hidden=!unread()&&!failed;}}
function renderDebts(all){
  const selected=sortActorRoles(selectDebts(all,{query:ui.query,filter:ui.filter}),ui.roleSort);
  const filters=[['all','Все'],['waiting','Жду запись'],['retake','На перезапись'],['late','Просрочено']];
  return `<div class="debt-filters">${filters.map(([id,name])=>`<button data-filter="${id}" class="${ui.filter===id?'active':''}">${name}</button>`).join('')}<span>${selected.length} рол.</span></div><div class="actor-role-sort-bar">${roleSortControl()}</div>${selected.length?`<div class="role-list debts-list">${selected.map(r=>roleRow(r)).join('')}</div>`:empty('Долгов нет',ui.query||ui.filter!=='all'?'По выбранному фильтру ничего нет.':'Все ожидающие запись и перезапись появятся здесь.')}`;
}
function settings(){
  modal.dataset.view='settings';
  modal.innerHTML=`<div class="modal-head"><div><h2 id="modal-title">Настройки</h2><span class="muted">Личные настройки этого компьютера</span></div><button class="icon-btn" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></div><p class="small muted">Статичные и анимированные темы. Выбор сохраняется на этом компьютере.</p><h3 class="theme-section-heading">Обычные темы</h3><div class="theme-grid">${THEMES.filter(([id])=>!id.startsWith('living-')).map(([id,name])=>`<button data-theme="${id}" class="actor-theme ${ui.theme===id?'selected':''}"><span class="theme-preview ${id}"></span><strong>${e(name)}</strong></button>`).join('')}</div><h3 class="theme-section-heading">Анимированные градиенты</h3><div class="theme-grid">${THEMES.filter(([id])=>id.startsWith('living-')).map(([id,name])=>`<button data-theme="${id}" class="actor-theme ${ui.theme===id?'selected':''}"><span class="theme-preview ${id}"></span><strong>${e(name)}</strong></button>`).join('')}</div><label class="motion-option"><input id="motion" type="checkbox" ${ui.motion?'checked':''}> Анимации</label>${state.authenticated?`<div class="account-settings"><span>${e(state.username)}</span><button class="btn ghost" data-action="logout">${icon('logout')}Выйти из аккаунта</button></div>`:''}<p class="small muted">Приложение остаётся в трее после закрытия окна. Для полного выхода нажми правой кнопкой значок Fundi Voice Actor → «Выход».</p><button class="btn ghost" data-action="exit-app">Завершить приложение</button>`;
  modal.showModal();
}
async function update(manual=false){
  const next=manual?await api('sync',{}):await api('status');
  const lostAccess=state.authenticated&&!next.authenticated;
  const changed=JSON.stringify(next)!==lastStatus;state=next;lastStatus=JSON.stringify(next);
  if(lostAccess){modal.close();ui.query='';ui.expanded.clear();ui.collapsed.clear();render();return;}
  updateMessageBadge();renderTransferNotice();
  if(changed&&modal.open&&modal.dataset.view==='recordings')renderActorFiles();
  if(changed&&modal.open&&modal.dataset.view==='messages')showMessages();
  if(changed&&(state.authenticated||!document.querySelector('#auth-form input:focus'))&&!modal.open)render();
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  try{
    if(button.dataset.page){ui.page=button.dataset.page;ui.query='';render();}
    if(button.dataset.auth){ui.activate=button.dataset.auth==='activate';render();}
    if(button.dataset.action==='recover'){ui.recover=true;render();return;}
    if(button.dataset.action==='back-login'){ui.recover=false;render();return;}
    if(button.dataset.filter){ui.filter=button.dataset.filter;render();}
    if(button.dataset.theme){ui.theme=button.dataset.theme;appearance();saveAppearance();modal.querySelectorAll('[data-theme]').forEach(b=>b.classList.toggle('selected',b.dataset.theme===ui.theme));}
    const action=button.dataset.action;
    if(action==='settings')settings();
    if(action==='vacation-end'){
      if(!window.confirm(state.vacation?.current?.status==='planned'?'Отменить запланированный отпуск?':'Закончить отпуск и вернуться к работе?'))return;
      button.disabled=true;state=await api('vacation/end',{});render();toast('Статус отпуска обновлён.');
    }
    if(action==='exit-app'){await api('exit',{});modal.close();app.innerHTML=empty('Actor закрыт','Для запуска открой Fundi Voice Actor с ярлыка.');document.querySelector('#file-transfer-slot').innerHTML='';return;}
    if(action==='close-modal'){modal.close();modal.dataset.view='';render();}
    if(action==='messages')showMessages();
    if(action==='more-messages'){notificationLimit+=50;showMessages();}
    if(action==='dismiss-failed'){state=await api('messages/dismiss-failed',{});showMessages();updateMessageBadge();}
    
    if(action==='role-visibility'){
      button.disabled=true;
      const hidden=button.dataset.hidden==='true';
      state=await api('roles/visibility',{roleId:button.dataset.role,hidden});
      render();toast(hidden?'Роль перемещена во вкладку «История».':'Роль возвращена в «Проекты».');
    }
    if(action==='submit-role')showSubmission(button.dataset.role);
    if(action==='recordings')await showActorFiles();
    if(action==='role-recordings')await showActorFiles(button.dataset.role);
    if(action==='refresh-recordings'){state=await api('files/refresh',{});refreshFilesView();}
    if(action==='upload-recording'){
      button.disabled=true;
      const selected=await openFileBrowser(api,{mode:'file',title:'Выбери запись для отправки'});
      if(!selected){button.disabled=false;return;}
      const payload={roleId:button.dataset.role};
      if(selected.path)payload.path=selected.path;
      const result=await api('files/upload',payload);
      if(!result.cancelled){state=result;modal.close();render();renderTransferNotice();}
      else{button.disabled=false;}
    }
    if(action==='confirm-recording'){
      button.disabled=true;state=await api('files/confirm',{fileId:button.dataset.file});refreshFilesView();toast('Запись подтверждена. Отправляем уведомление руководителю…');
    }
    if(action==='delete-recording'){
      const file=(state.files||[]).find(f=>f.fileId===button.dataset.file);
      if(file&&window.confirm('Удалить «'+file.fileName+'» из облака? Восстановить файл будет нельзя.')){
        button.disabled=true;state=await api('files/delete',{fileId:file.fileId});refreshFilesView();renderTransferNotice();toast('Файл удалён. Место в облаке освобождено.');
      }
    }
    if(action==='actor-transfer-cancel'){state=await api('transfer/cancel',{});renderTransferNotice();}
    if(action==='actor-transfer-hide'){hiddenTransferId=state.transfer?.id||'';renderTransferNotice();}
    if(action==='confirm-submit'){
      button.disabled=true;state=await api('submit',{roleId:button.dataset.role});modal.close();render();toast('Сдача сохранена. Отправляем уведомление руководителю…');
    }
    if(action==='read-message'){state=await api('messages/read',{id:Number(button.dataset.message)});showMessages();updateMessageBadge();}
    if(action==='delete-message'){button.disabled=true;state=await api('messages/delete',{ids:[Number(button.dataset.message)]});showMessages();updateMessageBadge();toast('Уведомление удалено.');}
    if(action==='delete-all-messages'&&window.confirm('Удалить все уведомления? Это действие не удаляет роли и записи.')){button.disabled=true;state=await api('messages/delete',{all:true});notificationLimit=50;showMessages();updateMessageBadge();toast('История уведомлений очищена.');}
    if(action==='message-role'){
      state=await api('messages/read',{id:Number(button.dataset.message)});
      const role=roles().find(item=>item.roleId===button.dataset.role);modal.close();
      if(role){ui.page=(state.view?.hiddenRoleIds||[]).includes(role.roleId)?'history':'projects';ui.query=role.character;ui.expanded.add(role.projectId);ui.collapsed.delete(role.projectId);render();}
      else{render();toast('Эта роль больше не назначена тебе.');}
    }
    if(action==='sync'){button.disabled=true;await update(true);toast(state.error||'Роли обновлены',!!state.error);}
    if(action==='logout'){
      hiddenTransferId='';state=await api('logout',{});ui.query='';ui.page='projects';ui.expanded.clear();ui.collapsed.clear();modal.close();render();renderTransferNotice();toast('Выход выполнен. Сохранённые роли удалены с этого компьютера.');
    }
  }catch(error){toast(error.message,true);}
  finally{if(button.isConnected)button.disabled=false;}
});
function saveAppearance(){try{localStorage.setItem('fundi-actor-appearance',JSON.stringify({theme:ui.theme,motion:ui.motion,roleSort:ui.roleSort}));}catch{}}
document.addEventListener('input',event=>{if(event.target.id==='search'){ui.query=event.target.value;render();}});
document.addEventListener('toggle',event=>{
  const element=event.target;if(!element.matches?.('details.actor-project'))return;
  const id=element.dataset.project;if(element.open){ui.expanded.add(id);ui.collapsed.delete(id);}else{ui.collapsed.add(id);ui.expanded.delete(id);}
},true);
document.addEventListener('change',event=>{if(event.target.id==='motion'){ui.motion=event.target.checked;appearance();saveAppearance();}if(event.target.id==='actor-role-sort'){ui.roleSort=ACTOR_ROLE_SORTS.some(([id])=>id===event.target.value)?event.target.value:'default';saveAppearance();render();}});
document.addEventListener('submit',async event=>{
  if(event.target.id==='recovery-form'){
    event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');
    const data=Object.fromEntries(new FormData(form));
    button.disabled=true;
    try {
      const receipt=await api('recovery/request',data);
      ui.recover=false;render();toast(receipt.message||'Запрос отправлен руководителю студии.');
    } catch(error){const target=document.querySelector('#recovery-error');if(target)target.textContent=error.message;}
    finally{if(button.isConnected)button.disabled=false;}
    return;
  }
  if(event.target.id==='vacation-create-form'||event.target.id==='vacation-update-form'){
    event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');
    const values=new FormData(form),reason=String(values.get('reason')||''),endDate=String(values.get('endDate')||'')||null;
    button.disabled=true;
    try{
      if(form.id==='vacation-create-form'){
        const startDate=String(values.get('startDate')||'');
        const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
        state=await api('vacation/start',{startDate,endDate,reason,timeZone});
      }else state=await api('vacation/update',{endDate,reason});
      render();toast('Отпуск сохранён и синхронизирован с сервером.');
    }catch(problem){toast(problem.message,true);}
    finally{if(button.isConnected)button.disabled=false;}
    return;
  }
  if(event.target.id!=='auth-form')return;event.preventDefault();
  if(formBusy)return;const form=event.target,data=Object.fromEntries(new FormData(form)),button=form.querySelector('[type=submit]');
  if(ui.activate&&data.password!==data.confirm){document.querySelector('#auth-error').textContent='Пароли не совпадают.';return;}
  formBusy=true;button.disabled=true;button.textContent='Подключаемся…';document.querySelector('#auth-error').textContent='';
  try{delete data.confirm;state=await api(ui.activate?'activate':'login',data);data.password='';if(!state.authenticated)throw new Error(state.error||'Вход не выполнен.');ui.activate=false;render();}
  catch(error){const target=document.querySelector('#auth-error');if(target)target.textContent=error.message;}
  finally{formBusy=false;if(button.isConnected){button.disabled=false;button.textContent=ui.activate?'Создать аккаунт':'Войти';}}
});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.code==='KeyK'){event.preventDefault();document.querySelector('#search')?.focus();}});
modal.addEventListener('click',event=>{if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)modal.close();}});
modal.addEventListener('close',()=>{modal.dataset.view='';render();});
async function boot(){
  appearance();
  const params=new URLSearchParams(location.hash.slice(1));token=params.get('key')||sessionStorage.getItem('fundi-actor-key')||'';
  if(location.hostname!=='127.0.0.1'||!token){app.innerHTML=empty('Открой приложение','Запусти Fundi Voice Actor с ярлыка или через FundiVoiceActor.exe.');return;}
  sessionStorage.setItem('fundi-actor-key',token);history.replaceState(null,'',location.pathname);
  try{await update();startUpdateNotice({api,label:'Actor',beforeRestart:async()=>{
    if(state.transfer?.state==='running'){toast('Дождись окончания загрузки записи перед обновлением.',true);return false;}
    return true;
  }});setInterval(()=>update().catch(()=>{}),1500);}catch(error){app.innerHTML=empty('Не удалось открыть Actor',error.message);}
}
boot();
