// Loaded separately from the ES module graph: show an actionable error if imports fail.
setTimeout(()=>{
  const boot=document.querySelector('#app > .boot');
  if(!boot)return;
  const detail=document.createElement('p');
  detail.style.cssText='max-width:32rem;text-align:center;font-size:0.9rem;line-height:1.6;opacity:.85';
  detail.textContent='Интерфейс не загрузился. Полностью закрой Actor через значок возле часов Windows и снова запусти лаунчер для проверки обновления.';
  boot.appendChild(detail);
},12000);
