(function () {
  'use strict';

  const root = window.FrantinCatalog = window.FrantinCatalog || {};

  class CatalogUI {
    constructor({ state, config, engine }) {
      this.state = state;
      this.config = config;
      this.engine = engine;
      this.toastTimer = null;
      this.thumbsReady = false;
      this.zoomLevel = 1;
      this.zoomPage = 1;
      this.zoomDrag = null;

      this.elements = {
        prev: document.getElementById('prevButton'),
        next: document.getElementById('nextButton'),
        bottomPrev: document.getElementById('bottomPrev'),
        bottomNext: document.getElementById('bottomNext'),
        first: document.getElementById('firstButton'),
        last: document.getElementById('lastButton'),
        pageInput: document.getElementById('pageInput'),
        pageTotal: document.getElementById('pageTotal'),
        spread: document.getElementById('spreadIndicator'),
        thumbsButton: document.getElementById('thumbsButton'),
        thumbsPanel: document.getElementById('thumbsPanel'),
        thumbsGrid: document.getElementById('thumbsGrid'),
        thumbsCount: document.getElementById('thumbsCount'),
        closeThumbs: document.getElementById('closeThumbs'),
        backdrop: document.getElementById('drawerBackdrop'),
        zoomButton: document.getElementById('zoomButton'),
        zoomOverlay: document.getElementById('zoomOverlay'),
        zoomImage: document.getElementById('zoomImage'),
        zoomLabel: document.getElementById('zoomLabel'),
        zoomPagePrev: document.getElementById('zoomPagePrev'),
        zoomPageNext: document.getElementById('zoomPageNext'),
        zoomPageInput: document.getElementById('zoomPageInput'),
        zoomPageTotal: document.getElementById('zoomPageTotal'),
        zoomCanvas: document.getElementById('zoomCanvas'),
        closeZoom: document.getElementById('closeZoom'),
        zoomIn: document.getElementById('zoomIn'),
        zoomOut: document.getElementById('zoomOut'),
        zoomReset: document.getElementById('zoomReset'),
        sound: document.getElementById('soundButton'),
        share: document.getElementById('shareButton'),
        fullscreen: document.getElementById('fullscreenButton'),
        download: document.getElementById('downloadButton'),
        toast: document.getElementById('toast'),
        live: document.getElementById('liveRegion')
      };

      this.applyCatalogMetadata();
      this.bind();
      this.state.subscribe((event) => this.onState(event));
      this.updateNavigation();
    }

    applyCatalogMetadata() {
      const total = this.config.pageCount;
      this.elements.pageInput.max = String(total);
      this.elements.zoomPageInput.max = String(total);
      this.elements.pageTotal.textContent = `/ ${total}`;
      this.elements.zoomPageTotal.textContent = `/ ${total}`;
      this.elements.thumbsCount.textContent = `${total} páginas`;
      this.elements.download.href = this.config.pdfPath;
      this.elements.download.download = this.config.downloadName;
    }

    bind() {
      const goPrev = () => this.engine.prev();
      const goNext = () => this.engine.next();
      this.elements.prev.addEventListener('click', goPrev);
      this.elements.bottomPrev.addEventListener('click', goPrev);
      this.elements.next.addEventListener('click', goNext);
      this.elements.bottomNext.addEventListener('click', goNext);
      this.elements.first.addEventListener('click', () => this.engine.goTo(1, false, 'control'));
      this.elements.last.addEventListener('click', () => this.engine.goTo(this.config.pageCount, false, 'control'));

      this.elements.pageInput.addEventListener('change', () => this.engine.goTo(this.elements.pageInput.value, false, 'input'));
      this.elements.pageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          this.engine.goTo(this.elements.pageInput.value, false, 'input');
          this.elements.pageInput.blur();
        }
      });

      this.elements.thumbsButton.addEventListener('click', () => this.openThumbs());
      this.elements.closeThumbs.addEventListener('click', () => this.closeThumbs());
      this.elements.backdrop.addEventListener('click', () => this.closeThumbs());

      this.elements.zoomButton.addEventListener('click', () => this.openZoom());
      this.elements.closeZoom.addEventListener('click', () => this.closeZoom());
      this.elements.zoomOverlay.addEventListener('click', (event) => {
        if (event.target === this.elements.zoomOverlay) this.closeZoom();
      });
      this.elements.zoomPagePrev.addEventListener('click', () => this.changeZoomPage(-1));
      this.elements.zoomPageNext.addEventListener('click', () => this.changeZoomPage(1));
      this.elements.zoomPageInput.addEventListener('change', () => this.setZoomPage(this.elements.zoomPageInput.value));
      this.elements.zoomPageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          this.setZoomPage(this.elements.zoomPageInput.value);
          this.elements.zoomPageInput.blur();
        }
      });
      this.elements.zoomIn.addEventListener('click', () => this.setZoom(this.zoomLevel + .2));
      this.elements.zoomOut.addEventListener('click', () => this.setZoom(this.zoomLevel - .2));
      this.elements.zoomReset.addEventListener('click', () => this.setZoom(1));
      this.elements.zoomCanvas.addEventListener('wheel', (event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        this.setZoom(this.zoomLevel + (event.deltaY < 0 ? .15 : -.15));
      }, { passive: false });

      this.elements.sound.addEventListener('click', () => {
        const enabled = this.state.toggleSound();
        this.elements.sound.setAttribute('aria-pressed', String(enabled));
        this.elements.sound.setAttribute('aria-label', enabled ? 'Desativar som de página' : 'Ativar som de página');
        if (enabled) this.playPageSound(.5);
      });

      this.elements.share.addEventListener('click', () => this.share());
      this.elements.fullscreen.addEventListener('click', () => this.toggleFullscreen());
      document.addEventListener('fullscreenchange', () => {
        this.elements.fullscreen.setAttribute('aria-label', document.fullscreenElement ? 'Sair da tela cheia' : 'Entrar em tela cheia');
      });

      document.addEventListener('keydown', (event) => {
        const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
        if (event.key === 'Escape') {
          this.closeZoom();
          this.closeThumbs();
          return;
        }
        if (!this.elements.zoomOverlay.hidden) {
          if (typing) return;
          if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            event.preventDefault();
            this.changeZoomPage(1);
          }
          if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            event.preventDefault();
            this.changeZoomPage(-1);
          }
          if (event.key === 'Home') this.setZoomPage(1);
          if (event.key === 'End') this.setZoomPage(this.config.pageCount);
          return;
        }
        if (typing) return;
        if (event.key === 'ArrowRight' || event.key === 'PageDown') this.engine.next();
        if (event.key === 'ArrowLeft' || event.key === 'PageUp') this.engine.prev();
        if (event.key === 'Home') this.engine.goTo(1, false, 'keyboard');
        if (event.key === 'End') this.engine.goTo(this.config.pageCount, false, 'keyboard');
        if (event.key.toLowerCase() === 'f') this.toggleFullscreen();
      });
    }

    onState(event) {
      if (event.type === 'page' || event.type === 'mode') this.updateNavigation();
      if (event.type === 'page') {
        this.updateHash(event.page);
        this.updateThumbSelection();
      }
    }

    updateNavigation() {
      const page = this.state.currentPage;
      this.elements.pageInput.value = String(page);
      this.elements.spread.textContent = this.engine.getVisibleLabel();
      this.elements.prev.disabled = page <= 1;
      this.elements.bottomPrev.disabled = page <= 1;
      this.elements.next.disabled = page >= this.config.pageCount;
      this.elements.bottomNext.disabled = page >= this.config.pageCount;
      this.elements.live.textContent = `Página ${page} de ${this.config.pageCount}`;
    }

    buildThumbs() {
      if (this.thumbsReady) return;
      const fragment = document.createDocumentFragment();
      for (let page = 1; page <= this.config.pageCount; page += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'thumb-card';
        button.dataset.page = String(page);
        button.setAttribute('aria-label', `Ir para página ${page}`);
        const image = document.createElement('img');
        image.loading = 'lazy';
        image.decoding = 'async';
        image.alt = `Miniatura da página ${page}`;
        image.src = this.config.thumbnailPath(page);
        const label = document.createElement('span');
        label.textContent = String(page).padStart(2, '0');
        button.append(image, label);
        button.addEventListener('click', () => {
          this.engine.goTo(page, false, 'thumbnail');
          this.closeThumbs();
        });
        fragment.appendChild(button);
      }
      this.elements.thumbsGrid.appendChild(fragment);
      this.thumbsReady = true;
      this.updateThumbSelection();
    }

    openThumbs() {
      this.buildThumbs();
      this.elements.thumbsPanel.classList.add('open');
      this.elements.thumbsPanel.setAttribute('aria-hidden', 'false');
      this.elements.thumbsButton.setAttribute('aria-expanded', 'true');
      this.elements.backdrop.hidden = false;
      this.updateThumbSelection(true);
    }

    closeThumbs() {
      this.elements.thumbsPanel.classList.remove('open');
      this.elements.thumbsPanel.setAttribute('aria-hidden', 'true');
      this.elements.thumbsButton.setAttribute('aria-expanded', 'false');
      this.elements.backdrop.hidden = true;
    }

    updateThumbSelection(scroll = false) {
      if (!this.thumbsReady) return;
      this.elements.thumbsGrid.querySelectorAll('.thumb-card.active').forEach((el) => el.classList.remove('active'));
      const active = this.elements.thumbsGrid.querySelector(`.thumb-card[data-page="${this.state.currentPage}"]`);
      if (active) {
        active.classList.add('active');
        if (scroll) active.scrollIntoView({ block: 'center' });
      }
    }

    openZoom() {
      this.setZoomPage(this.state.currentPage, false);
      this.setZoom(1);
      this.elements.zoomOverlay.hidden = false;
      document.body.dataset.zoomOpen = 'true';
    }

    closeZoom() {
      if (this.elements.zoomOverlay.hidden) return;
      this.elements.zoomOverlay.hidden = true;
      delete document.body.dataset.zoomOpen;
    }

    setZoomPage(page, resetScroll = true) {
      const parsed = Number.parseInt(page, 10);
      const safePage = Math.min(this.config.pageCount, Math.max(1, Number.isFinite(parsed) ? parsed : this.zoomPage));
      this.zoomPage = safePage;
      this.refreshZoomImage(resetScroll);
      return safePage;
    }

    changeZoomPage(delta) {
      return this.setZoomPage(this.zoomPage + delta);
    }

    refreshZoomImage(resetScroll = true) {
      const page = this.zoomPage || this.state.currentPage;
      this.elements.zoomImage.src = this.config.imagePath(page);
      this.elements.zoomImage.alt = `Página ${page} ampliada`;
      this.elements.zoomLabel.textContent = `Página ${page}`;
      this.elements.zoomPageInput.value = String(page);
      this.elements.zoomPagePrev.disabled = page <= 1;
      this.elements.zoomPageNext.disabled = page >= this.config.pageCount;
      if (resetScroll) {
        this.elements.zoomCanvas.scrollTop = 0;
        this.elements.zoomCanvas.scrollLeft = 0;
      }
    }

    setZoom(level) {
      this.zoomLevel = Math.min(3, Math.max(.7, Math.round(level * 20) / 20));
      this.elements.zoomImage.style.width = `${Math.round(Math.min(900, window.innerWidth * .88) * this.zoomLevel)}px`;
      this.elements.zoomReset.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }

    async share() {
      const url = `${window.location.href.split('#')[0]}#page=${this.state.currentPage}`;
      const data = { title: this.config.title, text: `${this.config.headerTitle} — página ${this.state.currentPage}`, url };
      try {
        if (navigator.share) {
          await navigator.share(data);
        } else if (navigator.clipboard?.writeText && window.isSecureContext) {
          await navigator.clipboard.writeText(url);
          this.showToast('Link da página copiado.');
        } else {
          window.prompt('Copie o link desta página:', url);
        }
      } catch (error) {
        if (error?.name !== 'AbortError') this.showToast('Não foi possível compartilhar neste navegador.');
      }
    }

    async toggleFullscreen() {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
      } catch (_) {
        this.showToast('Tela cheia não está disponível neste navegador.');
      }
    }

    updateHash(page) {
      const hash = `page=${page}`;
      if (window.location.hash.slice(1) === hash) return;
      try {
        history.replaceState(null, '', `#${hash}`);
      } catch (_) {
        // Alguns navegadores limitam history em file://; a navegação segue funcionando.
      }
    }

    showToast(message) {
      window.clearTimeout(this.toastTimer);
      this.elements.toast.textContent = message;
      this.elements.toast.classList.add('show');
      this.toastTimer = window.setTimeout(() => this.elements.toast.classList.remove('show'), 2200);
    }

    playPageSound(intensity = 1) {
      if (!this.state.soundEnabled) return;
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        this.audioContext = this.audioContext || new AudioContextClass();
        const ctx = this.audioContext;
        const duration = .11;
        const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) {
          const envelope = Math.sin(Math.PI * i / data.length);
          data[i] = (Math.random() * 2 - 1) * envelope * .16 * intensity;
        }
        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1650;
        filter.Q.value = .7;
        const gain = ctx.createGain();
        gain.gain.value = .28;
        source.buffer = buffer;
        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start();
      } catch (_) {
        // Áudio é um detalhe de interface; falha silenciosa mantém a leitura funcionando.
      }
    }
  }

  root.CatalogUI = CatalogUI;
}());
