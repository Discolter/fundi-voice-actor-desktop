// Shared full-screen character portrait viewer for Studio, Actor Desktop and Actor Web.
(() => {
  let dialog = null, previousFocus = null, closeTimer = null;
  const validImage = value => typeof value === 'string' &&
    value.length <= 150000 && /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value);
  function close() {
    if (!dialog) return;
    const old = dialog;
    dialog = null;
    old.classList.remove('is-visible');
    old.setAttribute('aria-hidden','true');
    document.removeEventListener('keydown',onKeyDown,true);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => old.remove(),240);
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
    previousFocus = null;
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab' && dialog) {
      event.preventDefault();
      dialog.querySelector('button')?.focus();
    }
  }
  function open(button) {
    const source = button.querySelector('img')?.getAttribute('src');
    if (!validImage(source)) return;
    close();
    clearTimeout(closeTimer);
    previousFocus = button;
    const title = button.getAttribute('aria-label') || 'Изображение персонажа';
    const root = document.createElement('div');
    root.className = 'fv-role-image-lightbox';
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label',title);
    root.innerHTML = '<button type="button" class="fv-role-image-close" aria-label="Закрыть изображение">×</button><div class="fv-role-image-frame"><img alt=""></div>';
    root.querySelector('img').src = source;
    root.querySelector('img').alt = title;
    root.addEventListener('click',event => {
      if (event.target === root || event.target.closest('.fv-role-image-close')) close();
    });
    dialog = root;
    document.body.append(root);
    document.addEventListener('keydown',onKeyDown,true);
    requestAnimationFrame(() => { if (dialog===root) root.classList.add('is-visible'); });
    root.querySelector('button').focus({preventScroll:true});
  }
  document.addEventListener('click',event => {
    const button = event.target.closest?.('[data-role-image-open]');
    if (!button || !button.querySelector('img')) return;
    event.preventDefault();
    event.stopPropagation();
    open(button);
  },true);
})();