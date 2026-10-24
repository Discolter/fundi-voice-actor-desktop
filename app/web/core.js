export const STAGES=[['waiting','Жду запись'],['recording','В записи'],['received','Получено'],['processing','Обрабатывается'],['processed','Обработано'],['retake','На перезапись'],['done','Принято']];
export const THEMES=[['slate','Серый'],['graphite','Графит'],['silver','Серебро'],['forest','Лесной'],['plum','Сливовый'],['ocean','Океан'],['aurora','Fundi Original'],['midnight','Полночь'],['gold','Золотой час'],['light','Светлая'],['sunset','Закат'],['mintwave','Мятный градиент'],['twilight','Сумерки'],['rose','Розовый градиент'],['living-sunset','Живой сине-оранжевый'],['living-aurora','Живое сияние'],['living-ocean','Живой океан'],['living-plum','Живая плазма']];
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const isDebt=role=>role.status==='waiting'||role.status==='retake';
// Traffic-light workload for actor roles; null/unknown never becomes zero.
export function actorWorkloadClass(lines){
  if(!Number.isInteger(lines)||lines<0)return 'line-workload-unknown';
  return lines<=50?'line-workload-low':lines<=100?'line-workload-medium':'line-workload-high';
}
export const dueLabel=due=>due?new Date(due+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}):'Без срока';
export const stageLabel=status=>STAGES.find(x=>x[0]===status)?.[1]||'Статус не указан';
export function reviewedRole(role,reviews=[],pending=[]){
  const review=reviews.find(item=>item.roleId===role.roleId)||null;
  const queued=pending.some(item=>item.operation==='submit'&&item.body?.roleId===role.roleId);
  const status=queued?'received':review?.state==='pending'?'received':review?.state==='retake'?'retake':review?.state==='accepted'?'done':role.status;
  return {...role,status,review,queued,reviewLabel:queued?'Ожидает отправки':review?.state==='pending'?'На проверке':stageLabel(status)};
}
export const matches=(role,query)=>query.trim().toLocaleLowerCase('ru').split(/\s+/).every(part=>[role.projectTitle,role.character,role.episodeNumber,role.episodeTitle].join(' ').toLocaleLowerCase('ru').includes(part));
export function selectDebts(roles,{query='',filter='all'}={}){
  return roles.filter(isDebt).filter(r=>matches(r,query)&&(filter==='all'||(filter==='late'?r.due&&r.due<today():r.status===filter)))
    .sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||(a.status==='retake'?0:1)-(b.status==='retake'?0:1)||a.projectTitle.localeCompare(b.projectTitle,'ru')||a.character.localeCompare(b.character,'ru'));
}
export function groupProjects(roles,query=''){
  const projects=new Map();
  for(const role of roles.filter(r=>matches(r,query))){
    if(!projects.has(role.projectId))projects.set(role.projectId,{id:role.projectId,title:role.projectTitle,season:role.season,roles:[],episodes:new Map()});
    const project=projects.get(role.projectId);project.roles.push(role);
    if(!project.episodes.has(role.episodeId))project.episodes.set(role.episodeId,{id:role.episodeId,number:role.episodeNumber,title:role.episodeTitle,roles:[]});
    project.episodes.get(role.episodeId).roles.push(role);
  }
  return [...projects.values()].sort((a,b)=>a.title.localeCompare(b.title,'ru'));
}

// Shared actor-facing labels for the Cloud inbox. Does not mutate account state.
export const KIND_LABELS = Object.freeze({
  role_assigned:'Новая роль',
  role_removed:'Роль снята',
  role_changed:'Изменения в роли',
  deadline_changed:'Изменён срок сдачи',
  status_waiting:'Ожидается запись',
  status_recording:'Идёт запись',
  status_received:'Запись получена',
  status_processing:'Работа в обработке',
  status_processed:'Обработка завершена',
  status_retake:'На перезапись',
  status_done:'Работа принята',
  file_downloaded:'Руководитель скачал запись',
  retake:'На перезапись',
  accepted:'Запись принята',
  note:'Замечание от руководителя'
});
export const messageKind=kind=>KIND_LABELS[kind]||'Уведомление от студии';
// Prevent navigation for a removed/moved role, even if the notification retains a snapshot.
export const hasAssignedRole=(roles,roleId)=>Boolean(roleId&&Array.isArray(roles)&&roles.some(role=>role.roleId===roleId));
export const ACTOR_ROLE_SORTS=[
  ['default','По умолчанию'],
  ['linesAsc','Сначала меньше реплик'],
  ['linesDesc','Сначала больше реплик']
];
// Keep unreported line counts at the end for both directions; never coerce null to 0.
export function sortActorRoles(roles,mode='default'){
  const copy=[...(roles||[])];
  if(mode!=='linesAsc'&&mode!=='linesDesc')return copy;
  return copy.sort((a,b)=>{
    const av=Number.isInteger(a.lineCount)&&a.lineCount>=0?a.lineCount:null;
    const bv=Number.isInteger(b.lineCount)&&b.lineCount>=0?b.lineCount:null;
    if(av===null&&bv===null)return 0;
    if(av===null)return 1;
    if(bv===null)return -1;
    return mode==='linesAsc'?av-bv:bv-av;
  });
}


// Sum all assigned character roles across every episode of a project.
// Unreported counts stay unknown; never interpret them as zero.
export function actorProjectWorkload(project) {
  const roles=project?.roles||[];
  const known=roles.filter(r=>Number.isInteger(r.lineCount)&&r.lineCount>=0);
  return {total:known.reduce((sum,r)=>sum+r.lineCount,0),
    known:known.length, missing:roles.length-known.length};
}
export function sortActorProjects(projects,mode='default') {
  const list=[...(projects||[])];
  if(mode!=='linesAsc'&&mode!=='linesDesc')return list;
  return list.sort((a,b)=>{
    const av=actorProjectWorkload(a),bv=actorProjectWorkload(b);
    if(!av.known&&!bv.known)return a.title.localeCompare(b.title,'ru');
    if(!av.known)return 1;if(!bv.known)return -1;
    return (mode==='linesAsc'?av.total-bv.total:bv.total-av.total)
      ||a.title.localeCompare(b.title,'ru');
  });
}
