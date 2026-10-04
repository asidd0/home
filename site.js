(() => {
  const root = document.getElementById('auyon-site');
  const sections = [...root.querySelectorAll('[data-view]')];
  const links = [...root.querySelectorAll('[data-view-link]')];
  const allowed = new Set(sections.map(section => section.dataset.view));
  const menu = root.querySelector('.mobile-menu-toggle');
  const main = document.getElementById('main-content');
  const title = 'Auyon Siddiq | UCLA Anderson School of Management';

  function closeMenu() {
    root.removeAttribute('data-mobile-menu-open');
    menu.setAttribute('aria-expanded', 'false');
  }

  function showPage() {
    const requested = window.location.hash.slice(1);
    const view = allowed.has(requested) ? requested : 'about';
    for (const section of sections) section.hidden = section.dataset.view !== view;
    for (const link of links) {
      if (link.dataset.viewLink === view) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const active = links.find(link => link.dataset.viewLink === view);
    document.title = view === 'about' ? title : `${active.textContent} | Auyon Siddiq`;
    closeMenu();
  }

  root.setAttribute('data-mobile-nav-ready', '');
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    root.toggleAttribute('data-mobile-menu-open', open);
  });

  root.querySelector('.nav-links').addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    if (!link.dataset.viewLink || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      closeMenu();
      return;
    }
    event.preventDefault();
    const fromMenu = menu.getAttribute('aria-expanded') === 'true';
    const hash = `#${link.dataset.viewLink}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    showPage();
    if (fromMenu) main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });

  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menu.focus();
    }
  });
  window.addEventListener('popstate', showPage);
  window.addEventListener('hashchange', showPage);
  window.matchMedia('(min-width: 561px)').addEventListener('change', closeMenu);
  showPage();
})();
