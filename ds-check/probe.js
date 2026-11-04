// Mätningen som check.mjs kör inne i varje sida (Runtime.evaluate). Ett uttryck
// som returnerar ett Promise med { overflow, wraps, contrast, taps }.
//
// Reglerna är designsystemets (README.md):
//   - gränssnittstext bryts aldrig till två rader; löptext (stycken, numrerade
//     instruktioner, citat …) får brytas
//   - kontrast minst 4,5:1 (stor text 3:1, som i WCAG)
//   - allt tryckbart minst --tap (44 px)
//   - inget får spilla över skärmens bredd
//
// Löptext är det som står i LOPTEXT nedan. En app som har löptext i något annat
// element märker det med data-lopetext.
//
// Bygger på hjärnsläpps design/_shell.js (kontrast och träffytor), men mäter
// appens riktiga sidor i stället för förhandsvisningar.
(async () => {
  const LOPTEXT = 'p, ol, blockquote, pre, textarea, figcaption, [data-lopetext], .prose, .lopetext';
  const TAPPABLE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role="button"], [role="menuitem"], [role="tab"]';

  // Vila: vänta ut övergångar (body tonar färg i 250 ms i flera appar) så att
  // färgerna inte läses mitt i en toning.
  const anims = document.getAnimations ? document.getAnimations() : [];
  await Promise.race([
    Promise.all(anims.map(a => a.finished.catch(() => {}))),
    new Promise(r => setTimeout(r, 1500)),
  ]);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Beräknade färger kan vara rgb(), color(srgb …), oklab(…) — color-mix() i
  // tokens ger de senare. Canvasen gör om vad som helst till sRGB 0–255.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const rgba = s => {
    if (!s || s === 'transparent') return null;
    if (cache.has(s)) return cache.get(s);
    const m = s.match(/^rgba?\(([^)]+)\)$/);
    let out;
    if (m) {
      const n = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      out = [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
    } else {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000'; cx.fillStyle = s;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      out = d[3] ? [d[0], d[1], d[2], d[3] / 255] : null;
    }
    cache.set(s, out);
    return out;
  };
  const over = (src, dst) => {
    const a = src[3] + dst[3] * (1 - src[3]);
    if (!a) return [0, 0, 0, 0];
    return [0, 1, 2].map(i => (src[i] * src[3] + dst[i] * dst[3] * (1 - src[3])) / a).concat(a);
  };
  const lum = ([r, g, b]) => {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  // Det som syns bakom en genomskinlig sida: ds-check.json kan ange sidans
  // "background" (t.ex. en sida som visas i en ram), annars webbläsarens
  // canvasfärg för det färgschema sidan visas i (vit, eller #121212 i mörkt).
  const canvas = (() => {
    const given = window.__DS_CHECK_BG ? rgba(window.__DS_CHECK_BG) : null;
    if (given && given[3]) return [given[0], given[1], given[2], 1];
    const cs = getComputedStyle(document.documentElement).colorScheme || '';
    const dark = /dark/.test(cs) && matchMedia('(prefers-color-scheme: dark)').matches
      && !(/light/.test(cs) && !/dark/.test(cs));
    return dark ? [18, 18, 18, 1] : [255, 255, 255, 1];
  })();
  const effectiveBg = el => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (!c || !c[3]) continue;
      stack.push(c);
      if (c[3] === 1) break;
    }
    let bg = canvas;
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return bg;
  };
  const opacity = el => {
    let o = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) o *= Number(getComputedStyle(n).opacity || 1);
    return o;
  };
  const label = el => {
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
  };
  const visible = el => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const text = s => s.replace(/\s+/g, ' ').trim().slice(0, 40);
  const isEmoji = s => /^[\p{Extended_Pictographic}\u{FE0F}\s]+$/u.test(s);

  // --tap ur temat som visas.
  const tap = (() => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap'));
    return v > 0 ? v : 44;
  })();

  const overflow = Math.max(0, Math.round(document.documentElement.scrollWidth - window.innerWidth));
  const wraps = [], contrast = [], taps = [];
  const seen = new Set();

  // Text: varje textnod för sig, så att ett element med flera rader barn inte
  // räknas som en text på två rader.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue;
    if (!s || !s.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('script, style, noscript, template, svg, [aria-hidden="true"], .sr-only')) continue;
    if (!visible(el)) continue;
    const st = getComputedStyle(el);

    // Två rader: radrutornas överkanter.
    if (!el.closest(LOPTEXT)) {
      const range = document.createRange();
      range.selectNodeContents(n);
      const lh = parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.2;
      const tops = [];
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;
        if (!tops.some(t => Math.abs(t - r.top) < lh / 2)) tops.push(r.top);
      }
      if (tops.length > 1) {
        const k = 'w' + label(el) + text(s);
        if (!seen.has(k)) { seen.add(k); wraps.push({ el: label(el), text: text(s), lines: tops.length }); }
      }
    }

    // Kontrast. Inaktiverade kontroller är undantagna, som i WCAG.
    if (!isEmoji(s) && !el.closest(':disabled, [aria-disabled="true"]')) {
      const fg0 = rgba(st.color);
      if (fg0) {
        const bg = effectiveBg(el);
        const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * opacity(el)], bg);
        const size = parseFloat(st.fontSize), weight = Number(st.fontWeight) || 400;
        const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
        const r = ratio(fg, bg);
        const k = 'c' + label(el) + text(s);
        if (r < need && !seen.has(k)) {
          seen.add(k);
          contrast.push({ el: label(el), text: text(s), size: Math.round(size), ratio: Math.round(r * 100) / 100, need });
        }
      }
    }
  }

  // Träffytan: elementets egen ruta, utökad med ett absolut placerat
  // ::after/::before (designsystemet 0.2.2 ger små kontroller en osynlig
  // träffyta på --tap så). Pseudoelementets top/right/bottom/left räknas från
  // elementets kantlinje (padding-boxen), som för position: absolute.
  const hitBox = el => {
    const r = el.getBoundingClientRect();
    let L = r.left, T = r.top, R = r.right, B = r.bottom;
    const es = getComputedStyle(el);
    const bl = parseFloat(es.borderLeftWidth) || 0, bt = parseFloat(es.borderTopWidth) || 0;
    const br = parseFloat(es.borderRightWidth) || 0, bb = parseFloat(es.borderBottomWidth) || 0;
    for (const pseudo of ['::after', '::before']) {
      const ps = getComputedStyle(el, pseudo);
      if (!ps.content || ps.content === 'none' || ps.content === 'normal') continue;
      if (ps.position !== 'absolute' || ps.display === 'none' || ps.pointerEvents === 'none') continue;
      const px = v => (v === 'auto' ? null : parseFloat(v));
      const pl = r.left + bl, pt = r.top + bt, pr = r.right - br, pb = r.bottom - bb;
      let l = px(ps.left), t = px(ps.top), rr = px(ps.right), b = px(ps.bottom);
      const w = parseFloat(ps.width), h = parseFloat(ps.height);
      let x0 = l != null ? pl + l : (rr != null && w ? pr - rr - w : null);
      let x1 = rr != null ? pr - rr : (l != null && w ? pl + l + w : null);
      let y0 = t != null ? pt + t : (b != null && h ? pb - b - h : null);
      let y1 = b != null ? pb - b : (t != null && h ? pt + t + h : null);
      if ([x0, x1, y0, y1].some(v => v == null || !isFinite(v))) continue;
      L = Math.min(L, x0); T = Math.min(T, y0); R = Math.max(R, x1); B = Math.max(B, y1);
    }
    return { width: R - L, height: B - T };
  };

  // Träffytor. En kontroll inuti en större tryckbar yta (en rad som är en
  // länk, en etikett runt en kryssruta) täcks av den, och länkar i löptext är
  // undantagna som i WCAG.
  for (const el of document.querySelectorAll(TAPPABLE)) {
    if (!visible(el) || el.disabled) continue;
    if (el.matches('a') && el.closest(LOPTEXT)) continue;
    const r = hitBox(el);
    if (Math.min(r.width, r.height) >= tap - 0.5) continue;
    let covered = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.matches(TAPPABLE + ', label')) {
        const q = hitBox(p);
        if (Math.min(q.width, q.height) >= tap - 0.5) { covered = true; break; }
      }
    }
    if (covered) continue;
    const k = 't' + label(el) + text(el.textContent || el.getAttribute('aria-label') || '');
    if (seen.has(k)) continue;
    seen.add(k);
    taps.push({ el: label(el), text: text(el.textContent || el.getAttribute('aria-label') || el.value || ''), w: Math.round(r.width), h: Math.round(r.height) });
  }

  return JSON.stringify({ overflow, wraps, contrast, taps, tap });
})()
