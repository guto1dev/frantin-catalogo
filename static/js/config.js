(function () {
  'use strict';

  const root = window.FrantinCatalog = window.FrantinCatalog || {};
  const manifest = window.FrantinCatalogManifest;
  if (!manifest || !manifest.slug || !manifest.pageCount) {
    throw new Error('Manifesto do catálogo não foi carregado.');
  }

  const localBase = `../catalogs/${manifest.slug}/`;
  const webBase = `/catalogs/${manifest.slug}/`;
  const base = window.location.protocol === 'file:' ? localBase : webBase;
  const version = encodeURIComponent(manifest.version || 'current');
  const versioned = (path) => `${base}${path}?v=${version}`;

  root.config = Object.freeze({
    title: manifest.title,
    headerTitle: manifest.headerTitle || manifest.title,
    edition: manifest.edition || '',
    slug: manifest.slug,
    pageCount: Number(manifest.pageCount),
    pageWidth: Number(manifest.pageWidth),
    pageHeight: Number(manifest.pageHeight),
    portraitBreakpoint: 760,
    version: manifest.version,
    imagePath(page) {
      return versioned(`pages/page-${String(page).padStart(3, '0')}.webp`);
    },
    thumbnailPath(page) {
      return versioned(`thumbnails/page-${String(page).padStart(3, '0')}.webp`);
    },
    pdfPath: versioned('original/catalogo.pdf'),
    downloadName: manifest.downloadName || 'Catalogo-Frantin.pdf'
  });
}());
