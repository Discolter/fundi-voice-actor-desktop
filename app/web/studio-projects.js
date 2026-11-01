// A presentation-only renderer. No role IDs, controls or mutation requests are accepted.
export function renderReadonlyStudioProjects(snapshot,{query='',stageLabel,escapeHTML,expanded,loading=false,error=''}) {
  const esc=value=>escapeHTML(String(value??''));
  const rows=Array.isArray(snapshot?.roles)?snapshot.roles:[];
  const needle=String(query).trim().toLocaleLowerCase('ru');
  const filtered=rows.filter(r=>!needle||[r.projectTitle,r.episodeTitle,r.episodeNumber,r.season,r.character,r.actorName,r.status].some(v=>String(v??'').toLocaleLowerCase('ru').includes(needle)));
  const groups=new Map();
  for(const r of filtered) {
    const id=String(r.projectId||r.projectTitle||'untitled');
    if(!groups.has(id))groups.set(id,{id,title:String(r.projectTitle||'Без названия'),season:String(r.season||''),episodes:new Map(),done:0,count:0});
    const p=groups.get(id),episodeId=String(r.episodeId||r.episodeNumber||'episode');
    if(!p.episodes.has(episodeId))p.episodes.set(episodeId,{number:String(r.episodeNumber||''),title:String(r.episodeTitle||''),roles:[]});
    p.episodes.get(episodeId).roles.push(r);
    p.count++;
    if(r.status==='done')p.done++;
  }
  const intro='<div class="studio-projects-notice"><strong>Только просмотр</strong><span>Состав и этапы озвучки синхронизируются со Studio. Изменять их здесь нельзя.</span></div>';
  if(loading&&!snapshot)return intro+'<p class="studio-projects-empty">Загружаем этапы озвучки…</p>';
  if(error&&!snapshot)return intro+'<div class="studio-projects-error">'+esc(error)+'<p>Проверь соединение или обновление Fundi Voice Cloud.</p><button type="button" class="btn ghost" data-action="reload-studio-projects">Повторить</button></div>';
  const cards=[...groups.values()].sort((a,b)=>a.title.localeCompare(b.title,'ru')).map(p=>{
    const percent=p.count?Math.round(p.done/p.count*100):0;
    const episodes=[...p.episodes.values()].sort((a,b)=>Number(a.number)-Number(b.number)).map(ep=>{
      const roles=ep.roles.sort((a,b)=>String(a.character).localeCompare(String(b.character),'ru')||String(a.actorName).localeCompare(String(b.actorName),'ru'));
      const rowHTML=roles.map(r=>{
        const status=String(r.status||'waiting'),safeStatus=/^[a-z-]{1,30}$/.test(status)?status:'waiting';
        return '<div class="studio-roster-row"><div class="studio-roster-character"><strong>'+esc(r.character||'Персонаж')+'</strong>'+
          (Number.isInteger(r.lineCount)&&r.lineCount>=0?'<small>'+r.lineCount+' репл.</small>':'')+
          '</div><span class="studio-roster-actor">'+esc(r.actorName||'Актёр')+'</span>'+
          '<span class="role-stage stage-'+esc(safeStatus)+'">'+esc(stageLabel(status)||status)+'</span></div>';
      }).join('');
      return '<section class="actor-episode"><h3>'+(ep.number?'Серия '+esc(ep.number):esc(ep.title||'Серия'))+
        (ep.title&&ep.number?' · '+esc(ep.title):'')+'</h3><div class="role-list">'+rowHTML+'</div></section>';
    }).join('');
    const key='studio:'+p.id;
    return '<details class="actor-project studio-project-card" data-project="'+esc(key)+'" '+(expanded?.has(key)?'open':'')+'><summary>'+
      '<span class="project-monogram">'+esc(p.title.slice(0,1))+'</span>'+
      '<span class="project-heading"><strong>'+esc(p.title)+'</strong><small>'+
      (p.season?'Сезон '+esc(p.season)+' · ':'')+p.episodes.size+' сер. · '+p.count+' назначений</small></span>'+
      '<span class="studio-project-progress">'+percent+'% <small>'+p.done+' / '+p.count+' принято</small></span>'+
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></summary>'+
      '<div class="studio-progress-track"><span style="width:'+percent+'%"></span></div>'+
      '<div class="project-episodes">'+episodes+'</div></details>';
  }).join('');
  const total=filtered.length;
  return intro+(error?'<p class="studio-projects-error">'+esc(error)+'</p>':'')+
    '<div class="studio-projects-total">Проектов: '+groups.size+' · Назначений: '+total+
    (Number.isInteger(snapshot?.revision)?' · Ревизия '+snapshot.revision:'')+'</div>'+
    (cards?'<div class="project-stack">'+cards+'</div>':'<p class="studio-projects-empty">'+
      (needle?'По этому запросу ничего не найдено.':'Studio пока не опубликовала назначения.')+'</p>');
}
