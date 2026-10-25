// Role/project age is based on the persisted creation timestamp, never on the due date.
// Unknown legacy timestamps must not be replaced with today's date or guessed.
export function ageInfo(value, now=new Date()){
  if(typeof value!=='string'||!value.trim())return null;
  const start=new Date(value);
  if(!Number.isFinite(start.getTime()))return null;
  const dateOnly=d=>Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
  const today=dateOnly(now),initial=dateOnly(start);
  if(!Number.isFinite(today))return null;
  const days=Math.max(0,Math.floor((today-initial)/86400000));
  const s=new Date(initial),n=new Date(today);
  let months=(n.getUTCFullYear()-s.getUTCFullYear())*12+n.getUTCMonth()-s.getUTCMonth();
  const anniversary=count=>{
    const year=s.getUTCFullYear(),month=s.getUTCMonth()+count;
    const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    return Date.UTC(year,month,Math.min(s.getUTCDate(),last));
  };
  months=Math.max(0,months);
  if(anniversary(months)>today)months--;
  const rest=Math.floor((today-anniversary(months))/86400000);
  const years=Math.floor(months/12),remMonths=months%12;
  const label=[years?years+' г.':'',remMonths?remMonths+' мес.':'',rest||!months?rest+' дн.':''].filter(Boolean).join(' ');
  return {days,label,level:days<=14?'green':days<=30?'yellow':'red',
    date:start.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'})};
}
export function ageBadge(value){
  const info=ageInfo(value);
  const text=info?info.label:'дата неизвестна';
  const title=info?'Создана: '+info.date+' · Возраст записи, не дедлайн':'Дата создания не сохранена для старой записи';
  return '<span class="fv-age fv-age-'+(info?info.level:'unknown')+'" title="'+title+'">◷ '+text+'</span>';
}
