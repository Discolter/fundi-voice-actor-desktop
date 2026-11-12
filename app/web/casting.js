// Shared by Studio Desktop/Web and Actor Desktop/Web. Credentials stay in each host adapter.
const REVIEW = {submitted:'На рассмотрении',shortlist:'В избранном',accepted:'Выбран',rejected:'Не подошло',retake:'Нужна новая проба'};
const MAX_BYTES = 9 * 1024 ** 3;
const EXTENSIONS = new Set(('mp4 mkv mov webm avi m4v mpg mpeg wmv flv ts mts m2ts m2t 3gp 3g2 ogv vob asf mxf m2v mpv mpe f4v rm rmvb divx qt y4m hevc h264 h265 264 265 m1v nut dv mjpeg mjpg wav flac mp3 ogg m4a aac aif aiff opus wma zip').split(' '));
const el = (tag, cls='', text) => {const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const add = (p,tag,cls='',text) => {const n=el(tag,cls,text);p.append(n);return n;};
const bytes = n => n>=1024**3?(n/1024**3).toFixed(2)+' ГБ':n>=1024**2?(n/1024**2).toFixed(1)+' МБ':Math.ceil(n/1024)+' КБ';
export function telegramCastingUrl(value) {
  try {const u=new URL(value);return u.protocol==='https:'&&['t.me','telegram.me'].includes(u.hostname)&&!u.username&&!u.password&&(!u.port||u.port==='443')&&!u.search&&!u.hash&&/^\/[A-Za-z0-9_+/-]+$/.test(u.pathname)&&!u.pathname.includes('//')?u.href:'';}catch{return '';}
}
export function validCastingFile(file) {return !!file&&file.size>0&&file.size<=MAX_BYTES&&EXTENSIONS.has(file.name.split('.').pop().toLowerCase());}
export async function castingFingerprint(file) {
  const header=new TextEncoder().encode([file.name,file.size,file.lastModified].join('\n'));
  const first=new Uint8Array(await file.slice(0,65536).arrayBuffer());
  const last=new Uint8Array(await file.slice(Math.max(65536,file.size-65536)).arrayBuffer());
  const input=new Uint8Array(header.length+first.length+last.length);input.set(header);input.set(first,header.length);input.set(last,header.length+first.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input)),b=>b.toString(16).padStart(2,'0')).join('');
}
async function portrait(file) {
  if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>15*1024**2)throw Error('Выбери PNG, JPG или WebP до 15 МБ.');
  const bitmap=await createImageBitmap(file);
  try {
    const canvas=document.createElement('canvas'),scale=Math.min(1,360/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    for(const quality of [.82,.65,.45,.25]){const value=canvas.toDataURL('image/webp',quality);if(value.length<=60000)return value;}
    throw Error('Не удалось уменьшить картинку. Выбери другое изображение.');
  } finally {bitmap.close();}
}

