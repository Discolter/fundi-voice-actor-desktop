export const STAGES=[['waiting','Жду запись'],['recording','В записи'],['received','Получено'],['processing','Обрабатывается'],['processed','Обработано'],['retake','На перезапись'],['done','Принято']];
export const THEMES=[['slate','Серый'],['graphite','Графит'],['silver','Серебро'],['forest','Лесной'],['plum','Сливовый'],['ocean','Океан'],['aurora','Fundi Original'],['midnight','Полночь'],['gold','Золотой час'],['light','Светлая'],['sunset','Закат'],['mintwave','Мятный градиент'],['twilight','Сумерки'],['rose','Розовый градиент'],['living-sunset','Живой сине-оранжевый'],['living-aurora','Живое сияние'],['living-ocean','Живой океан'],['living-plum','Живая плазма']];
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const isDebt=role=>role.status==='waiting'||role.status==='retake';
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
