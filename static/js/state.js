(function () {
  'use strict';

  const root = window.FrantinCatalog = window.FrantinCatalog || {};

  class CatalogState {
    constructor(pageCount) {
      this.pageCount = pageCount;
      this.currentPage = 1;
      this.mode = 'landscape';
      this.soundEnabled = false;
      this.listeners = new Set();
    }

    clamp(page) {
      const value = Number.parseInt(page, 10);
      if (!Number.isFinite(value)) return this.currentPage;
      return Math.min(this.pageCount, Math.max(1, value));
    }

    setPage(page, source = 'internal') {
      const next = this.clamp(page);
      const changed = next !== this.currentPage;
      this.currentPage = next;
      this.emit({ type: 'page', page: next, source, changed });
      return next;
    }

    setMode(mode) {
      if (mode === this.mode) return;
      this.mode = mode;
      this.emit({ type: 'mode', mode });
    }

    toggleSound() {
      this.soundEnabled = !this.soundEnabled;
      this.emit({ type: 'sound', enabled: this.soundEnabled });
      return this.soundEnabled;
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit(event) {
      this.listeners.forEach((listener) => listener(event));
    }
  }

  root.CatalogState = CatalogState;
}());