export function createCasting({owner=false,request,uploadPart,download,identity=()=>''}) {
  const root=el('section','fv-casting');root.setAttribute('aria-label','Кастинг');
  let data=null,loading=false,error='',query='',filter='open',editor=null,transfer=null,epoch=0,identityKey='',lastLoad=0;
  let grid=null,notice=null,progress=null,controller=null,actionBusy=false;
  const attempts=new Map();
  const button=(p,label,fn,kind='')=>{const b=add(p,'button','fvc-button '+kind,label);b.type='button';b.onclick=event=>{event.stopPropagation();Promise.resolve().then(fn).catch(e=>{error=e.message;showNotice();});};return b;};
  function showNotice(){if(notice){notice.textContent=error;notice.hidden=!error;}}
  function ensureIdentity(){const key=String(identity());if(key!==identityKey){reset();identityKey=key;}}
  function reset(){epoch++;controller?.abort();controller=null;data=null;lastLoad=0;loading=false;editor=null;transfer=null;actionBusy=false;error='';attempts.clear();root.replaceChildren();}
  async function call(action,body){const e=epoch,result=await request(action,body);if(e!==epoch)throw Error('Сеанс изменён.');return result;}
  async function refresh(force=false){
    ensureIdentity();if(loading||transfer||editor||actionBusy||!root.isConnected)return;
    if(!force&&Date.now()-lastLoad<15000)return;
    loading=true;const e=epoch;
    try {const next=await call('');if(e!==epoch)return;data=next;lastLoad=Date.now();error='';draw();}
    catch(issue){if(e!==epoch)return;error=issue.message||'Не удалось загрузить кастинг.';if(!data)draw();else showNotice();}
    finally {if(e===epoch)loading=false;}
  }
  function mount(host){
    ensureIdentity();host.replaceChildren(root);if(!root.childNodes.length)draw();void refresh();
  }
  function draw(){
    root.replaceChildren();
    const head=add(root,'header','fvc-heading'),words=add(head,'div');
    add(words,'span','fvc-eyebrow',owner?'ПОДБОР ГОЛОСОВ':'ПОПРОБУЙ НОВУЮ РОЛЬ');add(words,'h2','','Кастинг');
    add(words,'p','fvc-muted',owner?'Персонажи, исходники и пробы актёров в одном месте.':'Выбери персонажа, открой исходник и загрузи свою пробу.');
    const actions=add(head,'div','fvc-actions');
    if(owner)button(actions,'+ Добавить персонажа',()=>{editor={id:crypto.randomUUID(),version:0};drawEditor();},'primary').disabled=!!transfer;
    button(actions,'↻ Обновить',()=>refresh(true)).disabled=!!transfer;
    notice=add(root,'p','fvc-notice');notice.setAttribute('role','status');showNotice();
    if(data){
      const meter=add(root,'div','fvc-storage');
      add(meter,'span','',`Облако: ${bytes(data.usedBytes)} из ${bytes(data.quotaBytes)} · вместе с записями`);
      const bar=add(meter,'meter');bar.min=0;bar.max=data.quotaBytes;bar.value=data.usedBytes;bar.setAttribute('aria-label','Занято места в облаке');
      add(meter,'small','fvc-muted','Видео, аудио и ZIP. Размер файла — в пределах свободного места.');
    }
    progress=add(root,'div','fvc-progress');progress.setAttribute('role','status');renderProgress();
    const controls=add(root,'div','fvc-controls');
    const search=add(controls,'input');search.type='search';search.placeholder='Найти персонажа или проект';search.setAttribute('aria-label','Поиск кастинга');search.value=query;
    search.oninput=()=>{query=search.value;renderList();};
    const select=add(controls,'select');select.setAttribute('aria-label','Статус кастинга');
    for(const [value,label] of [['open','Открытые'],['closed','Закрытые'],['all','Все персонажи']]){const op=add(select,'option','',label);op.value=value;}
    select.value=filter;select.onchange=()=>{filter=select.value;renderList();};
    grid=add(root,'div','fvc-grid');renderList();
    if(editor)drawEditor();
  }
  function renderList(){
    if(!grid)return;grid.replaceChildren();
    if(!data){add(grid,'p','fvc-empty',error?'Кастинг пока недоступен. Обнови данные после обновления сервера.':'Загружаем персонажей…');return;}
    const q=query.toLocaleLowerCase('ru');
    const cards=data.cards.filter(c=>(filter==='all'||c.state===filter)&&(!q||(c.name+' '+c.projectTitle).toLocaleLowerCase('ru').includes(q)));
    if(!cards.length){add(grid,'div','fvc-empty',owner?'Здесь пока нет персонажей. Добавь карточку для нового кастинга.':'Здесь пока нет открытых персонажей. Загляни позже или выбери другой фильтр.');return;}
    for(const card of cards){
      const item=add(grid,'article','fvc-card'),top=add(item,'div','fvc-card-top');
      const pic=add(top,'div','fvc-portrait');
      if(/^data:image\/(webp|jpeg|png);base64,/.test(card.image||'')){const img=add(pic,'img');img.src=card.image;img.alt=card.name;img.loading='lazy';}
      else add(pic,'span','',card.name.slice(0,1));
      const info=add(top,'div','fvc-card-info');add(info,'span','fvc-pill '+card.state,card.state==='open'?'Приём открыт':'Приём закрыт');add(info,'h3','',card.name);
      if(card.projectTitle)add(info,'p','fvc-muted',card.projectTitle);
      const url=telegramCastingUrl(card.sourceUrl);
      if(url){const link=add(info,'a','fvc-source','↗ Исходник в Telegram');link.href=url;link.target='_blank';link.rel='noopener noreferrer';}
      if(card.notes)add(item,'p','fvc-notes',card.notes);
      if(owner){const edit=add(item,'div','fvc-actions');button(edit,'Редактировать',()=>{editor={...card};drawEditor();});
        button(edit,card.state==='open'?'Закрыть приём':'Открыть приём',async()=>{await call('save',{...cardPayload(card),state:card.state==='open'?'closed':'open'});await refresh(true);});}
      else if(card.state==='open'){
        const drop=add(item,'label','fvc-drop'),input=add(drop,'input');input.type='file';input.accept='video/*,audio/*,.mkv,.ts,.mts,.m2ts,.mxf,.zip';input.hidden=true;input.disabled=!!transfer;
        add(drop,'strong','','↑ Сдать пробу');add(drop,'small','fvc-muted','Выбери файл или перетащи его сюда');
        input.onchange=()=>{if(input.files[0])void upload(card,input.files[0]);input.value='';};
        drop.ondragover=e=>{e.preventDefault();e.stopPropagation();drop.classList.add('over');};
        drop.ondragleave=()=>drop.classList.remove('over');
        drop.ondrop=e=>{e.preventDefault();e.stopPropagation();drop.classList.remove('over');if(e.dataTransfer.files[0])void upload(card,e.dataTransfer.files[0]);};
      }
      const files=data.files.filter(f=>f.castingId===card.id),ready=files.filter(f=>f.status==='ready');
      const submissions=add(item,'section','fvc-submissions');
      add(submissions,'h4','',owner?`Пробы · ${ready.length}`:`Мои пробы · ${ready.length}`);
      if(!files.length)add(submissions,'p','fvc-muted',owner?'Актёры ещё не прислали пробы.':'Твоя первая проба появится здесь после загрузки.');
      for(const file of files)renderFile(submissions,file,card);
    }
  }
  function renderFile(parent,file,card){
    const row=add(parent,'article','fvc-file');
    if(owner)add(row,'strong','fvc-actor',file.actorName||file.username||file.actorId);
    add(row,'span','fvc-filename',file.fileName);add(row,'small','fvc-muted',bytes(file.size)+' · '+new Date(file.createdAt).toLocaleString('ru-RU'));
    add(row,'span','fvc-pill '+file.review,file.status==='ready'?(REVIEW[file.review]||REVIEW.submitted):file.status==='deleting'?'Удаляется':'Загрузка не завершена');
    if(file.note)add(row,'p','fvc-note',file.note);
    const controls=add(row,'div','fvc-actions');
    if(file.status==='ready')button(controls,'↓ Скачать',async()=>{const result=await call('files/download',{fileId:file.fileId});await download(result);});
    else if(!owner){
      const label=add(controls,'label','fvc-button','Продолжить'),input=add(label,'input');input.type='file';input.hidden=true;
      input.onchange=()=>{if(input.files[0])void upload(card,input.files[0],file);};
    }
    button(controls,'Удалить',async()=>{
      if(!confirm('Удалить «'+file.fileName+'» из облака и освободить место?'))return;
      await call('files/delete',{fileId:file.fileId});await refresh(true);
    },'danger').disabled=!!transfer;
    if(owner&&file.status==='ready'){
      const details=add(row,'details','fvc-review'),summary=add(details,'summary','','Оценить пробу');summary.setAttribute('aria-label','Оценить пробу '+(file.actorName||file.username));
      const form=add(details,'form'),status=add(form,'select');status.setAttribute('aria-label','Результат пробы');
      for(const [value,label] of Object.entries(REVIEW)){const op=add(status,'option','',label);op.value=value;}status.value=file.review;
      const note=add(form,'textarea');note.placeholder='Комментарий актёру';note.setAttribute('aria-label','Комментарий актёру');note.maxLength=2000;note.value=file.note||'';
      const save=add(form,'button','fvc-button primary','Сохранить');save.type='submit';
      form.onsubmit=async event=>{event.preventDefault();event.stopPropagation();save.disabled=true;actionBusy=true;
        try{await call('files/review',{fileId:file.fileId,version:file.version,status:status.value,note:note.value});actionBusy=false;await refresh(true);}
        catch(issue){error=issue.message;showNotice();}finally{actionBusy=false;save.disabled=false;}};
    }
  }
  const cardPayload=card=>({id:card.id,version:card.version,name:card.name,projectTitle:card.projectTitle,image:card.image,sourceUrl:card.sourceUrl,notes:card.notes,state:card.state});
  function drawEditor(){
    root.querySelector('.fvc-editor')?.remove();if(!editor)return;
    const box=add(root,'section','fvc-editor');box.setAttribute('aria-label','Редактор персонажа');
    add(box,'h3','',editor.version?'Редактировать персонажа':'Новый персонаж');
    const form=add(box,'form');
    const field=(label,value,max,tag='input')=>{const wrap=add(form,'label','fvc-field');add(wrap,'span','',label);const n=add(wrap,tag);n.value=value||'';n.maxLength=max;return n;};
    const name=field('Имя персонажа',editor.name,120);name.required=true;
    const project=field('Аниме / проект',editor.projectTitle,160);
    const source=field('Ссылка на исходник в Telegram',editor.sourceUrl,500);source.type='url';source.placeholder='https://t.me/канал/123';source.required=true;
    const notes=field('Описание и указания актёру',editor.notes,2000,'textarea');notes.rows=3;
    let image=editor.image||'';
    const imageField=add(form,'label','fvc-field');add(imageField,'span','','Картинка персонажа');const input=add(imageField,'input');input.type='file';input.accept='image/png,image/jpeg,image/webp';
    const preview=add(form,'img','fvc-image-preview');preview.hidden=!image;if(image)preview.src=image;preview.alt='Картинка персонажа';
    let imagePending=false;
    input.onchange=async()=>{if(!input.files[0])return;imagePending=true;try{image=await portrait(input.files[0]);preview.src=image;preview.hidden=false;}catch(issue){error=issue.message;showNotice();}finally{imagePending=false;}};
    button(form,'Убрать картинку',()=>{image='';preview.hidden=true;input.value='';});
    const actions=add(form,'div','fvc-actions');const save=add(actions,'button','fvc-button primary','Сохранить персонажа');save.type='submit';
    button(actions,'Отмена',()=>{editor=null;box.remove();});
    const formError=add(form,'p','fvc-notice');formError.setAttribute('role','alert');
    form.onsubmit=async event=>{event.preventDefault();event.stopPropagation();if(imagePending){formError.textContent='Дождись подготовки картинки.';return;}
      if(!telegramCastingUrl(source.value.trim())){formError.textContent='Нужна ссылка вида https://t.me/канал/123.';return;}
      save.disabled=true;const e=epoch;
      try{await call('save',{id:editor.id||crypto.randomUUID(),version:editor.version||0,name:name.value.trim(),projectTitle:project.value.trim(),image,sourceUrl:source.value.trim(),notes:notes.value,state:editor.state||'open'});
        if(e!==epoch)return;editor=null;await refresh(true);
      }catch(issue){if(e===epoch)formError.textContent=issue.message;}finally{save.disabled=false;}
    };
    box.scrollIntoView({block:'nearest',behavior:'smooth'});name.focus();
  }
  function renderProgress(){
    if(!progress)return;progress.replaceChildren();progress.hidden=!transfer;if(!transfer)return;
    add(progress,'strong','',transfer.file.name);add(progress,'span','',transfer.phase||'Загружаем пробу…');
    const bar=add(progress,'progress');bar.max=transfer.file.size;bar.value=transfer.done||0;bar.setAttribute('aria-label','Прогресс загрузки пробы');
    add(progress,'small','',bytes(transfer.done||0)+' / '+bytes(transfer.file.size));
    button(progress,'Остановить',()=>controller?.abort());
  }
  async function upload(card,file,resume=null){
    if(transfer)return;
    if(!validCastingFile(file)){error='Выбери видео, аудио или ZIP размером до 9 ГБ.';showNotice();return;}
    const e=epoch;controller=new AbortController();const signal=controller.signal;
    transfer={file,done:0,phase:'Подготавливаем загрузку…'};error='';showNotice();renderProgress();
    try{
      const fingerprint=await castingFingerprint(file);if(e!==epoch||signal.aborted)throw new DOMException('Остановлено','AbortError');
      const old=resume||data.files.find(f=>f.castingId===card.id&&f.status==='pending'&&f.fingerprint===fingerprint);
      if(old&&(old.fingerprint!==fingerprint||old.fileName!==file.name||old.size!==file.size))throw Error('Для продолжения выбери тот же файл, который загружал ранее.');
      const key=card.id+':'+fingerprint;
      const requestId=old?.requestId||attempts.get(key)||crypto.randomUUID();attempts.set(key,requestId);
      const begun=await call('files/begin',{castingId:card.id,fileName:file.name,size:file.size,requestId,fingerprint});
      const upload=await call('multipart/begin',{fileId:begun.fileId});
      const partSize=upload.partSize;if(!upload.uploaded&&(!Number.isInteger(partSize)||partSize<1||partSize>8*1024**2))throw Error('Сервер прислал неверный размер части файла.');
      const completed=new Map((upload.parts||[]).map(p=>[p.partNumber,p.size]));
      if(!upload.uploaded)for(let offset=0,number=1;offset<file.size;offset+=partSize,number++){
        if(signal.aborted||e!==epoch)throw new DOMException('Остановлено','AbortError');
        const part=file.slice(offset,Math.min(file.size,offset+partSize));
        if(completed.get(number)!==part.size){
          transfer.phase='Загружаем пробу…';
          await uploadPart(begun.fileId,number,part,signal,n=>{if(e===epoch&&transfer){transfer.done=offset+n;renderProgress();}});
        }
        if(e!==epoch||signal.aborted||!transfer)throw new DOMException('Остановлено','AbortError');transfer.done=offset+part.size;renderProgress();
      }
      if(signal.aborted)throw new DOMException('Остановлено','AbortError');
      transfer.phase='Проверяем файл в облаке…';renderProgress();
      await call('multipart/complete',{fileId:begun.fileId});attempts.delete(key);
      if(e===epoch){transfer=null;controller=null;await refresh(true);error='Проба сдана. Руководитель увидит её в кастинге.';showNotice();}
    }catch(issue){if(e===epoch){transfer=null;controller=null;error=issue.name==='AbortError'?'Загрузка остановлена. Выбери тот же файл, чтобы продолжить, или удали незавершённую пробу.':issue.message;const message=error;await refresh(true);error=message;showNotice();}}
    finally{if(e===epoch){transfer=null;controller=null;renderProgress();}}
  }
  if(typeof window!=='undefined')setInterval(()=>{if(root.isConnected&&!root.querySelector('input:focus,textarea:focus,select:focus,details[open]'))void refresh();},45000);
  return {mount,refresh,reset,get busy(){return !!transfer;}};
}
