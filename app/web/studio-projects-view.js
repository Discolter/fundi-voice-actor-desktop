// Shared, dependency-free read-only Studio layout for Actor Web and Actor Desktop.
// Rendering never accepts owner routes, task lists, local file paths or write actions.
const stageNames={unset:'Этап не указан',prep:'Подготовка',record:'Запись',edit:'Монтаж',mix:'Сведение',review:'Проверка',done:'Готово'};
const roleNames={waiting:'Жду запись',recording:'В записи',received:'Получено',processing:'Обрабатываю',processed:'Обрабатываю',retake:'На перезапись',pickup:'Дописать',done:'Принято'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeImg=s=>typeof s==='string'&&s.length<250000&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(s)?s:'';
const nameKey=s=>String(s||'').toLocaleLowerCase('ru-RU');
const epNum=e=>Number.isFinite(Number(e?.number))?Number(e.number):0;
const newest=p=>(p.episodes||[]).reduce((a,b)=>!a||epNum(b)>=epNum(a)?b:a,null);
const dateValue=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')?new Date(s+'T12:00:00'):null;
function age(iso){
  const time=Date.parse(iso||'');if(!Number.isFinite(time))return '';
  const days=Math.max(0,Math.floor((Date.now()-time)/86400000));
  return '<span class="fv-mirror-age '+(days<3?'good':days<10?'medium':'old')+'">◷ '+days+' дн.</span>';
}
const stageBadge=ep=>'<span class="fv-mirror-epstage">● '+esc(stageNames[ep?.stage]||stageNames.unset)+'</span>';
const labelEpisode=ep=>(ep?.number?'Серия '+String(ep.number).padStart(2,'0'):(ep?.title||'Серия'));
const poster=(image,title,large=false)=>safeImg(image)
 ?'<img class="fv-mirror-poster'+(large?' large':'')+'" src="'+esc(image)+'" alt="'+esc(title)+'" loading="lazy">'
 :'<span class="fv-mirror-poster fv-mirror-poster-fallback'+(large?' large':'')+'">✦</span>';
function options(entries,chosen){return entries.map(([key,label])=>'<option value="'+esc(key)+'"'+(key===chosen?' selected':'')+'>'+esc(label)+'</option>').join('');}
const rolesOf=ep=>Array.isArray(ep?.roles)?ep.roles:[];
function progress(ep){
  const roles=rolesOf(ep),accepted=roles.filter(r=>r.status==='done').length,total=roles.length;
  return {accepted,total,remaining:total-accepted,tone:!total?'none':accepted/total>=1||total-accepted<=3?'good':accepted/total>=0.5?'medium':'bad'};
}
function card(p){
 const ep=newest(p),prog=progress(ep),deadline=ep?.due;
 return '<button type="button" class="fv-mirror-card" data-mirror-project="'+esc(p.id)+'" aria-label="Открыть проект '+esc(p.title)+'">'+
    '<div class="fv-mirror-card-top">'+poster(p.cover,p.title)+
    '<div class="fv-mirror-card-info"><strong>'+esc(p.title)+'</strong><small>'+(p.season?'Сезон '+esc(p.season)+' · ':'')+esc(labelEpisode(ep))+(p.episodes?.length>1?' · '+p.episodes.length+' сер.':'')+'</small></div>'+
    (p.favorite?'<span class="fv-mirror-favorite" title="В избранном Studio">★</span>':'<span class="fv-mirror-star" aria-hidden="true">☆</span>')+'</div>'+
    '<div class="fv-mirror-card-middle">'+stageBadge(ep)+age(p.createdAt)+
    '<span class="fv-mirror-progress '+prog.tone+'"><strong>'+prog.accepted+'/'+prog.total+'</strong> принято · осталось '+prog.remaining+'</span>'+
    (deadline?'<span class="fv-mirror-due">◷ '+esc(deadline)+'</span>':'')+'</div>'+
    '<div class="fv-mirror-card-bottom"><strong>Открыть <span aria-hidden="true">→</span></strong><span>Просмотр серии</span></div>'+
    '</button>';
}
function list(catalog,ui){
  let projects=(catalog.projects||[]).filter(p=>p&&!p.hidden&&typeof p.id==='string');
  const mode=ui.filter||'active',query=nameKey(ui.query||'').trim();
  projects=projects.filter(p=>mode==='archive'?p.archived:mode==='favorite'?!p.archived&&p.favorite:!p.archived);
  if(query)projects=projects.filter(p=>nameKey([p.title,p.season,...(p.episodes||[]).flatMap(ep=>[ep.title,ep.number,...rolesOf(ep).flatMap(r=>[r.character,r.actor])])].join(' ')).includes(query));
  const sort=ui.sort||'name';
  projects.sort((a,b)=>sort==='due'?String(newest(a)?.due||'9999').localeCompare(String(newest(b)?.due||'9999'))||nameKey(a.title).localeCompare(nameKey(b.title)):
    sort==='recent'?String(b.createdAt||'').localeCompare(String(a.createdAt||''))||nameKey(a.title).localeCompare(nameKey(b.title)):
    nameKey(a.title).localeCompare(nameKey(b.title)));
  const activeCount=(catalog.projects||[]).filter(p=>!p.archived).length;
  const tabs=[['active','Активные '+activeCount],['favorite','Избранное'],['archive','Архив']];
  return '<div class="fv-mirror-root"><div class="fv-mirror-top"><div><p class="fv-mirror-eyebrow">СТУДИЯ · РЕЖИМ НАБЛЮДЕНИЯ</p><h2>Проекты</h2></div><span class="fv-mirror-readonly">◉ Только просмотр</span></div>'+
  '<div class="fv-mirror-toolbar"><div class="fv-mirror-tabs">'+tabs.map(([key,title])=>'<button type="button" data-mirror-filter="'+key+'" class="'+(key===mode?'active':'')+'">'+title+'</button>').join('')+'</div>'+
  '<div class="fv-mirror-tools"><select aria-label="Сортировка проектов" data-mirror-sort>'+options([['name','По названию'],['recent','Недавние'],['due','По сроку']],sort)+'</select>'+
  '<div class="fv-mirror-view"><button type="button" aria-label="Карточки" data-mirror-layout="grid" class="'+(ui.layout!=='table'?'active':'')+'">▦</button><button type="button" aria-label="Список" data-mirror-layout="table" class="'+(ui.layout==='table'?'active':'')+'">☷</button></div></div></div>'+
  (projects.length?'<div class="fv-mirror-grid '+(ui.layout==='table'?'as-list':'')+'">'+projects.map(card).join('')+'</div>':
    '<div class="fv-mirror-empty">'+(query?'По запросу ничего не найдено.':'Проекты пока не опубликованы в облаке Studio.')+'</div>')+'</div>';
}
const fvTiers=[['main','Главные роли'],['supporting','Второстепенные роли'],['extras','Массовка']];
const fvTier=value=>fvTiers.some(([id])=>id===value)?value:'supporting';
const fvTierLabel=value=>fvTiers.find(([id])=>id===fvTier(value))[1];
function fvTieredMirrorRows(rows){
  return fvTiers.map(([id,title])=>{
    const group=rows.filter(role=>fvTier(role.roleTier)===id);
    return group.length?'<div class="fv-mirror-tier-section fv-mirror-tier-'+id+'"><strong>'+title+'</strong><small>'+group.length+' рол.</small></div>'+group.map(roleRow).join(''):'';
  }).join('');
}
function roleRow(role){
 const rawStage=Object.prototype.hasOwnProperty.call(roleNames,role.status)?role.status:'unknown';
 const status=roleNames[role.status]||'Этап не указан';
 const ageMarkup=age(role.createdAt);
 return '<div class="fv-mirror-role '+(rawStage==='done'?'accepted':rawStage==='retake'?'retake':rawStage==='pickup'?'pickup':'')+'">'+
   '<div class="fv-mirror-character">'+poster(role.image,role.character)+
    '<div><strong>'+esc(role.character||'Без имени')+'</strong><div><span class="fv-mirror-tier-badge fv-mirror-tier-'+fvTier(role.roleTier)+'">'+esc(fvTierLabel(role.roleTier))+'</span></div><div class="fv-mirror-role-meta">'+
    (Number.isInteger(role.lineCount)?'<span class="fv-mirror-lines">'+role.lineCount+' репл.</span>':'')+
    (role.voiceGender?'<span>'+esc(role.voiceGender==='male'?'Мужской':role.voiceGender==='female'?'Женский':role.voiceGender)+'</span>':'')+'</div></div></div>'+
   '<div class="fv-mirror-actor">'+(safeImg(role.avatar)?'<img src="'+esc(role.avatar)+'" alt="" loading="lazy">':'<span class="fv-mirror-avatar">◉</span>')+'<span>'+esc(role.actor||'Не назначен')+'</span></div>'+
   '<div><span class="fv-mirror-status '+rawStage+'">'+esc(status)+'</span></div>'+
   '<div class="fv-mirror-role-age">'+(ageMarkup||'<span class="fv-mirror-muted">Дата неизвестна</span>')+'</div>'+
  '</div>';
}
function detail(catalog,ui){
 const project=(catalog.projects||[]).find(p=>!p.hidden&&p.id===ui.projectId);
 if(!project)return list(catalog,{...ui,projectId:''});
 const episodes=project.episodes||[];
 const ep=episodes.find(e=>e.id===ui.episodeId)||newest(project)||{id:'',roles:[]};
 const roles=rolesOf(ep);
 let filtered=roles;
 const query=nameKey(ui.query||'').trim();
 if(query)filtered=filtered.filter(r=>nameKey([r.character,r.actor,r.status].join(' ')).includes(query));
 if(ui.roleStatus&&ui.roleStatus!=='all')filtered=filtered.filter(r=>r.status===ui.roleStatus);
 if(ui.roleActor&&ui.roleActor!=='all')filtered=filtered.filter(r=>ui.roleActor==='unassigned'?!r.actor:r.actor===ui.roleActor);
 const order=ui.roleOrder||'original';
 if(order==='linesAsc'||order==='linesDesc')filtered=[...filtered].sort((a,b)=>(a.lineCount===null||a.lineCount===undefined?1:0)-(b.lineCount===null||b.lineCount===undefined?1:0)||((order==='linesAsc'?1:-1)*((a.lineCount||0)-(b.lineCount||0))));
 const actors=[...new Set(roles.map(r=>r.actor).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
 if(roles.some(r=>!r.actor))actors.push('unassigned');
 const prog=progress(ep);
 return '<div class="fv-mirror-root"><button type="button" data-mirror-back class="fv-mirror-back">← Проекты</button>'+
   '<div class="fv-mirror-detail-head">'+poster(project.cover,project.title,true)+
     '<div class="fv-mirror-detail-title"><h2>'+esc(project.title)+'</h2>'+age(project.createdAt)+'<p>'+(project.season?'Сезон '+esc(project.season):'')+'</p></div>'+
     '<span class="fv-mirror-readonly">◉ Только просмотр</span></div>'+
   '<div class="fv-mirror-episodebar"><label>▤ <select data-mirror-episode aria-label="Серия проекта">'+
    options(episodes.map(item=>[item.id,(project.season?'Сезон '+project.season+' · ':'')+labelEpisode(item)+(item.title?' · '+item.title:'')]),ep.id)+'</select></label>'+
    stageBadge(ep)+(ep.due?'<span class="fv-mirror-due">◷ Срок: '+esc(ep.due)+'</span>':'')+'</div>'+
   '<div class="fv-mirror-detail-tabs"><strong>Роли <span>'+roles.length+'</span></strong><small>Актёры видят только производственный статус</small></div>'+
   '<div class="fv-mirror-detail-summary"><span>'+roles.length+' ролей</span><strong class="'+prog.tone+'">'+prog.accepted+'/'+prog.total+' принято · осталось '+prog.remaining+'</strong></div>'+
   '<div class="fv-mirror-filters">'+
    '<label>Статус<select data-mirror-role-status>'+options([['all','Все статусы'],...Object.entries(roleNames).filter(([k])=>k!=='processed')],ui.roleStatus||'all')+'</select></label>'+
    '<label>Актёр<select data-mirror-role-actor>'+options([['all','Все актёры'],...actors.map(a=>[a,a==='unassigned'?'Не назначены':a])],ui.roleActor||'all')+'</select></label>'+
    '<label>Порядок<select data-mirror-role-order>'+options([['original','По порядку'],['linesAsc','Меньше реплик'],['linesDesc','Больше реплик']],order)+'</select></label>'+
    '<span class="fv-mirror-visible">Показано '+filtered.length+' из '+roles.length+'</span></div>'+
   '<div class="fv-mirror-role-table"><div class="fv-mirror-role-head"><span>Персонаж</span><span>Актёр</span><span>Обработка</span><span>Возраст</span></div>'+
   (filtered.length?fvTieredMirrorRows(filtered):'<div class="fv-mirror-empty">Нет ролей по выбранным фильтрам.</div>')+'</div></div>';
}
export function renderStudioMirror(catalog,ui={}){
 if(!catalog||!Array.isArray(catalog.projects))return '<div class="fv-mirror-empty">Проекты студии пока не загружены.</div>';
 return ui.projectId?detail(catalog,ui):list(catalog,ui);
}
