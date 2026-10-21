import {escapeHTML as e} from './core.js';
export function formatBytes(value){
  const n=Math.max(0,Number(value)||0),units=['Б','КиБ','МиБ','ГиБ'];
  let amount=n,index=0;while(amount>=1024&&index<3){amount/=1024;index++;}
  return amount.toLocaleString('ru-RU',{maximumFractionDigits:index?1:0})+' '+units[index];
}
export function storageMeter(used,quota){
  return `<div class="file-storage"><div><span>Место в облаке · с учётом резервов</span><strong>${e(formatBytes(used))} / ${e(formatBytes(quota))}</strong></div><progress aria-label="Занято в облаке" max="${Math.max(1,Number(quota)||1)}" value="${Math.max(0,Number(used)||0)}"></progress></div>`;
}
export function transferPanel(t,prefix='',hiddenId=''){
  if(!t||t.id===hiddenId)return '';
  const busy=t.state==='running',percent=t.totalBytes?Math.min(100,Math.floor(t.bytes*100/t.totalBytes)):0;
  return `<section class="file-transfer" data-state="${e(t.state)}" aria-label="Передача записи"><div class="file-transfer-head"><strong>${t.direction==='upload'?'Загрузка записи':'Скачивание записи'}</strong>${!busy?`<button type="button" class="text-button" data-action="${prefix}transfer-hide" aria-label="Скрыть результат передачи">✕</button>`:''}</div><div class="file-transfer-name">${e(t.fileName)}</div><progress aria-label="Передано" value="${Number(t.bytes)||0}" max="${Math.max(1,Number(t.totalBytes)||1)}"></progress><div class="file-transfer-meta"><span aria-live="polite">${e(t.phase)}</span><span>${percent}% · ${e(formatBytes(t.bytes))} / ${e(formatBytes(t.totalBytes))}</span></div>${t.error?`<p class="file-error">${e(t.error)}</p>`:''}${t.state==='done'&&t.direction==='upload'?'<p class="file-hint">Запись загружена. Уведомление руководителю отправляется автоматически.</p>':''}${t.state==='done'&&t.path?`<p class="file-saved-path">${e(t.path)}</p><button type="button" class="btn ghost small" data-action="${prefix}transfer-folder" data-path="${e(t.folder)}">Открыть папку</button>`:''}${busy&&t.canCancel?`<button type="button" class="btn ghost small" data-action="${prefix}transfer-cancel">Отменить передачу</button>`:''}</section>`;
}
export function fileStatus(status){return status==='ready'?'Готово':status==='pending'?'Не подтверждено':status==='deleting'?'Удаляется':'Неизвестное состояние';}
