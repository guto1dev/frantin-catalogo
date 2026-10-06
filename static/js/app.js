(function () {
  'use strict';

  const root = window.FrantinCatalog;
  const config = root.config;
  const state = new root.CatalogState(config.pageCount);

  document.title = config.title;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', config.title);
  const titleNode = document.getElementById('catalogHeaderTitle');
  const editionNode = document.getElementById('catalogEdition');
  if (titleNode) titleNode.textContent = config.headerTitle;
  if (editionNode) {
    editionNode.textContent = config.edition;
    editionNode.hidden = !config.edition;
  }

  function parseInitialPage() {
    const match = window.location.hash.match(/(?:^#?|&)page=(\d+)/i);
    if (!match) return 1;
    return state.clamp(match[1]);
  }

  let ui;
  const engine = new root.PageTurnEngine({
    stage: document.getElementById('bookStage'),
    landscapeBook: document.getElementById('landscapeBook'),
    portraitBook: document.getElementById('portraitBook'),
    portraitSheet: document.getElementById('portraitSheet'),
    portraitFront: document.getElementById('portraitFront'),
    portraitBack: document.getElementById('portraitBack'),
    portraitUnderlay: document.getElementById('portraitUnderlay'),
    state,
    config,
    onFlip: () => ui?.playPageSound(1)
  });

  ui = new root.CatalogUI({ state, config, engine });
  const initialPage = parseInitialPage();
  engine.goTo(initialPage, false, 'initial');

  window.addEventListener('hashchange', () => {
    const requested = parseInitialPage();
    if (requested !== state.currentPage) engine.goTo(requested, false, 'hash');
  });

  window.setTimeout(() => document.getElementById('bookStage').classList.remove('intro'), 1000);

  // API pequena para testes locais e integração futura.
  root.app = Object.freeze({ state, engine, ui, config });
}());
