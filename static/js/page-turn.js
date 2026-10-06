(function () {
  'use strict';

  const root = window.FrantinCatalog = window.FrantinCatalog || {};

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function nextFrame(count = 1) {
    return new Promise((resolve) => {
      const tick = () => {
        if (count <= 1) resolve();
        else {
          count -= 1;
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  }

  class PageTurnEngine {
    constructor({ stage, landscapeBook, portraitBook, portraitSheet, portraitFront, portraitBack, portraitUnderlay, state, config, onFlip }) {
      this.stage = stage;
      this.landscapeBook = landscapeBook;
      this.portraitBook = portraitBook;
      this.portraitSheet = portraitSheet;
      this.portraitFront = portraitFront;
      this.portraitBack = portraitBack;
      this.portraitUnderlay = portraitUnderlay;
      this.state = state;
      this.config = config;
      this.onFlip = onFlip;

      this.sheetCount = Math.ceil(config.pageCount / 2);
      this.currentSheet = 0;
      this.sheets = [];
      this.drag = null;
      this.turn = null;
      this.animating = false;
      this.mode = 'landscape';
      this.pointerDownAt = 0;
      this.previewActive = false;
      this._warmPages = new Map();
      this._renderSurfaces = new Map();
      this._renderFrame = 0;
      this._pendingRenderPoint = null;

      this.buildLandscape();
      this.createTurnCanvas();
      this.bindPointerEvents();
      this.bindCornerPreview();
      this.syncMode(true);
      window.addEventListener('resize', () => this.syncMode(false), { passive: true });
    }

    buildLandscape() {
      const fragment = document.createDocumentFragment();

      for (let index = 0; index < this.sheetCount; index += 1) {
        const frontPage = index * 2 + 1;
        const backPage = index * 2 + 2;
        const sheet = document.createElement('div');
        sheet.className = `sheet${index === 0 || index === this.sheetCount - 1 ? ' cover-sheet' : ''}`;
        sheet.dataset.index = String(index);
        sheet.style.zIndex = String(this.sheetCount - index);

        const front = document.createElement('div');
        front.className = 'page-face front';
        const frontImg = document.createElement('img');
        frontImg.alt = `Página ${frontPage}`;
        frontImg.decoding = 'async';
        frontImg.draggable = false;
        frontImg.dataset.page = String(frontPage);
        frontImg.dataset.src = this.config.imagePath(frontPage);
        front.appendChild(frontImg);

        const back = document.createElement('div');
        back.className = 'page-face back';
        const backImg = document.createElement('img');
        backImg.alt = `Página ${backPage}`;
        backImg.decoding = 'async';
        backImg.draggable = false;
        backImg.dataset.page = String(backPage);
        backImg.dataset.src = this.config.imagePath(backPage);
        back.appendChild(backImg);

        sheet.append(front, back);
        fragment.appendChild(sheet);
        this.sheets.push(sheet);
      }

      this.landscapeBook.appendChild(fragment);
      this.ensureAroundPage(1, 6);
    }

    createTurnCanvas() {
      const canvas = document.createElement('canvas');
      canvas.className = 'soft-turn-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.hidden = true;
      this.stage.appendChild(canvas);
      this.turnCanvas = canvas;
      this.turnContext = canvas.getContext('2d', { alpha: true, desynchronized: true });
    }

    syncTurnCanvas() {
      const rect = this.stage.getBoundingClientRect();
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const cssWidth = Math.max(1, rect.width);
      const cssHeight = Math.max(1, rect.height);
      const pixelWidth = Math.round(cssWidth * dpr);
      const pixelHeight = Math.round(cssHeight * dpr);

      if (this.turnCanvas.width !== pixelWidth || this.turnCanvas.height !== pixelHeight) {
        this.turnCanvas.width = pixelWidth;
        this.turnCanvas.height = pixelHeight;
      }

      this.turnCanvas.style.width = `${cssWidth}px`;
      this.turnCanvas.style.height = `${cssHeight}px`;
      this.turnContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width: cssWidth, height: cssHeight };
    }

    getTurnGeometry() {
      const size = this.syncTurnCanvas();
      return {
        width: size.width,
        height: size.height,
        pageWidth: this.mode === 'landscape' ? size.width / 2 : size.width
      };
    }

    bindPointerEvents() {
      this.stage.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
      this.stage.addEventListener('pointermove', (event) => this.handlePointerMove(event));
      this.stage.addEventListener('pointerup', (event) => this.handlePointerUp(event));
      this.stage.addEventListener('pointercancel', (event) => this.handlePointerUp(event, true));
    }

    bindCornerPreview() {
      const clear = () => {
        if (this.drag || this.animating) return;
        this.previewActive = false;
        this.clearTurnCanvas();
      };

      this.stage.addEventListener('pointermove', (event) => {
        if (this.drag || this.animating || event.pointerType === 'touch') return;

        const rect = this.stage.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const hotX = Math.min(72, rect.width * .065);
        const hotY = Math.min(74, rect.height * .10);
        const nearTop = y >= 0 && y <= hotY;
        const nearLeft = x >= 0 && x <= hotX;
        const nearRight = x <= rect.width && x >= rect.width - hotX;
        let direction = null;

        if (nearTop && nearRight && this.canFlip('forward')) direction = 'forward';
        if (nearTop && nearLeft && this.canFlip('backward')) direction = 'backward';

        if (!direction) {
          clear();
          return;
        }

        const edgeDistance = direction === 'forward' ? rect.width - x : x;
        const intensity = clamp(1 - Math.max(edgeDistance / hotX, y / hotY), 0, 1);
        if (intensity < .05) {
          clear();
          return;
        }

        this.previewActive = true;
        this.renderCornerPreview(direction, intensity);
      }, { passive: true });

      this.stage.addEventListener('pointerleave', clear, { passive: true });
    }

    renderCornerPreview(direction, intensity) {
      const g = this.getTurnGeometry();
      const ctx = this.turnContext;
      const pages = this.getTurnPages(direction);
      const backImage = this.getPageImage(pages.backPage);
      const sourceImage = this.getPageImage(pages.frontPage);
      if (!sourceImage?.naturalWidth) return;

      ctx.clearRect(0, 0, g.width, g.height);
      this.turnCanvas.hidden = false;

      const size = clamp(14 + intensity * 34, 14, Math.min(50, g.pageWidth * .09));
      const edgeX = this.mode === 'portrait'
        ? (direction === 'forward' ? g.width : 0)
        : (direction === 'forward' ? g.width : 0);
      const sign = direction === 'forward' ? -1 : 1;
      const innerX = edgeX + sign * size;
      const lowerY = size * .96;

      // Sombra curta sob a pontinha levantada. Fora da zona quente o canvas é limpo.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(edgeX, 0);
      ctx.quadraticCurveTo(edgeX + sign * size * .48, size * .18, innerX, lowerY);
      ctx.lineTo(edgeX, lowerY * .72);
      ctx.closePath();
      const shadow = ctx.createLinearGradient(innerX, 0, edgeX, lowerY);
      shadow.addColorStop(0, 'rgba(0,0,0,.19)');
      shadow.addColorStop(.65, 'rgba(0,0,0,.06)');
      shadow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shadow;
      ctx.fill();
      ctx.restore();

      // Verso discreto do papel: só a dobra do canto, nunca a folha inteira.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(edgeX, 0);
      ctx.quadraticCurveTo(edgeX + sign * size * .36, size * .28, innerX, lowerY);
      ctx.quadraticCurveTo(edgeX + sign * size * .18, size * .60, edgeX, lowerY * .56);
      ctx.closePath();
      ctx.clip();

      if (backImage?.naturalWidth) {
        const crop = Math.max(2, Math.round(backImage.naturalWidth * (size / Math.max(1, g.pageWidth))));
        const sx = direction === 'forward' ? 0 : Math.max(0, backImage.naturalWidth - crop);
        ctx.save();
        if (direction === 'forward') {
          ctx.translate(edgeX - size, 0);
          ctx.drawImage(backImage, sx, 0, crop, Math.max(2, Math.round(backImage.naturalHeight * (size / g.height))), 0, 0, size, size);
        } else {
          ctx.translate(edgeX, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(backImage, sx, 0, crop, Math.max(2, Math.round(backImage.naturalHeight * (size / g.height))), 0, 0, size, size);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = '#f4f4f1';
        ctx.fillRect(Math.min(edgeX, innerX), 0, size, size);
      }

      const paperLight = ctx.createLinearGradient(innerX, 0, edgeX, lowerY);
      paperLight.addColorStop(0, 'rgba(255,255,255,.92)');
      paperLight.addColorStop(.48, 'rgba(255,255,255,.24)');
      paperLight.addColorStop(1, 'rgba(40,46,60,.12)');
      ctx.fillStyle = paperLight;
      ctx.fillRect(Math.min(edgeX, innerX), 0, size, size);
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(innerX, lowerY);
      ctx.quadraticCurveTo(edgeX + sign * size * .20, size * .28, edgeX, 0);
      ctx.strokeStyle = `rgba(35,42,56,${.18 + intensity * .18})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    syncMode(initial) {
      const portrait = window.matchMedia('(max-width: 760px), (max-aspect-ratio: 4/5)').matches;
      const nextMode = portrait ? 'portrait' : 'landscape';
      if (!initial && nextMode === this.mode) return;

      this.clearTurnCanvas();
      this.mode = nextMode;
      this.landscapeBook.setAttribute('aria-hidden', String(nextMode !== 'landscape'));
      this.portraitBook.setAttribute('aria-hidden', String(nextMode !== 'portrait'));

      if (nextMode === 'landscape') this.setLandscapePage(this.state.currentPage, false);
      else this.renderPortrait(this.state.currentPage);

      this.state.setMode(nextMode);
    }

    toLocal(globalX, globalY, direction) {
      const rect = this.stage.getBoundingClientRect();
      const g = this.getTurnGeometry();
      const x = globalX - rect.left;
      const y = globalY - rect.top;

      if (this.mode === 'portrait') {
        return {
          x: direction === 'forward' ? x : g.pageWidth - x,
          y
        };
      }

      return {
        x: direction === 'forward' ? x - g.pageWidth : g.pageWidth - x,
        y
      };
    }

    toGlobal(point, direction) {
      const g = this.getTurnGeometry();
      if (this.mode === 'portrait') {
        return {
          x: direction === 'forward' ? point.x : g.pageWidth - point.x,
          y: point.y
        };
      }
      return {
        x: direction === 'forward' ? g.pageWidth + point.x : g.pageWidth - point.x,
        y: point.y
      };
    }

    getTurnPages(direction) {
      if (this.mode === 'portrait') {
        const frontPage = this.state.currentPage;
        const backPage = direction === 'forward'
          ? Math.min(this.config.pageCount, frontPage + 1)
          : Math.max(1, frontPage - 1);
        return { frontPage, backPage, bottomPage: backPage };
      }

      if (direction === 'forward') {
        const frontPage = this.currentSheet * 2 + 1;
        const backPage = this.currentSheet * 2 + 2;
        const bottom = this.currentSheet * 2 + 3;
        return {
          frontPage: frontPage <= this.config.pageCount ? frontPage : null,
          backPage: backPage <= this.config.pageCount ? backPage : null,
          bottomPage: bottom <= this.config.pageCount ? bottom : null
        };
      }

      const frontPage = this.currentSheet * 2;
      const backPage = this.currentSheet * 2 - 1;
      const bottom = this.currentSheet * 2 - 2;
      return {
        frontPage: frontPage >= 1 ? frontPage : null,
        backPage: backPage >= 1 ? backPage : null,
        bottomPage: bottom >= 1 ? bottom : null
      };
    }

    prepareTurn(direction, globalX, globalY, preview = false, previewIntensity = 0) {
      const g = this.getTurnGeometry();
      const rect = this.stage.getBoundingClientRect();
      const local = this.toLocal(globalX, globalY, direction);
      const pages = this.getTurnPages(direction);

      [pages.frontPage, pages.backPage, pages.bottomPage].forEach((page) => this.warmPage(page));

      this.turn = {
        direction,
        preview,
        previewIntensity,
        frontPage: pages.frontPage,
        backPage: pages.backPage,
        bottomPage: pages.bottomPage,
        startLocal: {
          x: clamp(local.x, -g.pageWidth, g.pageWidth),
          y: clamp(local.y, 0, g.height)
        },
        corner: (globalY - rect.top) <= g.height / 2 ? 'top' : 'bottom'
      };

      this.turnCanvas.hidden = false;
    }

    warmPage(page) {
      const safe = Number(page);
      if (!Number.isFinite(safe) || safe < 1 || safe > this.config.pageCount) return null;
      if (this._warmPages.has(safe)) return this._warmPages.get(safe);

      const image = new Image();
      image.decoding = 'async';
      image.src = this.config.imagePath(safe);
      this._warmPages.set(safe, image);
      image.decode?.().catch(() => {});
      return image;
    }

    getPageImage(page) {
      if (!page) return null;
      const safe = clamp(Number(page), 1, this.config.pageCount);
      const warm = this.warmPage(safe);
      if (warm?.complete && warm.naturalWidth) return warm;

      const existing = this.landscapeBook.querySelector(`img[data-page="${safe}"]`);
      if (existing?.complete && existing.naturalWidth) return existing;
      return warm || existing || null;
    }

    getSourceSize(source) {
      if (!source) return { width: 0, height: 0 };
      return {
        width: source.naturalWidth || source.width || 0,
        height: source.naturalHeight || source.height || 0
      };
    }

    getRenderSurface(page) {
      if (!page) return null;
      const image = this.getPageImage(page);
      const imageSize = this.getSourceSize(image);
      if (!imageSize.width || !imageSize.height) return null;

      const g = this.getTurnGeometry();
      const width = Math.max(1, Math.round(g.pageWidth));
      const height = Math.max(1, Math.round(g.height));
      const key = `${page}:${width}x${height}`;
      if (this._renderSurfaces.has(key)) return this._renderSurfaces.get(key);

      // Mantemos no máximo duas geometrias de tela por página para não acumular memória após resize.
      for (const existingKey of this._renderSurfaces.keys()) {
        if (existingKey.startsWith(`${page}:`) && existingKey !== key) this._renderSurfaces.delete(existingKey);
      }

      const surface = document.createElement('canvas');
      surface.width = width;
      surface.height = height;
      const surfaceContext = surface.getContext('2d', { alpha: false });
      surfaceContext.imageSmoothingEnabled = true;
      surfaceContext.imageSmoothingQuality = 'high';
      surfaceContext.fillStyle = '#fff';
      surfaceContext.fillRect(0, 0, width, height);
      surfaceContext.drawImage(image, 0, 0, width, height);
      this._renderSurfaces.set(key, surface);
      return surface;
    }

    queueFlexibleRender(local) {
      this._pendingRenderPoint = local;
      if (this._renderFrame) return;
      this._renderFrame = requestAnimationFrame(() => {
        this._renderFrame = 0;
        const point = this._pendingRenderPoint;
        this._pendingRenderPoint = null;
        if (point && this.turn) this.renderFlexibleTurn(point);
      });
    }

    ensurePageLoaded(page) {
      if (page < 1 || page > this.config.pageCount) return null;
      const image = this.landscapeBook.querySelector(`img[data-page="${page}"]`);
      if (image && !image.getAttribute('src')) image.setAttribute('src', image.dataset.src);
      return image;
    }

    ensureAroundPage(page, radius) {
      for (let value = page - radius; value <= page + radius; value += 1) {
        if (value < 1 || value > this.config.pageCount) continue;
        this.ensurePageLoaded(value);
        this.warmPage(value);
      }
      this.ensurePageLoaded(1);
      this.ensurePageLoaded(this.config.pageCount);
      this.warmPage(1);
      this.warmPage(this.config.pageCount);
    }

    async waitForPageReady(page) {
      if (!page || page < 1 || page > this.config.pageCount) return;
      const domImage = this.ensurePageLoaded(page);
      const warm = this.warmPage(page);
      const waits = [];
      for (const image of [domImage, warm]) {
        if (!image) continue;
        if (image.complete && image.naturalWidth) continue;
        if (image.decode) waits.push(image.decode().catch(() => {}));
        else waits.push(new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }));
      }
      await Promise.all(waits);
    }

    drawBasePage(image, direction) {
      const ctx = this.turnContext;
      const g = this.getTurnGeometry();
      const x = this.mode === 'portrait'
        ? 0
        : direction === 'forward' ? g.pageWidth : 0;

      if (this.getSourceSize(image).width) {
        ctx.drawImage(image, x, 0, g.pageWidth, g.height);
        return;
      }

      if (this.mode === 'landscape') {
        const gradient = ctx.createLinearGradient(x, 0, x + g.pageWidth, 0);
        gradient.addColorStop(0, '#08142d');
        gradient.addColorStop(1, '#061127');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, 0, g.pageWidth, g.height);
      }
    }

    buildPaperCurve(localPos) {
      const g = this.getTurnGeometry();
      const W = g.pageWidth;
      const H = g.height;
      const pointerX = clamp(localPos.x, -W, W - .25);
      const progress = clamp((W - pointerX) / (2 * W), 0, 1);
      const angle = progress * Math.PI;
      const flexEnvelope = Math.sin(Math.PI * progress);
      const segmentCount = this.mode === 'portrait' ? 52 : 84;
      const ds = W / segmentCount;
      const startY = this.turn?.startLocal?.y ?? localPos.y;
      const dy = clamp(localPos.y - startY, -H * .46, H * .46);
      const previewBoost = this.turn?.preview ? (this.turn.previewIntensity || .5) : 0;
      const points = [{ x: 0, yTop: 0, yBottom: H, z: 0, theta: 0 }];

      let x = 0;
      let z = 0;
      for (let index = 1; index <= segmentCount; index += 1) {
        const uMid = (index - .5) / segmentCount;
        const u = index / segmentCount;
        const soft = Math.pow(uMid, .56);
        const localFlex = angle * (soft - 1) * .96;
        const rollingEdge = .96 * Math.pow(uMid, 1.85);
        const previewCurl = previewBoost * 1.95 * Math.pow(uMid, 8.5);
        const theta = angle + flexEnvelope * (localFlex + rollingEdge) + previewCurl;

        x += ds * Math.cos(theta);
        z += ds * Math.sin(theta);

        const cornerWeight = Math.pow(u, 1.72);
        const mainShift = dy * cornerWeight;
        const calmShift = mainShift * .10;
        let yTop = 0;
        let yBottom = H;
        if (this.turn?.corner === 'bottom') {
          yTop += calmShift;
          yBottom += mainShift;
        } else {
          yTop += mainShift;
          yBottom += calmShift;
        }

        const paperSag = flexEnvelope * Math.sin(Math.PI * u) * (H * .0065);
        yTop -= paperSag;
        yBottom += paperSag * .26;

        points.push({ x, yTop, yBottom, z, theta });
      }

      const outer = points[points.length - 1];
      const correction = pointerX - outer.x;
      for (let index = 1; index < points.length; index += 1) {
        const u = index / segmentCount;
        const weight = Math.pow(u, 2.18);
        points[index].x += correction * weight;
      }

      return { points, progress, segmentCount, maxDepth: Math.max(1, ...points.map((point) => Math.abs(point.z))) };
    }

    sourceRangeForSegment(image, u0, u1, reversed) {
      const size = this.getSourceSize(image);
      if (!size.width) return null;
      const iw = size.width;
      if (!reversed) {
        return {
          sx: clamp(u0 * iw, 0, iw),
          sw: Math.max(1, (u1 - u0) * iw),
          reversePoints: false
        };
      }
      return {
        sx: clamp((1 - u1) * iw, 0, iw),
        sw: Math.max(1, (u1 - u0) * iw),
        reversePoints: true
      };
    }

    drawPaperSegment(image, point0, point1, u0, u1, side, curve) {
      const imageSize = this.getSourceSize(image);
      if (!imageSize.width || !imageSize.height) return;

      const direction = this.turn.direction;
      const g = this.getTurnGeometry();
      const isBack = side === 'back';
      const reversedSource = direction === 'forward' ? isBack : !isBack;
      const source = this.sourceRangeForSegment(image, u0, u1, reversedSource);
      if (!source) return;

      let top0 = this.toGlobal({ x: point0.x, y: point0.yTop }, direction);
      let top1 = this.toGlobal({ x: point1.x, y: point1.yTop }, direction);
      let bottom0 = this.toGlobal({ x: point0.x, y: point0.yBottom }, direction);
      let bottom1 = this.toGlobal({ x: point1.x, y: point1.yBottom }, direction);

      if (source.reversePoints) {
        [top0, top1] = [top1, top0];
        [bottom0, bottom1] = [bottom1, bottom0];
      }

      const ctx = this.turnContext;
      const sw = source.sw;
      const dx = top1.x - top0.x;
      const dy = top1.y - top0.y;
      const leftHeightX = bottom0.x - top0.x;
      const leftHeightY = bottom0.y - top0.y;
      const a = dx / sw;
      const b = dy / sw;
      const c = leftHeightX / g.height;
      const d = leftHeightY / g.height;
      const overlap = Math.min(4.5, Math.max(1.4, sw * .14));

      ctx.save();
      ctx.translate(top0.x, top0.y);
      ctx.transform(a, b, c, d, 0, 0);
      ctx.drawImage(
        image,
        source.sx,
        0,
        Math.min(imageSize.width - source.sx, sw + overlap),
        imageSize.height,
        0,
        0,
        sw + overlap,
        g.height
      );

      ctx.restore();
    }

    drawFlexiblePage(frontImage, backImage, curve) {
      const segments = [];
      for (let index = 0; index < curve.segmentCount; index += 1) {
        const p0 = curve.points[index];
        const p1 = curve.points[index + 1];
        const theta = (p0.theta + p1.theta) / 2;
        const side = Math.cos(theta) >= 0 ? 'front' : 'back';
        const image = side === 'front' ? frontImage : backImage;
        segments.push({ index, p0, p1, side, image, z: (p0.z + p1.z) / 2 });
      }

      segments.sort((a, b) => a.z - b.z);
      for (const segment of segments) {
        const u0 = segment.index / curve.segmentCount;
        const u1 = (segment.index + 1) / curve.segmentCount;
        this.drawPaperSegment(segment.image, segment.p0, segment.p1, u0, u1, segment.side, curve);
      }
    }

    drawPaperEdges(curve) {
      const ctx = this.turnContext;
      const direction = this.turn.direction;

      const strokeEdge = (selector, alpha, width) => {
        ctx.save();
        ctx.beginPath();
        curve.points.forEach((point, index) => {
          const global = this.toGlobal({ x: point.x, y: selector(point) }, direction);
          if (index === 0) ctx.moveTo(global.x, global.y);
          else ctx.lineTo(global.x, global.y);
        });
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
      };

      strokeEdge((point) => point.yTop, .76, 1.05);
      strokeEdge((point) => point.yBottom, .66, 1.15);
    }

    drawFoldShadow(curve) {
      const ctx = this.turnContext;
      const g = this.getTurnGeometry();
      let hottest = null;

      for (let index = 1; index < curve.points.length; index += 1) {
        const point = curve.points[index];
        const tangent = Math.abs(Math.cos(point.theta));
        const score = (1 - tangent) * (Math.abs(point.z) + 1);
        if (!hottest || score > hottest.score) hottest = { point, score };
      }
      if (!hottest) return;

      const midY = (hottest.point.yTop + hottest.point.yBottom) / 2;
      const global = this.toGlobal({ x: hottest.point.x, y: midY }, this.turn.direction);
      const width = Math.max(12, g.pageWidth * (.045 + .07 * Math.sin(Math.PI * curve.progress)));
      const opacity = .06 + .15 * Math.sin(Math.PI * curve.progress);
      const gradient = ctx.createLinearGradient(global.x - width, 0, global.x + width, 0);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(.45, `rgba(0,0,0,${opacity})`);
      gradient.addColorStop(.56, `rgba(255,255,255,${opacity * .48})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(global.x - width, 0, width * 2, g.height);
    }

    renderFlexibleTurn(localPos) {
      if (!this.turn) return false;
      const g = this.getTurnGeometry();
      const ctx = this.turnContext;
      const safe = {
        x: clamp(localPos.x, -g.pageWidth, g.pageWidth - .25),
        y: clamp(localPos.y, 0, g.height)
      };

      const frontImage = this.getRenderSurface(this.turn.frontPage);
      const backImage = this.getRenderSurface(this.turn.backPage);
      const bottomImage = this.getRenderSurface(this.turn.bottomPage);
      if (!this.getSourceSize(frontImage).width || !this.getSourceSize(backImage).width) return false;

      const curve = this.buildPaperCurve(safe);
      ctx.clearRect(0, 0, g.width, g.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';

      this.drawBasePage(bottomImage, this.turn.direction);
      this.drawFlexiblePage(frontImage, backImage, curve);
      this.drawPaperEdges(curve);
      this.drawFoldShadow(curve);
      return true;
    }

    clearTurnCanvas() {
      if (this._renderFrame) {
        cancelAnimationFrame(this._renderFrame);
        this._renderFrame = 0;
        this._pendingRenderPoint = null;
      }
      if (!this.turnCanvas || !this.turnContext) return;
      const g = this.syncTurnCanvas();
      this.turnContext.clearRect(0, 0, g.width, g.height);
      this.turnCanvas.hidden = true;
      this.turn = null;
      this.previewActive = false;
    }

    handlePointerDown(event) {
      if (this.animating || event.button > 0) return;

      const rect = this.stage.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const direction = x >= rect.width / 2 ? 'forward' : 'backward';
      if (!this.canFlip(direction)) return;

      this.clearTurnCanvas();
      this.pointerDownAt = performance.now();
      this.drag = {
        pointerId: event.pointerId,
        direction,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        moved: false
      };

      this.prepareTurn(direction, event.clientX, event.clientY, false, 0);
      const local = this.toLocal(event.clientX, event.clientY, direction);
      this.renderFlexibleTurn(local);

      this.stage.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }

    handlePointerMove(event) {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - this.drag.startX;
      const dy = event.clientY - this.drag.startY;
      if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
      this.drag.currentX = event.clientX;
      this.drag.currentY = event.clientY;

      const local = this.toLocal(event.clientX, event.clientY, this.drag.direction);
      this.queueFlexibleRender(local);
      event.preventDefault();
    }

    handlePointerUp(event, cancelled = false) {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;

      const drag = this.drag;
      this.drag = null;
      this.stage.releasePointerCapture?.(event.pointerId);

      const elapsed = Math.max(1, performance.now() - this.pointerDownAt);
      const velocity = Math.abs(drag.currentX - drag.startX) / elapsed;
      const local = this.toLocal(drag.currentX, drag.currentY, drag.direction);
      if (this._renderFrame) {
        cancelAnimationFrame(this._renderFrame);
        this._renderFrame = 0;
        this._pendingRenderPoint = null;
      }
      this.renderFlexibleTurn(local);
      const g = this.getTurnGeometry();
      const clicked = !drag.moved && elapsed < 450;
      const crossed = local.x <= g.pageWidth * .46;
      const complete = !cancelled && (clicked || crossed || velocity > .72);

      this.finishTurn(drag.direction, complete, local);
      event.preventDefault();
    }

    animateLocalPoint(from, to, onFrame, onDone) {
      const distancePx = Math.hypot(to.x - from.x, to.y - from.y);
      const g = this.getTurnGeometry();
      const duration = clamp(250 + (distancePx / Math.max(1, g.pageWidth)) * 270, 280, 610);
      const started = performance.now();

      const step = (now) => {
        const t = clamp((now - started) / duration, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3.2);
        onFrame({
          x: from.x + (to.x - from.x) * eased,
          y: from.y + (to.y - from.y) * eased
        });
        if (t < 1) requestAnimationFrame(step);
        else onDone();
      };
      requestAnimationFrame(step);
    }

    visiblePagesForSheet(sheetIndex) {
      if (sheetIndex <= 0) return [1];
      if (sheetIndex >= this.sheetCount) return [this.config.pageCount];
      const left = sheetIndex * 2;
      const right = Math.min(this.config.pageCount, left + 1);
      return [left, right].filter((page) => page >= 1 && page <= this.config.pageCount);
    }

    async commitCompletedTurn(direction) {
      if (this.mode === 'landscape') {
        const targetSheet = clamp(
          this.currentSheet + (direction === 'forward' ? 1 : -1),
          0,
          this.sheetCount
        );
        const pages = this.visiblePagesForSheet(targetSheet);
        await Promise.all(pages.map((page) => this.waitForPageReady(page)));

        this.currentSheet = targetSheet;
        this.applyLandscapeStack();
        const page = targetSheet === 0
          ? 1
          : targetSheet >= this.sheetCount
            ? this.config.pageCount
            : Math.min(this.config.pageCount, targetSheet * 2 + 1);
        this.state.setPage(page, 'flip');
        this.ensureAroundPage(page, 7);
        this.onFlip?.(direction);
        void this.stage.offsetWidth;
        await nextFrame(3);
        return;
      }

      const targetPage = clamp(
        this.state.currentPage + (direction === 'forward' ? 1 : -1),
        1,
        this.config.pageCount
      );
      await this.waitForPageReady(targetPage);
      this.state.setPage(targetPage, 'flip');
      this.renderPortrait(targetPage, { keepTurnCanvas: true });
      this.ensureAroundPage(targetPage, 5);
      this.onFlip?.(direction);
      void this.stage.offsetWidth;
      await nextFrame(3);
    }

    finishTurn(direction, complete, startLocal) {
      if (!this.turn) return;
      this.animating = true;
      const g = this.getTurnGeometry();
      const start = {
        x: clamp(startLocal.x, -g.pageWidth, g.pageWidth - .25),
        y: clamp(startLocal.y, 0, g.height)
      };
      const restingY = this.turn.startLocal?.y ?? start.y;
      const target = complete
        ? { x: -g.pageWidth, y: restingY }
        : { x: g.pageWidth - .25, y: restingY };

      this.animateLocalPoint(start, target, (point) => {
        this.renderFlexibleTurn(point);
      }, async () => {
        if (complete) await this.commitCompletedTurn(direction);
        else await nextFrame(2);
        this.clearTurnCanvas();
        this.animating = false;
      });
    }

    canFlip(direction) {
      if (this.mode === 'landscape') {
        return direction === 'forward'
          ? this.currentSheet < this.sheetCount
          : this.currentSheet > 0;
      }
      return direction === 'forward'
        ? this.state.currentPage < this.config.pageCount
        : this.state.currentPage > 1;
    }

    applyLandscapeStack() {
      this.sheets.forEach((sheet, index) => {
        const flipped = index < this.currentSheet;
        sheet.style.transform = flipped ? 'rotateY(-180deg)' : 'rotateY(0deg)';
        sheet.style.zIndex = String(flipped ? index + 1 : this.sheetCount - index);
      });
    }

    setLandscapePage(page, animate = false) {
      const normalized = clamp(Number(page), 1, this.config.pageCount);
      const targetSheet = normalized === 1 ? 0 : Math.floor(normalized / 2);

      if (animate && Math.abs(targetSheet - this.currentSheet) === 1) {
        this.animateProgrammatic(targetSheet > this.currentSheet ? 'forward' : 'backward');
        return;
      }

      this.currentSheet = clamp(targetSheet, 0, this.sheetCount);
      this.clearTurnCanvas();
      this.applyLandscapeStack();
      this.ensureAroundPage(normalized, 7);
    }

    animateProgrammatic(direction) {
      if (!this.canFlip(direction) || this.animating) return;
      const rect = this.stage.getBoundingClientRect();
      const g = this.getTurnGeometry();
      const globalX = direction === 'forward' ? rect.right - 3 : rect.left + 3;
      const globalY = rect.top + g.height * .13;
      this.prepareTurn(direction, globalX, globalY, false, 0);
      const start = { x: g.pageWidth - 2, y: g.height * .13 };
      this.renderFlexibleTurn(start);
      this.finishTurn(direction, true, start);
    }

    renderPortrait(page, options = {}) {
      const current = clamp(Number(page), 1, this.config.pageCount);
      const next = Math.min(this.config.pageCount, current + 1);
      this.setImage(this.portraitFront, current);
      this.setImage(this.portraitBack, next);
      this.setImage(this.portraitUnderlay, next);
      this.portraitSheet.style.transform = 'none';
      if (!options.keepTurnCanvas) this.clearTurnCanvas();
      this.ensureAroundPage(current, 5);
    }

    setImage(element, page) {
      const safe = clamp(Number(page), 1, this.config.pageCount);
      const src = this.config.imagePath(safe);
      if (element.getAttribute('src') !== src) element.setAttribute('src', src);
      element.alt = `Página ${safe}`;
      element.dataset.page = String(safe);
    }

    next() {
      this.animateProgrammatic('forward');
    }

    prev() {
      this.animateProgrammatic('backward');
    }

    goTo(page, animate = false, source = 'jump') {
      const normalized = this.state.clamp(page);
      if (this.mode === 'landscape') this.setLandscapePage(normalized, animate);
      else this.renderPortrait(normalized);
      this.state.setPage(normalized, source);
    }

    getVisibleLabel() {
      if (this.mode === 'portrait') return `${this.state.currentPage} / ${this.config.pageCount}`;
      if (this.currentSheet === 0) return `1 / ${this.config.pageCount}`;
      if (this.currentSheet >= this.sheetCount) return `${this.config.pageCount} / ${this.config.pageCount}`;
      const left = this.currentSheet * 2;
      const right = Math.min(this.config.pageCount, left + 1);
      return `${left}–${right} / ${this.config.pageCount}`;
    }
  }

  root.PageTurnEngine = PageTurnEngine;
}());
