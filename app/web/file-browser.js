// Fundi Voice desktop file browser. Calls authenticated loopback APIs only.
export async function openFileBrowser(api,options={}) {
  const mode=options.mode==='folder'?'folder':'file';
  const title=options.title||(mode==='folder'?'Куда сохранить запись?':'Выбрать аудиофайл');
  let last='';
  try{last=localStorage.getItem('fundi-local-file-browser-'+mode)||'';}catch{}
  return new Promise(resolve=>{
    const create=(tag,cls,text)=>{
      const node=document.createElement(tag);
      if(cls)node.className=cls;
      if(text!==undefined)node.textContent=text;
      return node;
    };
    const dialog=create('dialog','fv-file-browser');
    const windowBox=create('div','fv-browser-window');
    const header=create('header','fv-browser-header');
    const headLeft=create('div','fv-browser-heading');
    headLeft.append(create('div','fv-browser-eyebrow','F U N D I  V O I C E · ФАЙЛЫ'));
    headLeft.append(create('h2','',title));
    const closeButton=create('button','fv-browser-close','×');
    closeButton.type='button';closeButton.setAttribute('aria-label','Закрыть окно');
    header.append(headLeft,closeButton);
    const toolbar=create('div','fv-browser-toolbar');
    const upButton=create('button','fv-browser-up','↑ Вверх');upButton.type='button';
    const location=create('input','fv-browser-address');
    location.type='text';location.setAttribute('aria-label','Текущий путь');location.spellcheck=false;
    const goButton=create('button','fv-browser-go','Перейти');goButton.type='button';
    toolbar.append(upButton,location,goButton);
    const searchRow=create('div','fv-browser-searchbar');
    const search=create('input','fv-browser-search');
    search.placeholder='Поиск по имени файла и в подпапках…';
    search.type='search';search.setAttribute('aria-label','Поиск файлов в папке и подпапках');
    const note=create('span','fv-browser-search-note','Поиск внутри выбранной папки');
    searchRow.append(search,note);
    const content=create('div','fv-browser-content');
    const sidebar=create('aside','fv-browser-places');
    const shortcuts=create('div','fv-browser-shortcuts');
    const volumes=create('div','fv-browser-volumes');
    sidebar.append(create('div','fv-browser-side-heading','БЫСТРЫЙ ДОСТУП'),shortcuts,
      create('div','fv-browser-side-heading fv-browser-side-spaced','ДИСКИ'),volumes);
    const center=create('section','fv-browser-main');
    const info=create('div','fv-browser-info','Открываем папку…');
    const list=create('div','fv-browser-list');
    list.setAttribute('role','listbox');list.setAttribute('aria-label','Файлы и папки');
    center.append(info,list);
    content.append(sidebar,center);
    const footer=create('footer','fv-browser-footer');
    const selectedLabel=create('span','fv-browser-selected','Выбери файл для отправки');
    const actions=create('div','fv-browser-actions');
    const native=create('button','fv-browser-native','Проводник Windows');
    native.type='button';
    const cancel=create('button','fv-browser-cancel','Отмена');cancel.type='button';
    const accept=create('button','fv-browser-accept',mode==='folder'?'Выбрать эту папку':'Выбрать файл');
    accept.type='button';accept.disabled=true;
    actions.append(native,cancel,accept);footer.append(selectedLabel,actions);
    windowBox.append(header,toolbar,searchRow,content,footer);dialog.append(windowBox);
    document.body.append(dialog);
    let current='',parent='',selected='',seq=0,timeoutId=0,closed=false,loading=false;
    const finish=value=>{
      if(closed)return;closed=true;
      clearTimeout(timeoutId);
      try{dialog.close();}catch{}
      dialog.remove();resolve(value);
    };
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
    closeButton.onclick=()=>finish(null);cancel.onclick=()=>finish(null);
    native.onclick=()=>finish({native:true});
    dialog.addEventListener('click',event=>event.stopPropagation());
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();finish(null);}
    });
    const showError=message=>{
      info.textContent=message;info.classList.add('fv-browser-error');
    };
    const addLink=(container,item)=>{
      const button=create('button','fv-browser-place',item.name);
      button.type='button';button.title=item.path;
      button.onclick=()=>{search.value='';load(item.path,'');};
      container.append(button);
    };
    const renderItems=data=>{
      shortcuts.replaceChildren();volumes.replaceChildren();list.replaceChildren();
      (data.places||[]).forEach(item=>addLink(shortcuts,item));
      (data.drives||[]).forEach(item=>addLink(volumes,item));
      const folders=data.directories||[],files=data.files||[];
      selected='';accept.disabled=mode!=='folder';current=data.path;parent=data.parent||'';
      location.value=current;upButton.disabled=!parent;
      if(mode==='folder'){selectedLabel.textContent='Папка: '+current;}
      else{selectedLabel.textContent='Выбери запись из списка';}
      info.classList.remove('fv-browser-error');
      info.textContent=(data.searched?'Результаты поиска: ':'Содержимое папки: ')+
        (folders.length+files.length)+' · '+(data.limited?'показана часть результатов':'папки выше файлов');
      const addRow=(entry,isDir)=>{
        const row=create('button','fv-browser-entry'+(isDir?' fv-browser-directory':''));
        row.type='button';row.setAttribute('role','option');row.setAttribute('aria-selected','false');
        const glyph=create('span','fv-browser-entry-icon',isDir?'📁':'♫');
        const body=create('span','fv-browser-entry-body');
        body.append(create('strong','',entry.name));
        let subText=isDir?'Папка':'Аудио или архив';
        if(!isDir){
          const size=Number(entry.size)||0;
          subText=(size>=1048576?(size/1048576).toFixed(1)+' МБ':Math.ceil(size/1024)+' КБ')+
            (entry.modified?' · '+entry.modified:'');
        }
        if(data.searched)subText+=' · '+entry.path;
        body.append(create('small','',subText));
        row.append(glyph,body);
        row.onclick=()=>{
          if(isDir){search.value='';load(entry.path,'');return;}
          selected=entry.path;
          for(const other of list.querySelectorAll('.fv-browser-entry')){
            other.classList.remove('is-selected');other.setAttribute('aria-selected','false');
          }
          row.classList.add('is-selected');row.setAttribute('aria-selected','true');
          selectedLabel.textContent=entry.name;
          accept.disabled=false;
        };
        row.ondblclick=()=>{
          if(isDir){search.value='';load(entry.path,'');}
          else{saveLast();finish({path:entry.path});}
        };
        list.append(row);
      };
      folders.forEach(x=>addRow(x,true));files.forEach(x=>addRow(x,false));
      if(!folders.length&&!files.length)list.append(create('div','fv-browser-empty',data.searched?
        'Совпадений нет. Попробуй другое название.':'В этой папке подходящих файлов нет.'));
    };
    const saveLast=()=>{try{if(current)localStorage.setItem('fundi-local-file-browser-'+mode,current);}catch{}};
    async function load(path,query){
      if(closed)return;
      const request=++seq;
      loading=true;accept.disabled=true;list.replaceChildren();
      info.classList.remove('fv-browser-error');info.textContent='Ищем файлы…';
      try{
        const result=await api('file-browser',{path:path||'',query:query||'',mode});
        if(closed||request!==seq)return;
        renderItems(result);
      }catch(error){
        if(closed||request!==seq)return;
        showError(error?.message||'Не удалось открыть эту папку.');
      }finally{if(request===seq)loading=false;}
    }
    upButton.onclick=()=>{if(parent){search.value='';load(parent,'');}};
    goButton.onclick=()=>{search.value='';load(location.value,'');};
    location.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();search.value='';load(location.value,'');}
    });
    search.addEventListener('input',()=>{
      clearTimeout(timeoutId);
      timeoutId=setTimeout(()=>load(current,search.value),280);
    });
    search.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();clearTimeout(timeoutId);load(current,search.value);}
    });
    accept.onclick=()=>{
      if(loading)return;
      const picked=mode==='folder'?current:selected;
      if(!picked)return;saveLast();finish({path:picked});
    };
    dialog.showModal();
    load(options.startPath||last,'').catch(showError);
  });
}
