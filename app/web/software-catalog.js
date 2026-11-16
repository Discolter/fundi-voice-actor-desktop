// The API owns all access checks, publication, quota and counters.
const categories={programs:'Программы',vst:'VST-плагины',reaper:'REAPER: скрипты',presets:'Пресеты',guides:'Инструкции',other:'Другое'};
const blank=()=>({name:'',version:'',description:'',instructions:'',category:'reaper',importance:'recommended',inHouse:false,officialUrl:'',telegramUrl:'',fileIds:[],imageIds:[]});
const size=n=>n>=1073741824?(n/1073741824).toFixed(2)+' ГБ':n>=1048576?(n/1048576).toFixed(1)+' МБ':Math.ceil(n/1024)+' КБ';
const node=(p,tag,cls='',text='')=>{const el=document.createElement(tag);el.className=cls;el.textContent=text;p?.append(el);return el;};
function button(p,text,fn,primary=false){const b=node(p,'button','fv-soft-btn'+(primary?' fv-soft-primary':''),text);b.type='button';b.onclick=fn;return b;}
function safeUrl(value,storage=false){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;if(storage&&(!/^[a-f0-9]{32}\.(?:eu\.)?r2\.cloudflarestorage\.com$/i.test(u.hostname)||!u.searchParams.has('X-Amz-Signature')))return null;return u;}catch{return null;}}
export function createSoftwareCatalog({owner=false,identity,request}){
 let root=null,model=null,key='',generation=0,loading=false,busy=false,err='',editId='',draft=null,filter='all',category='all',query='',xhr=null;
 const alive=g=>g===generation&&identity()===key&&Boolean(key);
 function reset(){generation++;xhr?.abort();xhr=null;root=null;model=null;key='';loading=busy=false;err=editId=query='';draft=null;filter=category='all';}
 async function reload(){const g=generation;loading=true;err='';render();try{const next=await request('');if(alive(g))model=next;}catch(e){if(alive(g))err=e.message;}finally{if(alive(g)){loading=false;render();}}}
 async function action(fn){if(busy||loading)return;const g=generation;busy=true;err='';render();try{await fn(g);}catch(e){if(alive(g))err=e.message||'Операция не выполнена.';}finally{if(alive(g)){busy=false;render();}}}
 const current=()=>model?.cards?.find(x=>x.id===editId);
 async function save(g){if(!draft.name.trim()||!draft.version.trim())throw Error('Укажи название и версию.');await request('save',{id:editId,revision:current()?.revision||0,content:draft});if(!alive(g))throw Error('Сеанс завершён.');const next=await request('');if(!alive(g))throw Error('Сеанс завершён.');model=next;}
 function edit(item){editId=item?.id||crypto.randomUUID();draft=structuredClone(item?.content||blank());err='';render();}
 function field(p,name,label,type='text'){const wrap=node(p,'label','fv-soft-field',label),el=node(wrap,type==='textarea'?'textarea':'input');if(type==='textarea')el.rows=4;else el.type=type;el.disabled=busy;el.value=draft[name]||'';el.oninput=()=>draft[name]=el.value;return el;}
 function select(p,label,options,value,change){const wrap=node(p,'label','fv-soft-field',label),el=node(wrap,'select');for(const [k,v]of options){const o=node(el,'option','',v);o.value=k;}el.value=value;el.onchange=()=>change(el.value);el.disabled=busy;return el;}
 function check(p,label,checked,onChange,disabled=false){const wrap=node(p,'label','fv-soft-check'),el=node(wrap,'input');el.type='checkbox';el.checked=checked;el.disabled=busy||disabled;el.onchange=()=>onChange(el.checked);node(wrap,'span','',label);}
 function gallery(p,assets,c){const images=(c.imageIds||[]).map(id=>assets.find(x=>x.id===id)).filter(a=>a&&safeUrl(a.previewUrl,true));if(!images.length)return;const grid=node(p,'div','fv-soft-gallery');for(const a of images){const img=node(grid,'img');img.src=a.previewUrl;img.alt=a.fileName;img.loading='lazy';img.referrerPolicy='no-referrer';}}
 function upload(url,file,progress){const u=safeUrl(url,true);if(!u)throw Error('Некорректная ссылка R2.');
   return new Promise((resolve,reject)=>{const req=new XMLHttpRequest();xhr=req;req.open('PUT',u.href);req.upload.onprogress=e=>{if(e.lengthComputable)progress(Math.round(100*e.loaded/e.total));};req.onload=()=>req.status>=200&&req.status<300?resolve():reject(Error('R2: HTTP '+req.status));req.onerror=()=>reject(Error('R2 недоступен. Проверь сеть и CORS хранилища.'));req.onabort=()=>reject(Error('Загрузка отменена.'));req.onloadend=()=>{if(xhr===req)xhr=null;};req.send(file);});}
 function editor(p){const box=node(p,'section','fv-soft-panel');node(box,'h2','',current()?'Редактирование ПО':'Новое ПО');const grid=node(box,'div','fv-soft-grid');
   field(grid,'name','Название');field(grid,'version','Версия');
   select(grid,'Категория',Object.entries(categories),draft.category,v=>draft.category=v);
   select(grid,'Важность',[['required','Обязательное'],['recommended','Рекомендуемое']],draft.importance,v=>draft.importance=v);
   check(box,'Наша разработка FundiVoice',draft.inHouse,v=>draft.inHouse=v);
   field(box,'description','Описание','textarea');field(box,'instructions','Инструкция','textarea');field(box,'officialUrl','Официальный сайт','url');field(box,'telegramUrl','Сообщение Telegram','url');
   node(box,'h3','','Вложения и скриншоты');
   const assets=current()?.assets||[];for(const a of assets){const row=node(box,'div','fv-soft-actions'),ids=a.kind==='image'?draft.imageIds:draft.fileIds;
     check(row,a.fileName+' · '+size(a.size)+(a.state==='ready'?'':' · '+a.state),ids.includes(a.id),on=>{if(on&&!ids.includes(a.id))ids.push(a.id);else if(!on&&ids.includes(a.id))ids.splice(ids.indexOf(a.id),1);},a.state!=='ready');
     button(row,'Удалить файл',()=>{if(confirm('Удалить файл? Сначала исключи его из опубликованной карточки.'))void action(async g=>{await save(g);await request('assets/delete',{assetId:a.id});await reload();});}).disabled=busy;
   }
   gallery(box,assets,draft);
   for(const kind of ['file','image']){const drop=node(box,'label','fv-soft-drop',kind==='file'?'Перетащи файл программы или выбери его':'Перетащи иконку / скриншот или выбери изображение'),input=node(drop,'input');input.type='file';input.disabled=busy;if(kind==='image')input.accept='.png,.jpg,.jpeg,.webp';
     const start=file=>{if(!file||busy)return;void action(async g=>{await save(g);const receipt=await request('assets/begin',{cardId:editId,kind,fileName:file.name,size:file.size});if(!alive(g))return;await upload(receipt.uploadUrl,file,pct=>{const el=root?.querySelector('.fv-soft-progress');if(el)el.textContent='Загрузка: '+pct+'%';});if(!alive(g))return;await request('assets/complete',{assetId:receipt.assetId});(kind==='image'?draft.imageIds:draft.fileIds).push(receipt.assetId);await save(g);});};
     input.onchange=()=>start(input.files?.[0]);drop.ondragover=e=>e.preventDefault();drop.ondrop=e=>{e.preventDefault();start(e.dataTransfer?.files?.[0]);};}
   if(busy)node(box,'p','fv-soft-progress','Выполняется операция…');
   const bar=node(box,'div','fv-soft-actions');
   button(bar,'Сохранить черновик',()=>action(save),true).disabled=busy;
   button(bar,'Опубликовать',()=>action(async g=>{await save(g);await request('publish',{id:editId,revision:current().revision});draft=null;editId='';await reload();})).disabled=busy;
   if(current()?.published)button(bar,'Снять с публикации',()=>{if(confirm('Скрыть от актёров?'))void action(async()=>{await request('unpublish',{id:editId,revision:current().revision});await reload();});}).disabled=busy;
   button(bar,'Закрыть',()=>{draft=null;editId='';render();}).disabled=busy;
 }
 function card(p,item){const c=item.content,assets=item.assets||[],box=node(p,'article','fv-soft-panel'),header=node(box,'div','fv-soft-actions');
   const cover=(c.imageIds||[]).map(id=>assets.find(a=>a.id===id)).find(a=>a&&safeUrl(a.previewUrl,true));
   if(cover){const img=node(header,'img','fv-soft-icon');img.src=cover.previewUrl;img.alt='';img.referrerPolicy='no-referrer';}
   const title=node(header,'div');node(title,'h3','',c.name);node(title,'p','fv-soft-muted','Версия '+c.version+' · '+(categories[c.category]||c.category));
   const tags=node(box,'div','fv-soft-actions');node(tags,'span','fv-soft-chip '+(c.importance==='required'?'fv-soft-required':''),c.importance==='required'?'Обязательное':'Рекомендуемое');if(c.inHouse)node(tags,'span','fv-soft-chip','FundiVoice');
   if(owner)node(tags,'span','fv-soft-chip',item.published?(JSON.stringify(item.published)===JSON.stringify(c)?'Опубликовано':'Изменённый черновик'):'Черновик');
   if(c.description)node(box,'p','fv-soft-text',c.description);
   const details=node(box,'details');node(details,'summary','','Инструкция и примеры');if(c.instructions)node(details,'p','fv-soft-text',c.instructions);gallery(details,assets,c);
   if(owner){node(box,'p','fv-soft-muted','Запросов скачивания: '+item.downloadStarts+' · Переходов: '+item.externalClicks);button(box,'Редактировать',()=>edit(item),true).disabled=busy;}
   else{const actions=node(box,'div','fv-soft-actions');
     const access=(target,label)=>button(actions,label,async()=>{if(busy)return;const g=generation;busy=true;err='';try{const data=await request('access',{cardId:item.id,target,requestId:crypto.randomUUID()});if(!alive(g))return;const u=safeUrl(data.url,target!=='official'&&target!=='telegram');if(!u)throw Error('Неверная ссылка.');
       const link=node(box,'a','fv-soft-direct','Открыть: '+label);link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.click();
     }catch(e){if(alive(g)){err=e.message;render();}}finally{if(alive(g))busy=false;}},true);
     for(const id of c.fileIds||[]){const a=assets.find(x=>x.id===id);if(a)access(id,'Скачать '+a.fileName);}
     if(c.officialUrl)access('official','Официальный сайт');if(c.telegramUrl)access('telegram','Telegram');
   }}
 function render(){if(!root?.isConnected||!key)return;root.replaceChildren();root.classList.add('fv-soft');const toolbar=node(root,'div','fv-soft-actions');button(toolbar,'Обновить',reload).disabled=busy||loading;
   if(owner){button(toolbar,'+ Добавить ПО',()=>edit(null),true).disabled=busy||loading;if(model)node(toolbar,'span','fv-soft-muted','Облако: '+size(model.usedBytes||0)+' / '+size(model.quotaBytes||0));}
   if(err)node(root,'p','fv-soft-error',err);
   if(draft&&owner){editor(root);return;}
   const controls=node(root,'div','fv-soft-grid'),search=node(controls,'input');search.type='search';search.placeholder='Поиск программ';search.value=query;
   const list=node(root,'div','fv-soft-grid');
   function populate(){list.replaceChildren();if(loading&&!model){node(list,'p','','Загрузка каталога…');return;}
      const cards=(model?.cards||[]).filter(x=>{const c=x.content;return (category==='all'||category===c.category)&&(filter==='all'||filter==='own'&&c.inHouse||filter==='draft'&&!x.published||filter==='published'&&x.published||filter===c.importance)&&[c.name,c.description,c.version].join(' ').toLowerCase().includes(query.toLowerCase());}).sort((a,b)=>Number(b.content.importance==='required')-Number(a.content.importance==='required')||a.content.name.localeCompare(b.content.name,'ru'));
      for(const item of cards)card(list,item);if(!cards.length)node(list,'p','fv-soft-muted','Программ пока нет или ничего не найдено.');}
   search.oninput=()=>{query=search.value;populate();};
   select(controls,'Категория',[['all','Все категории'],...Object.entries(categories)],category,v=>{category=v;populate();});
   select(controls,'Фильтр',[['all','Все программы'],['required','Обязательные'],['recommended','Рекомендуемые'],['own','Наши разработки'],...(owner?[['draft','Черновики'],['published','Опубликованные']]:[])],filter,v=>{filter=v;populate();});populate();
 }
 return {mount(el){if(!el)return;const user=identity();if(user!==key){reset();key=user;}root=el;render();if(key&&!model&&!loading&&!err)void reload();},reset,get busy(){return busy||loading;}};
}
