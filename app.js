/* Business Card — drawn on canvas in millimetres at 300 DPI; QR matrix from qrcode.js (Kazuhiko Arase, MIT). Nothing is uploaded. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

  var DPI = 300, MM_IN = 25.4;
  var SIZES = { eu: { w: 85, h: 55, label: "85 × 55 mm" }, us: { w: 88.9, h: 50.8, label: "3.5 × 2 in" } };
  var PAPER = { A4: [210, 297], Letter: [215.9, 279.4] };
  var THEMES = [
    { name: "Teal", accent: "#0e9f9a", paper: "#ffffff", ink: "#16191e" },
    { name: "Navy & gold", accent: "#c9a227", paper: "#14213d", ink: "#f4f1e8" },
    { name: "Charcoal", accent: "#e2604a", paper: "#ffffff", ink: "#1f2329" },
    { name: "Forest", accent: "#2f7d4f", paper: "#f6f3ea", ink: "#1d2a22" },
    { name: "Violet", accent: "#6650c8", paper: "#ffffff", ink: "#1b1830" },
    { name: "Mono", accent: "#111111", paper: "#ffffff", ink: "#111111" }
  ];
  var FONT = "Inter, 'Segoe UI', Tahoma, 'Noto Sans Arabic', 'Geeza Pro', Arial, sans-serif";

  // ---------- pure helpers (tested) ----------
  function px(mm) { return Math.round(mm / MM_IN * DPI); }
  function vesc(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1"); }
  function vcard(d) {
    var fn = (d.name || d.nameAr || "").trim();
    var parts = fn.split(/\s+/).filter(Boolean), family = parts.length > 1 ? parts.pop() : "", given = parts.join(" ");
    var L = ["BEGIN:VCARD", "VERSION:3.0", "N:" + vesc(family) + ";" + vesc(given) + ";;;", "FN:" + vesc(fn)];
    if (d.company || d.companyAr) L.push("ORG:" + vesc(d.company || d.companyAr));
    if (d.title || d.titleAr) L.push("TITLE:" + vesc(d.title || d.titleAr));
    if (d.phone) L.push("TEL;TYPE=CELL:" + vesc(d.phone));
    if (d.email) L.push("EMAIL;TYPE=INTERNET:" + vesc(d.email));
    if (d.website) L.push("URL:" + String(d.website).replace(/\s+/g, ""));
    if (d.address || d.addressAr) L.push("ADR;TYPE=WORK:;;" + vesc(d.address || d.addressAr) + ";;;;");
    L.push("END:VCARD");
    return L.join("\r\n");
  }
  function makeQR(text) { var q = qrcode(0, "M"); q.addData(text, "Byte"); q.make(); return q; }

  // Cards per sheet, centred, with an 8 mm minimum margin left for crop marks.
  function sheetLayout(paper, size, gap) {
    var P = PAPER[paper] || PAPER.A4, S = SIZES[size] || SIZES.eu, W = P[0], H = P[1], m = 8;
    var cols = Math.max(1, Math.floor((W - 2 * m + gap) / (S.w + gap))), rows = Math.max(1, Math.floor((H - 2 * m + gap) / (S.h + gap)));
    var gw = cols * S.w + (cols - 1) * gap, gh = rows * S.h + (rows - 1) * gap;
    var x0 = (W - gw) / 2, y0 = (H - gh) / 2, pos = [], xs = [], ys = [], r, c;
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) pos.push({ x: x0 + c * (S.w + gap), y: y0 + r * (S.h + gap) });
    for (c = 0; c < cols; c++) { xs.push(x0 + c * (S.w + gap)); xs.push(x0 + c * (S.w + gap) + S.w); }
    for (r = 0; r < rows; r++) { ys.push(y0 + r * (S.h + gap)); ys.push(y0 + r * (S.h + gap) + S.h); }
    function uniq(a) { return a.map(function (v) { return Math.round(v * 1000) / 1000; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }); }
    return { W: W, H: H, w: S.w, h: S.h, cols: cols, rows: rows, n: cols * rows, x0: x0, y0: y0, pos: pos, xs: uniq(xs), ys: uniq(ys) };
  }

  // Insert a pHYs chunk so image apps read the PNG as 300 DPI.
  function withDPI(bytes, dpi) {
    var ppm = Math.round(dpi / 0.0254), out = [bytes.subarray(0, 8)], p = 8, done = false;
    var chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
    dv.setUint32(17, S3.crc32(chunk.subarray(4, 17)));
    while (p < bytes.length) {
      var len = new DataView(bytes.buffer, bytes.byteOffset + p, 4).getUint32(0), type = String.fromCharCode.apply(null, bytes.subarray(p + 4, p + 8));
      var end = p + 12 + len;
      if (type !== "pHYs") out.push(bytes.subarray(p, end));
      if (type === "IHDR" && !done) { out.push(chunk); done = true; }
      p = end;
    }
    var total = out.reduce(function (s, a) { return s + a.length; }, 0), res = new Uint8Array(total), o = 0;
    out.forEach(function (a) { res.set(a, o); o += a.length; });
    return res;
  }
  function readDPI(bytes) {
    for (var p = 8; p < bytes.length;) {
      var dv = new DataView(bytes.buffer, bytes.byteOffset + p), len = dv.getUint32(0), type = String.fromCharCode.apply(null, bytes.subarray(p + 4, p + 8));
      if (type === "pHYs") return dv.getUint32(8);
      p += 12 + len;
    }
    return 0;
  }

  // ---------- colour ----------
  function rgb(hex) { var n = parseInt(String(hex).slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function lum(hex) { var c = rgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function onColor(hex) { return lum(hex) > 0.45 ? "#14171b" : "#ffffff"; }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return "rgb(" + x.map(function (v, i) { return Math.round(v + (y[i] - v) * t); }).join(",") + ")"; }

  // ---------- drawing (all coordinates in mm) ----------
  function isRtl(s) { return /[\u0590-\u08ff]/.test(s || ""); }
  function txt(ctx, s, x, y, o) {
    if (!s) return 0;
    var size = o.size, w;
    ctx.direction = isRtl(s) || o.rtl ? "rtl" : "ltr";
    do { ctx.font = (o.weight || 400) + " " + size + "px " + FONT; w = ctx.measureText(s).width; if (!o.maxW || w <= o.maxW) break; size *= 0.94; } while (size > o.size * 0.6);
    if (o.maxW && w > o.maxW) { while (s.length > 1 && ctx.measureText(s + "…").width > o.maxW) s = s.slice(0, -1); s += "…"; w = ctx.measureText(s).width; }
    ctx.fillStyle = o.color; ctx.textAlign = o.align || "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y);
    ctx.direction = "ltr";
    return w;
  }
  function icon(ctx, kind, cx, cy, s, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = s * 0.13; ctx.lineCap = "round"; ctx.lineJoin = "round";
    var r = s / 2;
    ctx.beginPath();
    if (kind === "phone") { rr(ctx, cx - r * 0.55, cy - r, r * 1.1, r * 2, r * 0.25); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - r * 0.18, cy + r * 0.68); ctx.lineTo(cx + r * 0.18, cy + r * 0.68); ctx.stroke(); }
    else if (kind === "mail") { ctx.rect(cx - r, cy - r * 0.68, 2 * r, r * 1.36); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - r, cy - r * 0.68); ctx.lineTo(cx, cy + r * 0.1); ctx.lineTo(cx + r, cy - r * 0.68); ctx.stroke(); }
    else if (kind === "web") { ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.42, r, 0, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke(); }
    else { ctx.arc(cx, cy - r * 0.25, r * 0.62, Math.PI * 0.85, Math.PI * 2.15); ctx.lineTo(cx, cy + r); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy - r * 0.25, r * 0.2, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  function rr(ctx, x, y, w, h, r) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function logoBox(ctx, img, x, y, bw, bh, align) {
    if (!img) return null;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return null;
    var k = Math.min(bw / iw, bh / ih), w = iw * k, h = ih * k;
    var dx = align === "center" ? x + (bw - w) / 2 : align === "right" ? x + bw - w : x;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, dx, y + (bh - h) / 2, w, h);
    return { w: w, h: h };
  }
  function qrDraw(ctx, q, x, y, s, ink) {
    var n = q.getModuleCount(), cell = s / (n + 4);
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); rr(ctx, x, y, s, s, cell * 1.5); ctx.fill();
    ctx.fillStyle = lum(ink) < 0.3 ? ink : "#000000"; ctx.beginPath();
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) ctx.rect(x + (c + 2) * cell, y + (r + 2) * cell, cell + 0.01, cell + 0.01);
    ctx.fill();
  }

  // d = fields for this side (already Arabic or English), o = {W,H,tpl,accent,paper,ink,logo,qr,rtl}
  function drawFront(ctx, d, o) {
    var W = o.W, H = o.H, rtl = o.rtl, pad = 6, ink2 = mix(o.ink, o.paper, 0.38);
    function X(x) { return rtl ? W - x : x; }
    function A(a) { return !rtl ? a : a === "left" ? "right" : a === "right" ? "left" : a; }
    var contacts = [["phone", d.phone], ["mail", d.email], ["web", d.website], ["pin", d.address]].filter(function (c) { return c[1]; });
    ctx.fillStyle = o.paper; ctx.fillRect(0, 0, W, H);
    var qs = o.qr ? 17 : 0, t = o.tpl;
    function contactList(x0, yTop, step, maxW, align) {
      contacts.forEach(function (c, i) {
        var y = yTop + i * step;
        if (align === "right") {
          var w = txt(ctx, c[1], X(x0), y, { size: 2.35, color: o.ink, align: A("right"), maxW: maxW, weight: 450 });
          icon(ctx, c[0], X(x0 - w - 2.2), y - 0.8, 2.1, o.accent);
        } else {
          icon(ctx, c[0], X(x0 + 1.05), y - 0.8, 2.1, o.accent);
          txt(ctx, c[1], X(x0 + 3.4), y, { size: 2.35, color: o.ink, align: A("left"), maxW: maxW - 3.4, weight: 450 });
        }
      });
    }
    if (t === "band") {
      var bw = W * 0.36, bx = rtl ? W - bw : 0, on = onColor(o.accent);
      ctx.fillStyle = o.accent; ctx.fillRect(bx, 0, bw, H);
      var lb = logoBox(ctx, o.logo, bx + 5, H * 0.22, bw - 10, H * 0.38, "center");
      if (!lb && d.company) txt(ctx, d.company, bx + bw / 2, H / 2 + 1.2, { size: 3.6, weight: 750, color: on, align: "center", maxW: bw - 7 });
      else if (lb && d.company) txt(ctx, d.company, bx + bw / 2, H * 0.22 + H * 0.38 + 5, { size: 2.4, weight: 650, color: on, align: "center", maxW: bw - 7 });
      var x0 = bw + 5, mw = W - x0 - pad;
      txt(ctx, d.name, X(x0), 15, { size: 4.6, weight: 750, color: o.ink, align: A("left"), maxW: mw });
      txt(ctx, d.title, X(x0), 19.6, { size: 2.6, weight: 500, color: ink2, align: A("left"), maxW: mw });
      ctx.fillStyle = o.accent; ctx.fillRect(rtl ? W - x0 - 9 : x0, 22.6, 9, 0.6);
      if (qs) qrDraw(ctx, o.qr, rtl ? pad : W - pad - qs, H - pad - qs, qs, o.ink);
      contactList(x0, 29.5, 4, mw - (qs ? qs + 2 : 0), "left");
    } else if (t === "centered") {
      var lc = logoBox(ctx, o.logo, W / 2 - 14, 5.5, 28, 10, "center"), ny = lc ? 27 : 22;
      txt(ctx, d.name, W / 2, ny, { size: 4.8, weight: 750, color: o.ink, align: "center", maxW: W - 14 });
      txt(ctx, [d.title, d.company].filter(Boolean).join("  ·  "), W / 2, ny + 4.6, { size: 2.6, weight: 500, color: ink2, align: "center", maxW: W - 14, rtl: rtl });
      ctx.fillStyle = o.accent; ctx.fillRect(W / 2 - 5, ny + 7.2, 10, 0.6);
      var row1 = [d.phone, d.email].filter(Boolean).join("   ·   "), row2 = [d.website, d.address].filter(Boolean).join("   ·   ");
      var cw = W - 12 - (qs ? 2 * (qs + 1) : 0);
      txt(ctx, row1, W / 2, H - (row2 ? 9.2 : 6), { size: 2.3, color: o.ink, align: "center", maxW: cw, weight: 450 });
      txt(ctx, row2, W / 2, H - 6, { size: 2.3, color: o.ink, align: "center", maxW: cw, weight: 450, rtl: rtl && isRtl(d.address) });
      ctx.fillStyle = o.accent; ctx.fillRect(0, H - 1.6, W, 1.6);
      if (qs) qrDraw(ctx, o.qr, rtl ? 4 : W - 4 - 13, H - 4 - 13 - 1.6, 13, o.ink);
    } else if (t === "minimal") {
      ctx.fillStyle = o.accent; ctx.fillRect(0, 0, W, 1.2);
      var mwN = W - 2 * pad - (qs ? qs + 3 : 0);
      txt(ctx, d.name, X(pad), 13, { size: 5.1, weight: 750, color: o.ink, align: A("left"), maxW: mwN });
      txt(ctx, d.title, X(pad), 17.6, { size: 2.6, weight: 500, color: ink2, align: A("left"), maxW: mwN });
      txt(ctx, d.company, X(pad), 21.4, { size: 2.6, weight: 700, color: o.accent, align: A("left"), maxW: mwN });
      if (qs) qrDraw(ctx, o.qr, rtl ? pad : W - pad - qs, 5, qs, o.ink);
      logoBox(ctx, o.logo, rtl ? W - pad - 22 : pad, H - pad - 9, 22, 9, rtl ? "right" : "left");
      contactList(W - pad, H - pad - (contacts.length - 1) * 3.6, 3.6, W * 0.62, "right");
    } else { // classic
      ctx.fillStyle = o.accent; ctx.fillRect(rtl ? 0 : W - 2.2, 0, 2.2, H);
      var ll = logoBox(ctx, o.logo, rtl ? W - pad - 30 : pad, pad - 0.5, 30, 11, rtl ? "right" : "left");
      var mw2 = W - 2 * pad - 2.2;
      if (!ll) txt(ctx, d.company, X(pad), pad + 4, { size: 3.1, weight: 750, color: o.accent, align: A("left"), maxW: mw2 });
      var top = contacts.length > 3 ? 21 : 24;
      txt(ctx, d.name, X(pad), top, { size: 4.8, weight: 750, color: o.ink, align: A("left"), maxW: mw2 });
      txt(ctx, d.title, X(pad), top + 4.4, { size: 2.6, weight: 500, color: ink2, align: A("left"), maxW: mw2 });
      if (ll && d.company) txt(ctx, d.company, X(pad), top + 8, { size: 2.5, weight: 700, color: o.accent, align: A("left"), maxW: mw2 });
      if (qs) qrDraw(ctx, o.qr, rtl ? pad + 2.2 : W - pad - 2.2 - qs, H - pad - qs, qs, o.ink);
      contactList(pad, H - pad - (contacts.length - 1) * 3.5, 3.5, mw2 - (qs ? qs + 2 : 0), "left");
    }
  }
  function drawBack(ctx, d, o) {
    var W = o.W, H = o.H;
    if (o.back === "logo") {
      var on = onColor(o.accent);
      ctx.fillStyle = o.accent; ctx.fillRect(0, 0, W, H);
      var lb = logoBox(ctx, o.logo, W * 0.2, H * 0.2, W * 0.6, H * (d.tagline ? 0.42 : 0.5), "center");
      var y = lb ? H * 0.2 + H * (d.tagline ? 0.42 : 0.5) + 6 : H / 2 + (d.tagline ? -1 : 1.5);
      if (!lb) txt(ctx, d.company || d.name, W / 2, y, { size: 5, weight: 800, color: on, align: "center", maxW: W - 14 });
      if (d.tagline) txt(ctx, d.tagline, W / 2, lb ? y : y + 6, { size: 2.6, weight: 500, color: on, align: "center", maxW: W - 14 });
      if (d.website) txt(ctx, d.website, W / 2, H - 5, { size: 2.2, weight: 600, color: on, align: "center", maxW: W - 14 });
    } else if (o.back === "qr") {
      ctx.fillStyle = o.paper; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = o.accent; ctx.fillRect(0, H - 1.6, W, 1.6);
      var s = H * 0.6;
      if (o.qr) qrDraw(ctx, o.qr, (W - s) / 2, 5, s, o.ink);
      txt(ctx, o.qr ? "Scan to save my contact" : "Add your name to make the QR", W / 2, 5 + s + 5.4, { size: 2.6, weight: 650, color: o.ink, align: "center", maxW: W - 12 });
      if (d.tagline) txt(ctx, d.tagline, W / 2, 5 + s + 9.4, { size: 2.2, weight: 450, color: mix(o.ink, o.paper, 0.38), align: "center", maxW: W - 12 });
    } else if (o.back === "arabic") {
      drawFront(ctx, d, Object.assign({}, o, { rtl: true }));
    } else { ctx.fillStyle = o.paper; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- state ----------
  var FIELDS = ["name", "title", "company", "phone", "email", "website", "address", "tagline", "nameAr", "titleAr", "companyAr", "addressAr"];
  var DEF = { tpl: "classic", back: "logo", size: "eu", accent: THEMES[0].accent, paper: THEMES[0].paper, ink: THEMES[0].ink, qrFront: false,
    sheetPaper: "A4", gap: 0, printWhat: "front", logo: null };
  FIELDS.forEach(function (k) { DEF[k] = ""; });
  var st = Object.assign({}, DEF, S3.store("bc.settings") || {}), logoImg = null, qr = null;
  function persist() { var copy = Object.assign({}, st); if (copy.logo && copy.logo.length > 600000) copy.logo = null; S3.store("bc.settings", copy); }

  function sideData(ar) {
    if (!ar) return { name: st.name, title: st.title, company: st.company, phone: st.phone, email: st.email, website: st.website, address: st.address, tagline: st.tagline };
    return { name: st.nameAr || st.name, title: st.titleAr || st.title, company: st.companyAr || st.company, phone: st.phone, email: st.email, website: st.website, address: st.addressAr || st.address, tagline: st.tagline };
  }
  function opts(rtl) { var S = SIZES[st.size]; return { W: S.w, H: S.h, tpl: st.tpl, accent: st.accent, paper: st.paper, ink: st.ink, logo: logoImg, rtl: !!rtl, back: st.back }; }
  function renderSide(canvas, side) {
    var S = SIZES[st.size], k = DPI / MM_IN;
    canvas.width = px(S.w); canvas.height = px(S.h);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(canvas.width / S.w, 0, 0, canvas.height / S.h, 0, 0);
    if (side === "front") drawFront(ctx, sideData(false), Object.assign(opts(false), { qr: st.qrFront ? qr : null }));
    else drawBack(ctx, sideData(st.back === "arabic"), Object.assign(opts(false), { qr: st.back === "arabic" ? (st.qrFront ? qr : null) : qr }));
    return k;
  }

  var status = $("#status");
  function render() {
    persist();
    var v = vcard(st);
    qr = null;
    if (st.name || st.nameAr) { try { qr = makeQR(v); } catch (e) { qr = null; } }
    renderSide($("#front"), "front");
    renderSide($("#back"), "back");
    $("#backFig").hidden = st.back === "none";
    $("#pngBack").disabled = st.back === "none";
    var S = SIZES[st.size];
    $("#pxInfo").textContent = "PNG: " + px(S.w) + " × " + px(S.h) + " px at 300 DPI (" + S.label + ").";
    var L = sheetLayout(st.sheetPaper, st.size, +st.gap);
    $("#sheetInfo").textContent = L.n + " cards per " + st.sheetPaper + " sheet (" + L.cols + " × " + L.rows + "), with crop marks. Print at 100% / “Actual size”.";
    if (!st.name && !st.nameAr) { status.className = "chip"; status.textContent = "Add your name"; }
    else if ((st.qrFront || st.back === "qr") && !qr) { status.className = "chip warn"; status.textContent = "Too much text for the QR"; }
    else if (st.back === "arabic" && !st.nameAr) { status.className = "chip warn"; status.textContent = "Arabic name is empty"; }
    else { status.className = "chip ok"; status.textContent = "Ready"; }
  }
  var queue = S3.debounce(render, 90);

  function seg(el, value, onPick) {
    $$("button", el).forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === String(value)));
      b.addEventListener("click", function () { $$("button", el).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); onPick(b.dataset.v); });
    });
  }
  FIELDS.forEach(function (k) { $("#" + k).value = st[k]; $("#" + k).addEventListener("input", function () { st[k] = this.value; queue(); }); });
  [["backMode", "back"], ["size", "size"], ["sheetPaper", "sheetPaper"], ["gap", "gap"]].forEach(function (p) {
    $("#" + p[0]).value = String(st[p[1]]); $("#" + p[0]).addEventListener("change", function () { st[p[1]] = this.value; render(); });
  });
  ["accent", "paper", "ink"].forEach(function (k) { $("#" + k).value = st[k]; $("#" + k).addEventListener("input", function () { st[k] = this.value; markTheme(); queue(); }); });
  $("#qrFront").checked = st.qrFront;
  $("#qrFront").addEventListener("change", function () { st.qrFront = this.checked; render(); });
  seg($("#tpl"), st.tpl, function (v) { st.tpl = v; render(); });
  seg($("#printWhat"), st.printWhat, function (v) { st.printWhat = v; persist(); });
  THEMES.forEach(function (t, i) {
    var b = S3.h("button", { "class": "bc-sw", type: "button", title: t.name, "aria-label": t.name, "data-i": i, style: "--a:" + t.accent + ";--p:" + t.paper });
    b.addEventListener("click", function () { st.accent = t.accent; st.paper = t.paper; st.ink = t.ink; ["accent", "paper", "ink"].forEach(function (k) { $("#" + k).value = st[k]; }); markTheme(); render(); });
    $("#themes").appendChild(b);
  });
  function markTheme() { $$(".bc-sw").forEach(function (b) { var t = THEMES[+b.dataset.i]; b.setAttribute("aria-pressed", String(t.accent === st.accent && t.paper === st.paper && t.ink === st.ink)); }); }
  markTheme();

  // logo
  function setLogo(url) {
    if (!url) { logoImg = null; st.logo = null; $("#logoImg").hidden = true; $("#logoHint").hidden = false; $("#logoClear").hidden = true; render(); return; }
    var im = new Image();
    im.onload = function () { logoImg = im; st.logo = url; $("#logoImg").src = url; $("#logoImg").hidden = false; $("#logoHint").hidden = true; $("#logoClear").hidden = false; render(); };
    im.onerror = function () { S3.toast("Couldn't read that image", "error"); };
    im.src = url;
  }
  S3.drop($("#logoDrop"), function (fs) {
    if (fs[0].size > 8 * 1024 * 1024) { S3.toast("That image is over 8 MB", "error"); return; }
    S3.readFile(fs[0], "dataurl").then(setLogo);
  }, { accept: "image/*", multiple: false });
  $("#logoClear").addEventListener("click", function () { setLogo(null); });

  // exports
  function fileBase() { return ((st.name || "business-card").replace(/[^\w\u0600-\u06FF -]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "business-card"); }
  function pngBytes(canvas) {
    return new Promise(function (res, rej) { canvas.toBlob(function (b) { if (!b) return rej(new Error("PNG export failed")); b.arrayBuffer().then(function (ab) { res(withDPI(new Uint8Array(ab), DPI)); }); }, "image/png"); });
  }
  function savePNG(side) {
    if (!st.name && !st.nameAr) { S3.toast("Add your name first", "error"); $("#name").focus(); return; }
    pngBytes($("#" + side)).then(function (b) { S3.download(new Blob([b], { type: "image/png" }), fileBase() + "-" + side + ".png"); S3.done(); }, function (e) { S3.toast(e.message, "error"); });
  }
  $("#pngFront").addEventListener("click", function () { savePNG("front"); });
  $("#pngBack").addEventListener("click", function () { savePNG("back"); });
  $("#vcf").addEventListener("click", function () {
    if (!st.name && !st.nameAr) { S3.toast("Add your name first", "error"); return; }
    S3.download(vcard(st) + "\r\n", fileBase() + ".vcf", "text/vcard;charset=utf-8"); S3.done();
  });

  // print sheet: images placed in mm, crop marks as SVG in mm
  var SVGNS = "http://www.w3.org/2000/svg";
  function marks(L) {
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + L.W + " " + L.H); svg.setAttribute("class", "bc-marks");
    var top = L.y0, left = L.x0, bottom = Math.max.apply(null, L.ys), right = Math.max.apply(null, L.xs), d = "";
    L.xs.forEach(function (x) { d += "M" + x + " " + (top - 1.5) + "V" + (top - 6) + "M" + x + " " + (bottom + 1.5) + "V" + (bottom + 6); });
    L.ys.forEach(function (y) { d += "M" + (left - 1.5) + " " + y + "H" + (left - 6) + "M" + (right + 1.5) + " " + y + "H" + (right + 6); });
    var path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", d); path.setAttribute("stroke", "#000"); path.setAttribute("stroke-width", "0.2"); path.setAttribute("fill", "none");
    svg.appendChild(path);
    return svg;
  }
  function buildSheet(target, sides) {
    var L = sheetLayout(st.sheetPaper, st.size, +st.gap);
    target.textContent = "";
    sides.forEach(function (side) {
      var url = $("#" + side).toDataURL("image/png");
      var page = S3.h("div", { "class": "bc-page", style: "width:" + L.W + "mm;height:" + (L.H - 0.4) + "mm" });
      L.pos.forEach(function (p) {
        var x = side === "back" ? L.W - p.x - L.w : p.x; // mirrored for long-edge duplex
        page.appendChild(S3.h("img", { src: url, alt: "", style: "left:" + x + "mm;top:" + p.y + "mm;width:" + L.w + "mm;height:" + L.h + "mm" }));
      });
      page.appendChild(marks(L));
      target.appendChild(page);
    });
    return L;
  }
  var pageStyle = document.head.appendChild(S3.h("style", { id: "bcPage" }));
  function prepPrint() {
    var sides = st.printWhat === "both" ? ["front", "back"] : [st.printWhat];
    if (st.back === "none") sides = ["front"];
    pageStyle.textContent = "@page { size: " + (st.sheetPaper === "Letter" ? "letter" : "A4") + " portrait; margin: 0; }";
    return buildSheet($("#sheet"), sides);
  }
  $("#print").addEventListener("click", function () {
    if (!st.name && !st.nameAr) { S3.toast("Add your name first", "error"); $("#name").focus(); return; }
    render(); prepPrint();
    Promise.all($$("#sheet img").map(function (im) { return im.decode ? im.decode().catch(function () {}) : null; })).then(function () { window.print(); S3.done(); });
  });
  window.__bcPrep = prepPrint; // used by the print test

  if (st.logo) setLogo(st.logo);
  if (document.fonts && document.fonts.load) document.fonts.load("700 40px Inter").then(render, render);
  render();

  // ---------- demo + self-test ----------
  function demoLogo() {
    var c = document.createElement("canvas"); c.width = 360; c.height = 120;
    var x = c.getContext("2d");
    x.fillStyle = "#0e9f9a"; x.beginPath(); x.ellipse(60, 60, 54, 34, 0, 0, 7); x.fill();
    x.fillStyle = "#fff"; x.beginPath(); x.arc(60, 60, 20, 0, 7); x.fill();
    x.fillStyle = "#0b3b3a"; x.beginPath(); x.arc(60, 60, 10, 0, 7); x.fill();
    x.fillStyle = "#16191e"; x.font = "800 52px Inter, sans-serif"; x.textBaseline = "middle"; x.fillText("Lumen", 132, 64);
    return c.toDataURL("image/png");
  }
  window.S3_DEMO = function () {
    Object.assign(st, { name: "Lina Haddad", title: "Optometrist", company: "Lumen Eye Clinic", phone: "+962 79 000 0000", email: "lina@lumen.example",
      website: "lumen.example", address: "Amman, Jordan", tagline: "Clear vision for the whole family", nameAr: "لينا حداد", titleAr: "أخصائية بصريات",
      companyAr: "عيادة لومن للعيون", addressAr: "عمّان، الأردن", tpl: "classic", back: "qr", accent: THEMES[0].accent, paper: THEMES[0].paper, ink: THEMES[0].ink });
    FIELDS.forEach(function (k) { $("#" + k).value = st[k]; });
    ["accent", "paper", "ink"].forEach(function (k) { $("#" + k).value = st[k]; });
    $("#backMode").value = "qr";
    $$("#tpl button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === "classic")); });
    markTheme();
    return new Promise(function (res) { setLogo(demoLogo()); setTimeout(res, 150); });
  };

  window.S3_SELFTEST = async function () {
    var sizes = px(85) === 1004 && px(55) === 650 && px(88.9) === 1050 && px(50.8) === 600;
    var A = sheetLayout("A4", "eu", 0), U = sheetLayout("Letter", "us", 0), G = sheetLayout("A4", "eu", 4);
    function near(a, b) { return Math.abs(a - b) < 1e-9; }
    var grid = A.n === 10 && A.cols === 2 && A.rows === 5 && near(A.pos[0].x, 20) && near(A.pos[0].y, 11) &&
      near(A.pos[1].x, 105) && near(A.pos[9].x, 105) && near(A.pos[9].y, 231) && A.xs.join() === "20,105,190" && A.ys.length === 6 &&
      U.n === 10 && near(U.pos[0].x, 19.05) && near(U.pos[0].y, 12.7) && G.n === 8 && G.rows === 4;
    var esc = vesc("Smith, Jr; Co\\x\nY") === "Smith\\, Jr\\; Co\\\\x\\nY";
    var v = vcard({ name: "Lina Al Haddad", company: "Acme, Inc.", title: "R&D; Lead", phone: "+962 79", email: "a@b.co", website: "b.co", address: "Street 1, Amman" });
    var vOk = v === ["BEGIN:VCARD", "VERSION:3.0", "N:Haddad;Lina Al;;;", "FN:Lina Al Haddad", "ORG:Acme\\, Inc.", "TITLE:R&D\\; Lead",
      "TEL;TYPE=CELL:+962 79", "EMAIL;TYPE=INTERNET:a@b.co", "URL:b.co", "ADR;TYPE=WORK:;;Street 1\\, Amman;;;;", "END:VCARD"].join("\r\n");
    var q = makeQR(v), n = q.getModuleCount();
    var qOk = (n - 17) % 4 === 0 && n >= 41 && q.isDark(0, 0) && q.isDark(6, 6) && !q.isDark(1, 1) && q.isDark(2, 2) && q.isDark(0, n - 1) && q.isDark(n - 1, 0);
    var qa = makeQR(vcard({ name: "لينا حداد" })).getModuleCount() >= 21;
    var wq = makeQR("WIFI:T:WPA;S:Home;P:12345678;;").getModuleCount() === 29;
    var c = document.createElement("canvas"), save = Object.assign({}, st), saveLogo = logoImg;
    Object.assign(st, { size: "eu", tpl: "classic", accent: "#e2604a", paper: "#ffffff", ink: "#111111", name: "T" }); logoImg = null;
    renderSide(c, "front");
    var pxA = c.getContext("2d").getImageData(c.width - 5, 300, 1, 1).data, pxP = c.getContext("2d").getImageData(5, 5, 1, 1).data;
    var dimOk = c.width === 1004 && c.height === 650 && pxA[0] === 0xe2 && pxA[1] === 0x60 && pxA[2] === 0x4a && pxP[0] === 255;
    var bytes = await pngBytes(c), dpi = readDPI(bytes) === 11811;
    Object.assign(st, save); logoImg = saveLogo; render();
    return sizes && grid && esc && vOk && qOk && qa && wq && dimOk && dpi;
  };
})();
