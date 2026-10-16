var APP = function (k) {
var a = CONFIG.appearance || {};
return a[k];
};

var wmError = function (msg) {
var b = document.getElementById('wm-error');
if (b) { b.style.display = 'block'; b.textContent = 'watermark error: ' + msg; }
};

var LG_WRAP_CONTENT = -1, LG_MATCH_PARENT = -2;
var LG_GRAV = { top: 1, bottom: 2, left: 4, right: 8, center_vertical: 16, center_horizontal: 32, center: 48 };
var LG_DIM_RE = /^(-?\d+\.?\d*)(dp|px|sp)$/;
var LG_W_RE = /^(\d+\.?\d*)%?[wW]$/;
var LG_H_RE = /^(\d+\.?\d*)%?[hH]$/;

var LG_GUARD_GAP_DP = 24;

var lgDim = function (spec) {
if (spec == null || spec === '') return { v: LG_WRAP_CONTENT, u: '' };
var s = String(spec).trim();
if (s === 'wrap_content') return { v: LG_WRAP_CONTENT, u: '' };
if (s === 'match_parent') return { v: LG_MATCH_PARENT, u: '' };
var m = LG_DIM_RE.exec(s);
if (m) return { v: parseFloat(m[1]), u: m[2] };
var mw = LG_W_RE.exec(s), mh = LG_H_RE.exec(s);
if (mw) return { v: parseFloat(mw[1]), u: '%w' };
if (mh) return { v: parseFloat(mh[1]), u: '%h' };
return { v: LG_WRAP_CONTENT, u: '' };
};

var lgPx = function (dim, scale, parent) {
if (dim.u === 'px' || dim.u === 'sp') return dim.v;
if (dim.u === '%w' || dim.u === '%h') return (parent || 0) * dim.v / 100.0;
return dim.v * scale;
};

var lgNum = function (spec) {
if (spec == null || spec === '') return 0;
var d = lgDim(spec);
if (d.v === LG_WRAP_CONTENT || d.v === LG_MATCH_PARENT) return 0;
return d.v;
};
var lgGrav = function (s) {
var g = 0, toks = String(s || '').split('|');
for (var i = 0; i < toks.length; i++) g |= (LG_GRAV[toks[i].trim()] || 0);
return g;
};

var lgBuild = function (nodes, pkey) {
var out = [];
for (var i = 0; i < (nodes || []).length; i++) {
var n = nodes[i], v = {
id: n.id || '', type: n.type || '', orientation: n.orientation || 'horizontal',
gravity: 0, layout_width: lgDim(n.layout_width), layout_height: lgDim(n.layout_height),
margin_left: lgNum(n.margin_left), margin_top: lgNum(n.margin_top),
padding_left: lgNum(n.padding_left), padding_top: lgNum(n.padding_top),
padding_right: lgNum(n.padding_right), padding_bottom: lgNum(n.padding_bottom),
background: n.background || null, childViews: [], text: '', font_ref: null,
optional: !!n.optional, display_width: lgDim(n.display_width), display_height: lgDim(n.display_height),
max_width: lgNum(n.max_width),
max_width_ratio: (n.max_width_ratio == null || n.max_width_ratio === '') ? 2 : parseFloat(n.max_width_ratio),
path: '', img: null, enabled: true, w: 0, h: 0, x: 0, y: 0, textMetrics: null,
_key: (pkey || '') + '#' + i
};
if (v.type === 'Layout') {
v.gravity = lgGrav(n.gravity);
v.childViews = lgBuild(n.childViews, v._key);
} else if (v.type === 'TextView') {
v.gravity = lgGrav(n.gravity);
v.text = n.text || '';
v.font_ref = n.font_ref || null;
} else if (v.type === 'ImageView') {
v.gravity = lgGrav(n.gravity);
v.path = n.path || '';
}
out.push(v);
}
return out;
};

var LG_IMG_FIT = {};
var LG_IMG_FLOOR = 0.2;

var lgSizeImage = function (v, aspect) {
var s = CONFIG.unit;
var displayHeightPixels = (v.display_height.v === LG_WRAP_CONTENT || v.display_height.v === LG_MATCH_PARENT) ? 0 : v.display_height.v * s;
var displayWidthPixels = (v.display_width.v === LG_WRAP_CONTENT || v.display_width.v === LG_MATCH_PARENT) ? 0 : v.display_width.v * s;
if (!v.img) { v.w = v.h = 0; v.enabled = false; return; }
if (displayWidthPixels > 0 && displayHeightPixels > 0) { v.w = displayWidthPixels; v.h = displayHeightPixels; }
else if (displayHeightPixels > 0) { v.w = displayHeightPixels * aspect; v.h = displayHeightPixels; }
else if (displayWidthPixels > 0) { v.w = displayWidthPixels; v.h = aspect > 0 ? displayWidthPixels / aspect : 0; }
else { v.w = v.img.w * s; v.h = v.img.h * s; }

var maxWidthDp = (v.max_width > 0) ? v.max_width : 0;
var maxWidthRatio = (v.max_width_ratio > 0) ? v.max_width_ratio : 0;
var displayHeightDp = (v.display_height && v.display_height.v !== LG_WRAP_CONTENT &&
v.display_height.v !== LG_MATCH_PARENT) ? v.display_height.v : 0;
if (maxWidthRatio > 0 && displayHeightDp > 0) {
var ratioDp = displayHeightDp * maxWidthRatio;
maxWidthDp = (maxWidthDp > 0) ? Math.min(maxWidthDp, ratioDp) : ratioDp;
}
if (maxWidthDp > 0 && v.w > maxWidthDp * s) { v.w = maxWidthDp * s; v.h = aspect > 0 ? v.w / aspect : v.h; }

var fit = LG_IMG_FIT[v._key];
if (fit > 0 && fit < 1) { v.w *= fit; v.h *= fit; }
};

var lgTextSize = function (v, sizeScale) {
var f = (CONFIG.fonts || {})[v.font_ref] || null;
if (!f) { v.w = v.h = 0; return; }
var sizePx = f['font-size'] * CONFIG.unit * (sizeScale || 1);
var lineHeight = f['line-height'] * CONFIG.unit;
v.textMetrics = { font: f, sizePx: sizePx, lineHeight: lineHeight };
var t = textOf(v);
v.textValue = t;
if (v.optional && !t) {
v.enabled = false; v.w = v.h = 0;
return;
}
var lines = String(t).split('\n');
var w = 0;
for (var i = 0; i < lines.length; i++) w = Math.max(w, lgTextWidth(lines[i], f, sizePx));
v.w = w;
v.h = lineHeight * lines.length;
};

var lgAnyText = function (v) {
if (v.type !== 'TextView') {
for (var i = 0; i < (v.childViews || []).length; i++) if (lgAnyText(v.childViews[i])) return true;
return false;
}
return !!v.textValue;
};

var _lgCtx = null;

var lgTextWidth = function (text, font, sizePx) {
if (_lgCtx == null) _lgCtx = document.createElement('canvas').getContext('2d');
var ls = parseFloat(font['letter-spacing']) || 0;
_lgCtx.font = wmFontStr(font, sizePx);
var w = _lgCtx.measureText(text).width;
return w + ls * sizePx * String(text).length;
};

var lgMeasure = function (v, pw, ph, sizeScale) {
var s = CONFIG.unit;
if (v.type === 'Layout') {
var pcw = (v.layout_width.v !== LG_WRAP_CONTENT && v.layout_width.v !== LG_MATCH_PARENT) ? lgPx(v.layout_width, s, pw) : pw;
var pch = (v.layout_height.v !== LG_WRAP_CONTENT && v.layout_height.v !== LG_MATCH_PARENT) ? lgPx(v.layout_height, s, ph) : ph;
for (var i = 0; i < v.childViews.length; i++) lgMeasure(v.childViews[i], pcw, pch, sizeScale);
if (v.optional && !lgAnyText(v)) {
v.enabled = false; v.w = v.h = 0;
return;
}
var w = 0, h = 0;
for (var j = 0; j < v.childViews.length; j++) {
var c = v.childViews[j];
if (!c.enabled) continue;
var ml = Math.max(0, c.margin_left) * s, mt = Math.max(0, c.margin_top) * s;
if (v.orientation === 'horizontal') { w += c.w + ml; h = Math.max(h, c.h + mt); }
else if (v.orientation === 'overlap') { w = Math.max(w, c.w + ml); h = Math.max(h, c.h + mt); }
else { h += c.h + mt; w = Math.max(w, c.w + ml); }
}
if (v.layout_width.v === LG_MATCH_PARENT) w = pw || w; else if (v.layout_width.v !== LG_WRAP_CONTENT) w = lgPx(v.layout_width, s, pw);
if (v.layout_height.v === LG_MATCH_PARENT) h = ph || h; else if (v.layout_height.v !== LG_WRAP_CONTENT) h = lgPx(v.layout_height, s, ph);
v.w = w + v.padding_left * s + v.padding_right * s;
v.h = h + v.padding_top * s + v.padding_bottom * s;
} else if (v.type === 'ImageView') {
lgSizeImage(v, v._aspect || 1);
} else if (v.type === 'TextView') {
lgTextSize(v, sizeScale);
}
};

var lgPlace = function (v) {
var s = CONFIG.unit;
var ox = v.padding_left * s, oy = v.padding_top * s;
var W = v.w - v.padding_left * s - v.padding_right * s, H = v.h - v.padding_top * s - v.padding_bottom * s;
var defW = (v.layout_width.v === LG_MATCH_PARENT), defH = (v.layout_height.v === LG_MATCH_PARENT);
var horiz = v.orientation === 'horizontal', cursor = 0;
for (var i = 0; i < v.childViews.length; i++) {
var c = v.childViews[i];
if (!c.enabled) continue;
var g = c.gravity, ml = c.margin_left * s, mt = c.margin_top * s;
if (v.orientation === 'overlap') {
if (g & 32) c.x = ox + (W - c.w) / 2 + ml;
else if (g & 8) c.x = ox + W - c.w + ml;
else c.x = ox + ml;
if (g & 16) c.y = oy + (H - c.h) / 2 + mt;
else if (g & 2) c.y = oy + H - c.h + mt;
else c.y = oy + mt;
} else if (horiz) {
if (defW && (g & 8)) c.x = ox + W - c.w + ml;
else if (defW && (g & 32)) c.x = ox + (W - c.w) / 2 + ml;
else { c.x = ox + cursor + ml; cursor += c.w + ml; }
if (g & 16) c.y = oy + (H - c.h) / 2 + mt;
else if (g & 2) c.y = oy + H - c.h + mt;
else c.y = oy + mt;
} else {
if (g & 32) c.x = ox + (W - c.w) / 2 + ml;
else if (g & 8) c.x = ox + W - c.w + ml;
else c.x = ox + ml;
if (defH && (g & 2)) c.y = oy + H - c.h + mt;
else if (defH && (g & 16)) c.y = oy + (H - c.h) / 2 + mt;
else { c.y = oy + cursor + mt; cursor += c.h + mt; }
}
lgPlace(c);
}
};

var lgFlatten = function (v, out, ox, oy) {
v.ax = ox + v.x; v.ay = oy + v.y;
out.push(v);
for (var i = 0; i < v.childViews.length; i++) lgFlatten(v.childViews[i], out, v.ax, v.ay);
};

var overlapFactor = function (L) {
var worst = 1, gapPx = LG_GUARD_GAP_DP * CONFIG.unit;
var walk = function (v) {
if (v.type === 'Layout' && v.orientation === 'horizontal') {
var vis = [];
for (var i = 0; i < v.childViews.length; i++) {
var c = v.childViews[i];
if (c.enabled && c.w > 1) vis.push(c);
}
for (var j = 1; j < vis.length; j++) {
var a = vis[j - 1], b = vis[j];
if (!(a.ay < b.ay + b.h - 0.5 && b.ay < a.ay + a.h - 0.5)) continue;
if (b.layout_width && b.layout_width.v === LG_MATCH_PARENT) continue;
var avail = b.ax - gapPx - a.ax;
if (avail > 0.5 && a.w > avail + 0.5) {
var f = Math.max(0.4, avail / a.w);
worst = Math.min(worst, f);

if (!window.__WM_OVERLAP) window.__WM_OVERLAP = [];
if (window.__WM_OVERLAP.length < 8) {
window.__WM_OVERLAP.push((v.id || '?') + ': ' + (a.id || '?') + '(' + a.ax.toFixed(1) + '+'
+ a.w.toFixed(1) + ',y' + a.ay.toFixed(1) + ')' + ' × ' + (b.id || '?') + '(' + b.ax.toFixed(1)
+ ',y' + b.ay.toFixed(1) + ')' + ' avail=' + avail.toFixed(1) + ' f=' + f.toFixed(3));
}
}
}
}
for (var m = 0; m < v.childViews.length; m++) walk(v.childViews[m]);
};
for (var t = 0; t < L.tree.length; t++) walk(L.tree[t]);
return worst;
};

var lgFitImages = function (L) {
var changed = false, gapPx = LG_GUARD_GAP_DP * CONFIG.unit;
var widestAutoImage = function (n, best) {
if (n.type === 'ImageView' && n.enabled && n.display_width && n.display_width.v === LG_WRAP_CONTENT &&
n.w > (best ? best.w : 0)) best = n;
for (var k = 0; k < (n.childViews || []).length; k++) best = widestAutoImage(n.childViews[k], best);
return best;
};
var walk = function (v) {
if (v.type === 'Layout' && v.orientation === 'horizontal') {
var vis = [];
for (var i = 0; i < v.childViews.length; i++) {
var c = v.childViews[i];
if (c.enabled && c.w > 1) vis.push(c);
}
for (var j = 1; j < vis.length; j++) {
var a = vis[j - 1], b = vis[j];
if (!(a.ay < b.ay + b.h - 0.5 && b.ay < a.ay + a.h - 0.5)) continue;
if (b.layout_width && b.layout_width.v === LG_MATCH_PARENT) continue;
var overflow = (a.ax + a.w + gapPx) - b.ax;
if (overflow <= 0.5) continue;
var img = widestAutoImage(b, null);
if (!img) continue;
var cur = LG_IMG_FIT[img._key] || 1;
var next = Math.max(LG_IMG_FLOOR, cur * (img.w - overflow) / img.w);
if (next < cur - 0.005) {
LG_IMG_FIT[img._key] = next; changed = true;
if (!window.__WM_IMGFIT) window.__WM_IMGFIT = [];
if (window.__WM_IMGFIT.length < 8) {
window.__WM_IMGFIT.push((img.id || '?') + ' overflow=' + overflow.toFixed(1)
+ ' → fit=' + next.toFixed(3) + ' (' + img.w.toFixed(1) + 'px→'
+ (img.w * next / cur).toFixed(1) + 'px)');
}
}
}
}
for (var m = 0; m < v.childViews.length; m++) walk(v.childViews[m]);
};
for (var t = 0; t < L.tree.length; t++) walk(L.tree[t]);
return changed;
};

var lgColorParts = function (ref) {
var s = String(ref == null ? '' : ref).trim();
if (s.charAt(0) === '@' && s.indexOf('=') > 0) s = s.slice(s.indexOf('=') + 1).trim();
if (!s) return { rgb: '', alpha: 1, argb: false };
if (s === 'transparent') return { rgb: s, alpha: 0, argb: false };
if (s.charAt(0) !== '#') return { rgb: s, alpha: 1, argb: false };
var h = s.slice(1);
if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
if (h.length === 6 && /^[0-9a-f]{6}$/i.test(h)) return { rgb: s, alpha: 1, argb: false };
if (h.length !== 8 || !/^[0-9a-f]{8}$/i.test(h)) return { rgb: s, alpha: 1, argb: false };
var a = parseInt(h.slice(0, 2), 16) / 255;
return { rgb: '#' + h.slice(2), alpha: isFinite(a) ? a : 1, argb: true };
};

var lgColorAlpha = function (ref) { return lgColorParts(ref).alpha; };

var lgCssColor = function (ref) {
var p = lgColorParts(ref);
if (!p.rgb) return '';
if (!p.argb) return p.rgb;
var r = parseInt(p.rgb.slice(1, 3), 16), g = parseInt(p.rgb.slice(3, 5), 16), b = parseInt(p.rgb.slice(5, 7), 16);
return 'rgba(' + r + ',' + g + ',' + b + ',' + (Math.round(p.alpha * 1000) / 1000) + ')';
};

var lgForegroundAlpha = function (n, style) {
var idx = parseInt(n, 10);
if (!isFinite(idx) || idx < 0) idx = 0;
var slots = (style || {})['foreground-slots'];
if (slots && idx < slots.length) {
var a = parseFloat(slots[idx]);
if (isFinite(a)) return Math.max(0, Math.min(1, a));
}
return 1;
};

var lgTextAlpha = function (ref, style) {
var s = String(ref == null ? '' : ref).trim();
if (s.indexOf('@foreground=') === 0) return lgForegroundAlpha(s.split('=')[1], style);
return lgColorAlpha(s);
};

var lgForegroundStop = function () {
var stop = parseFloat(APP('foreground-stop'));
if (!isFinite(stop)) stop = 0;
return Math.min(0.999, Math.max(0, stop / 100));
};

var lgFillAlpha = function (n, style) {
var idx = parseInt(n, 10);
if (!isFinite(idx) || idx < 0) idx = 0;
if (idx === 1) {
var lo = parseFloat(APP('line-opacity'));
if (isFinite(lo)) return Math.max(0, Math.min(1, lo));
}
return lgForegroundAlpha(idx, style);
};
var lgFillFor = function (v) {
var background = String(v.background || '');
if (background.indexOf('@foreground=') !== 0) return null;
var idx = parseInt(background.slice('@foreground='.length), 10);
return { alpha: lgFillAlpha(idx, CONFIG.appearance) };
};

var WM_LOGO_GRADIENT_ID = 'wm-fg-gradient';
var WM_LOGO_SHAPES = 'path,rect,circle,ellipse,polygon,polyline,use,line';

var wmWantsPaint = function (v) { return v == null || v === '' || v === 'currentColor'; };

var wmLogoSvgGradient = function (svg) {
var ns = 'http://www.w3.org/2000/svg';
var defs = document.createElementNS(ns, 'defs');
var g = document.createElementNS(ns, 'linearGradient');
var angle = (parseFloat(APP('foreground-direction')) - 90) * Math.PI / 180;
var dx = Math.cos(angle), dy = Math.sin(angle);
g.setAttribute('id', WM_LOGO_GRADIENT_ID);
g.setAttribute('x1', (50 - dx * 50) + '%'); g.setAttribute('y1', (50 - dy * 50) + '%');
g.setAttribute('x2', (50 + dx * 50) + '%'); g.setAttribute('y2', (50 + dy * 50) + '%');

[[APP('foreground-stop'), APP('foreground-start')], ['100%', APP('foreground-end')]]
.forEach(function (st) {
var s = document.createElementNS(ns, 'stop');

var c = lgColorParts(st[1]);
s.setAttribute('offset', st[0]);
s.setAttribute('stop-color', c.rgb);
if (c.alpha < 1) s.setAttribute('stop-opacity', String(c.alpha));
g.appendChild(s);
});
defs.appendChild(g);
svg.insertBefore(defs, svg.firstChild);
var shapes = svg.querySelectorAll(WM_LOGO_SHAPES);
for (var i = 0; i < shapes.length; i++) {
if (wmWantsPaint(shapes[i].getAttribute('fill'))) shapes[i].setAttribute('fill', 'url(#' + WM_LOGO_GRADIENT_ID + ')');

var strokeAttr = shapes[i].getAttribute('stroke');
if (strokeAttr != null && strokeAttr !== 'none' && wmWantsPaint(strokeAttr)) {
shapes[i].setAttribute('stroke', 'url(#' + WM_LOGO_GRADIENT_ID + ')');
}
}
};

var _lgLogo = { svg: null, aspect: 1 };
var lgAssets = function (root) {
var walk = function (v) {
if (v.type === 'ImageView') {
if (v.path === 'photo') {
v.enabled = false; v.img = null;
} else {
var svg = (document.getElementById('wm-logo-src') || {}).innerHTML || '';
var inner = null;
if (svg) {
var box = document.createElement('div');
box.innerHTML = svg;
inner = box.querySelector('svg');
}
if (inner) {
if (_lgLogo.svg !== svg) {
var vb = (inner.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
_lgLogo.aspect = (vb.length === 4 && vb[2] > 0 && vb[3] > 0) ? vb[2] / vb[3]
: (parseFloat(inner.getAttribute('width')) > 0 && parseFloat(inner.getAttribute('height')) > 0)
? parseFloat(inner.getAttribute('width')) / parseFloat(inner.getAttribute('height')) : 1;
_lgLogo.svg = svg;
}

v.img = { w: 1, h: 1 }; v._aspect = _lgLogo.aspect; v._svg = svg;
} else { v.img = null; v.enabled = false; }
}
}
for (var i = 0; i < v.childViews.length; i++) walk(v.childViews[i]);
};
for (var i = 0; i < root.length; i++) walk(root[i]);
};

var lgLayout = function (nodes, sizeScale) {
var tree = lgBuild(nodes);
lgAssets(tree);
var W = (typeof BAND_W === 'number' && BAND_W > 0) ? BAND_W : 0;
var H = (typeof BAND_H === 'number' && BAND_H > 0) ? BAND_H : 0;
var views = [];
for (var i = 0; i < tree.length; i++) {
lgMeasure(tree[i], W, H, sizeScale);
tree[i].x = 0; tree[i].y = 0;
lgPlace(tree[i]);
lgFlatten(tree[i], views, 0, 0);
}
return { tree: tree, views: views };
};

var TIME_FMT = {
wm_time_yyyy_MM_dd_HH_mm: 'yyyy.MM.dd HH:mm',
wm_time_yyyy_MM_dd:       'yyyy.MM.dd',
wm_time_HH_mm:            'HH:mm',
wm_time_MM:               'MM',
wm_time_dd:               'dd',
wm_time_week:             'EEEE'
};
var WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var pad2 = function (x) { return (x < 10 ? '0' : '') + x; };

var _userCfgCache = null;
var userCfg = function () {
if (_userCfgCache) return _userCfgCache;
var o = null;
var el = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('wm-user') : null;
if (el) {
try {
var parsed = JSON.parse(el.textContent || '{}');
if (parsed && typeof parsed === 'object') o = parsed;
} catch (e) { o = null; }
}
_userCfgCache = o || {};
return _userCfgCache;
};
var userConfigSupports = function (k) { return (CONFIG.userConfig || {})[k] === true; };
var userStr = function (key) {
var v = userCfg()[key];
if (typeof v === 'string') return v.trim();
return (typeof v === 'number') ? String(v) : '';
};
var userGroup = function (group, k) {
var g = userCfg()[group];
if (!g || typeof g !== 'object') return undefined;
var v = g[k];
return (v === undefined || v === null || v === '') ? undefined : v;
};

var userFbVal = function (k) {
if (k === 'model' || k === 'date') {
var v = userCfg()[k];
return (v === undefined || v === null || v === '') ? undefined : v;
}
if (k === 'latitude' || k === 'longitude') return userGroup('location', k);
return userGroup('exif', k);
};
var userShowDate = function () {
return userConfigSupports('date') ? (userCfg().showDate !== false) : true;
};
var userShowLocation = function () {
return userCfg().showLocation !== false;
};

var userExifText = function () {
if (!userConfigSupports('exifText')) return '';
return userStr('exifText');
};
var userLocText = function () {
if (!userConfigSupports('locationText')) return '';
return userStr('locationText');
};

var userFbDate = function () {
var fb = userFbVal('date');
if (fb === undefined || fb === null) return null;
var s = String(fb).trim();
if (!s || s.toLowerCase() === 'now') return null;
if (s.charAt(0) === '{' || s.charAt(0) === '@') return null;
var d = new Date(s);
return isNaN(d.getTime()) ? null : d;
};
var fmtTime = function (iso, pattern) {
if (!userShowDate()) return '';
var d = iso ? new Date(iso) : null;
if (!d || isNaN(d.getTime())) d = userFbDate();
if (!d || isNaN(d.getTime())) d = new Date();
if (isNaN(d.getTime())) return '';
return pattern.replace(/yyyy/g, d.getFullYear())
.replace(/EEEE/g, WEEK[d.getDay()])
.replace(/MM/g, pad2(d.getMonth() + 1))
.replace(/dd/g, pad2(d.getDate()))
.replace(/HH/g, pad2(d.getHours()))
.replace(/mm/g, pad2(d.getMinutes()))
.replace(/ss/g, pad2(d.getSeconds()));
};
var dms = function (v, pos, neg) {
var hemi = v >= 0 ? pos : neg, a = Math.abs(v);
var d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.floor(((a - d) * 60 - m) * 60);
return d + '°' + m + "'" + pad2(s) + '"' + hemi;
};

var hasGps = function () {
if (!userShowLocation()) return false;
if (userLocText()) return true;
if (CONFIG.lat != null && CONFIG.lat !== '' && CONFIG.lon != null && CONFIG.lon !== '') return true;
return userFbVal('latitude') !== undefined && userFbVal('longitude') !== undefined;
};
var latlng = function () {
if (!userShowLocation()) return '';
var t = userLocText();
if (t) return t;
var lat = CONFIG.lat, lon = CONFIG.lon;
if (lat == null || lat === '' || lon == null || lon === '') {
lat = userFbVal('latitude'); lon = userFbVal('longitude');
}
if (lat == null || lat === '' || lon == null || lon === '') return '';
return dms(Number(lat), 'N', 'S') + '  ' + dms(Number(lon), 'E', 'W');
};

var numValue = function (x) {
if (typeof x === 'string' && x.indexOf('/') >= 0) {
var p = x.split('/'), a = Number(p[0]), b = Number(p[1]);
if (isFinite(a) && isFinite(b) && b !== 0) return a / b;
}
var n = Number(x);
return isFinite(n) ? n : NaN;
};
var fmtFixed = function (x, dec) {
x = Number(x);
return isFinite(x) ? String(Number(x.toFixed(dec))) : '';
};
var fmtSpeed = function (x) {
x = Number(x);
if (!isFinite(x) || x <= 0) return '';
if (x >= 1) return String(parseFloat(x.toPrecision(6)));
return '1/' + Math.round(1 / x);
};

var pickNum = function (k) {
var n = numValue(CONFIG[k]);
if (isFinite(n) && n > 0) return n;
var f = numValue(userFbVal(k));
return (isFinite(f) && f > 0) ? f : NaN;
};

var expand = function (tpl) {
if (tpl == null) return '';

tpl = tpl.replace(/@wm_time_(\w+)/g, function (_, k) {

var pat = TIME_FMT['wm_time_' + k];
return pat ? fmtTime(CONFIG.date, pat) : '';
});
tpl = tpl.replace(/location_latlng/g, latlng());

var needExif = /@\{(focal|aperture|speed|iso)\}/.test(tpl);
if (needExif && !(isFinite(pickNum('focal')) && isFinite(pickNum('aperture')) &&
isFinite(pickNum('speed')) && isFinite(pickNum('iso')))) return '';
return tpl.replace(/@\{(\w+)\}/g, function (_, k) {
switch (k) {
case 'model':      return CONFIG.model || userFbVal('model') || '';
case 'series':     return CONFIG.model || userFbVal('model') || '';
case 'versionNumber': return '';
case 'versionName':return CONFIG.versionName || '';
case 'focal':      return fmtFixed(pickNum('focal'), 0);
case 'focalActual':return fmtFixed(numValue(CONFIG.focalActual), 2);
case 'aperture':   return fmtFixed(pickNum('aperture'), 1);
case 'speed':      return fmtSpeed(pickNum('speed'));
case 'iso':        return fmtFixed(pickNum('iso'), 0);
case 'cvLens':     return CONFIG.lens || '';
case 'logo':       return '';
default:           return '';
}
});
};

var textOf = function (v) {
var raw = String(v.text || '');
if (!raw) return '';
var eq = raw.indexOf('=');
var kind = raw.slice(0, eq).replace(/^@/, '');
var tpl = raw.slice(eq + 1);
if (kind === 'model') return expand(tpl);
if (kind === 'time') {
var key = tpl.split(';')[0].trim().replace(/^@/, '');
var pat = TIME_FMT[key];
return pat ? fmtTime(CONFIG.date, pat) : '';
}
if (kind === 'exif') {

var et = userExifText();
if (et) return et;
return expand(tpl.split(';')[0]);
}
if (kind === 'location') {
return tpl.indexOf('location_latlng') >= 0 ? latlng() : '';
}
return '';
};

var wmGradAxis = function (deg, x, y, w, h) {
var th = deg * Math.PI / 180;
var dx = Math.sin(th), dy = -Math.cos(th);
var cx = x + w / 2, cy = y + h / 2;
var len = Math.abs(w * Math.sin(th)) + Math.abs(h * Math.cos(th));
var hx = dx * len / 2, hy = dy * len / 2;
return [cx - hx, cy - hy, cx + hx, cy + hy];
};

var wmForeground = function (ctx, x, y, w, h) {
var deg = parseFloat(APP('foreground-direction'));
if (!isFinite(deg)) deg = 90;
var a = wmGradAxis(deg, x, y, w, h);
var g = ctx.createLinearGradient(a[0], a[1], a[2], a[3]);
var start = lgCssColor(APP('foreground-start'));
var end = lgCssColor(APP('foreground-end'));
var stop = lgForegroundStop();
g.addColorStop(0, start);
if (stop > 0) g.addColorStop(stop, start);
g.addColorStop(stop, end);
if (stop < 1) g.addColorStop(1, end);
return g;
};

var wmFontFam = function (fam) {
var CSS_ONLY = /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|ui-serif|ui-monospace|-webkit-body|-webkit-standard)$/i;
var out = String(fam || '').split(',').map(function (s) {
s = s.trim().replace(/^["']|["']$/g, '');
if (!s || CSS_ONLY.test(s)) return '';
if (/^(sans-serif|serif|monospace|cursive|fantasy)$/i.test(s)) return s;
return /\s/.test(s) ? ('"' + s + '"') : s;
}).filter(Boolean);
if (!out.length) out = ['sans-serif'];
if (!/^(sans-serif|serif|monospace|cursive|fantasy)$/i.test(out[out.length - 1])) out.push('sans-serif');
return out.join(',');
};

var wmFontWeight = function (f) {
var n = parseFloat(f['design-weight']);
if (!isFinite(n) || n <= 0) return 400;
return Math.max(100, Math.min(900, Math.floor(n / 100) * 100));
};
var wmFontStr = function (f, sizePx) {
return wmFontWeight(f) + ' ' + sizePx + 'px ' + wmFontFam(f['font-family']);
};

var WM_SHADOW_UNITS = { dp: 1, px: 1, sp: 1 };
var wmShadowLen = function (token, axis) {
var d = lgDim(token);
if (!WM_SHADOW_UNITS[d.u]) {
wmError('shadow ' + axis + ' 不是合法长度（需 Ndp / Npx，x/y 可负）：' + JSON.stringify(String(token)));
return null;
}
var px = lgPx(d, CONFIG.unit, 0);
return isFinite(px) ? px : null;
};
var wmShadow = function (ctx, css) {
ctx.shadowOffsetX = ctx.shadowOffsetY = ctx.shadowBlur = 0;
ctx.shadowColor = 'rgba(0,0,0,0)';
var s = String(css == null ? '' : css).trim();
if (!s) return;
var parts = s.split(/\s+/);
if (parts.length < 3 || parts.length > 4) {
wmError('shadow 必须是 `<x> <y> [blur] <color>`：' + JSON.stringify(s));
return;
}
var color = parts[parts.length - 1];
var nums = parts.slice(0, parts.length - 1);
var x = wmShadowLen(nums[0], 'x'), y = wmShadowLen(nums[1], 'y');
var blur = nums.length > 2 ? wmShadowLen(nums[2], 'blur') : 0;
if (x === null || y === null || blur === null) return;
if (blur < 0) {
wmError('shadow blur 不能为负：' + JSON.stringify(nums[2]));
return;
}
var c = lgCssColor(color);
if (!c) {
wmError('shadow 颜色不合法（需 #AARRGGBB / #RRGGBB）：' + JSON.stringify(color));
return;
}
ctx.shadowOffsetX = x;
ctx.shadowOffsetY = y;
ctx.shadowBlur = blur;
ctx.shadowColor = c;
};

var wmDrawText = function (ctx, v) {
if (!v.textMetrics || !v.textValue) return;
var f = v.textMetrics.font, sizePx = v.textMetrics.sizePx;
ctx.save();
ctx.font = wmFontStr(f, sizePx);
ctx.textBaseline = 'alphabetic';

var ca = lgTextAlpha(f.color, CONFIG.appearance);
ca *= parseFloat(f.opacity);
ctx.globalAlpha = isFinite(ca) ? Math.max(0, Math.min(1, ca)) : 1;
wmShadow(ctx, f.shadow);
var ls = (parseFloat(f['letter-spacing']) || 0) * sizePx;
var lines = String(v.textValue).split('\n');
var lh = v.textMetrics.lineHeight || sizePx;

var mm = ctx.measureText('Hg');
var asc = mm.fontBoundingBoxAscent, desc = mm.fontBoundingBoxDescent;
if (asc == null || !isFinite(asc)) { asc = sizePx * 0.8; desc = sizePx * 0.2; }
if (desc == null || !isFinite(desc)) desc = sizePx * 0.2;
for (var i = 0; i < lines.length; i++) {
var line = lines[i];
var x = v.ax;
var y = v.ay + lh * i + (lh - (asc + desc)) / 2 + asc;

var gradW = (typeof BAND_PX_W === 'number' && isFinite(BAND_PX_W) && BAND_PX_W > 0)
? Math.max(v.w || 1, BAND_PX_W - v.ax) : (v.w || 1);
ctx.fillStyle = wmForeground(ctx, v.ax, v.ay, gradW, lh);
if (ls <= 0.001) { ctx.fillText(line, x, y); continue; }
for (var c = 0; c < line.length; c++) {
ctx.fillText(line.charAt(c), x, y);
x += ctx.measureText(line.charAt(c)).width + ls;
}
}
ctx.restore();
};

var wmDrawFill = function (ctx, v) {
var fill = lgFillFor(v);
if (!fill) return;
ctx.save();
ctx.globalAlpha = Math.max(0, Math.min(1, fill.alpha));
ctx.fillStyle = lgCssColor(APP('foreground-start'));
ctx.fillRect(v.ax, v.ay, v.w, v.h);
ctx.restore();
};

var wmDrawBackdrop = function (ctx, W, H) {
var bgc = String(APP('background-color')).trim();
if (!bgc || bgc === 'transparent' || bgc === 'none') return;
ctx.save();
ctx.fillStyle = lgCssColor(bgc);
ctx.fillRect(0, 0, W, H);
ctx.restore();
};

var wmDrawBgImage = function (ctx, W, H, img) {
if (!img || !img.width || !img.height) return;
var fit = APP('background-fit');
ctx.save();
if (fit === 'stretch') {
ctx.drawImage(img, 0, 0, W, H);
} else if (fit === 'repeat') {
var rh = H, rw = img.width * (H / img.height);
for (var x = 0; x < W; x += rw) ctx.drawImage(img, x, 0, rw, rh);
} else {
var sc = Math.max(W / img.width, H / img.height);
var dw = img.width * sc, dh = img.height * sc;
ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
ctx.restore();
};

var wmLogoSvg = function (v) {
if (!v._svg) return '';
var box = document.createElement('div');
box.innerHTML = v._svg;
var inner = box.querySelector('svg');
if (!inner) return '';
inner.setAttribute('width', v.w);
inner.setAttribute('height', v.h);
inner.setAttribute('preserveAspectRatio', 'xMidYMid meet');
inner.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
wmLogoSvgGradient(inner);
return new XMLSerializer().serializeToString(inner);
};

var wmLoadImage = function (src) {
return new Promise(function (resolve) {
var im = new Image();
im.onload = function () { resolve(im); };
im.onerror = function () { resolve(null); };
im.src = src;
});
};

var wmSvgDataUri = function (svg) {
var b64;
try { b64 = btoa(unescape(encodeURIComponent(svg))); }
catch (e) { b64 = btoa(svg); }
return 'data:image/svg+xml;base64,' + b64;
};

var wmPaint = function (L, canvas) {
var ctx = canvas.getContext('2d');
var W = canvas.width, H = canvas.height;

var raw = (typeof BG_URI === 'string') ? BG_URI : '';
var uri = raw.length > 64 ? (raw.indexOf('data:') === 0 ? raw : 'data:image/png;base64,' + raw) : '';
var views = L.views || [];

var logos = {}, bgImg = null;

var drawAll = function () {
ctx.clearRect(0, 0, W, H);
wmDrawBackdrop(ctx, W, H);
wmDrawBgImage(ctx, W, H, bgImg);
for (var i = 0; i < views.length; i++) {
var v = views[i];
if (!v.enabled) continue;
if (v.type === 'TextView') { wmDrawText(ctx, v); continue; }
if (v.type === 'ImageView') {
var im = logos[v.id];
if (im) ctx.drawImage(im, v.ax, v.ay, v.w, v.h);
continue;
}
wmDrawFill(ctx, v);
}
};

drawAll();
var published = wmPublish(canvas);

var jobs = [];
for (var i = 0; i < views.length; i++) {
var v = views[i];
if (v.type === 'ImageView' && v.enabled && v._svg) {
var svg = wmLogoSvg(v);
if (svg) {
jobs.push(wmLoadImage(wmSvgDataUri(svg)).then((function (view) {
return function (im) { if (im) logos[view.id] = im; };
})(v)));
}
}
}
if (uri) jobs.push(wmLoadImage(uri).then(function (im) { bgImg = im; }));

return Promise.all(jobs).then(function () {
drawAll();
if (published) published.src = canvas.toDataURL('image/png');
return true;
});
};

var wmPublish = function (canvas) {

var expW = (typeof BAND_PX_W === 'number') ? BAND_PX_W
: ((typeof BAND_W === 'number' && isFinite(BAND_W)) ? Math.max(1, Math.floor(BAND_W)) : 0);
var expH = (typeof BAND_PX_H === 'number') ? BAND_PX_H
: ((typeof BAND_H === 'number' && isFinite(BAND_H)) ? Math.max(1, Math.floor(BAND_H)) : 0);
var okSize = (expW > 0 && expH > 0) ? (canvas.width === expW && canvas.height === expH) : true;
if (!okSize) {
wmError('canvas size ' + canvas.width + 'x' + canvas.height + ' != BAND ' + expW + 'x' + expH);
}
var img = document.getElementById('wm-out');
if (!img) {
img = new Image();
img.id = 'wm-out';
img.setAttribute('data-wm-out', '1');
document.body.appendChild(img);
}
img.width = canvas.width;
img.height = canvas.height;
img.setAttribute('data-wm-size', canvas.width + 'x' + canvas.height);
img.src = canvas.toDataURL('image/png');
canvas.style.visibility = 'hidden';
return img;
};

(function () {
try {

var keys = ['unit','model','versionName','date','focal','focalActual','aperture','speed','iso','lat','lon','lens'];
for (var i = 0; i < keys.length; i++) {
var k = keys[i];
if (RTV && RTV[k] !== '' && RTV[k] != null) CONFIG[k] = RTV[k];
}
CONFIG.unit = parseFloat(CONFIG.unit) || 1;

var ap = CONFIG.appearance = {};
var APP_KEYS = ['foreground-start','foreground-end','foreground-stop','foreground-direction',
'line-opacity','background-color','background-image','background-fit',
'foreground-slots'];
for (var a = 0; a < APP_KEYS.length; a++) {
ap[APP_KEYS[a]] = OVERRIDE[APP_KEYS[a]];
}

var gps = hasGps(), variants = CONFIG.layout_group || {};
var pickName = gps ? 'layout' : 'layout_loc_off';
var pick = variants[pickName];
if (!pick) throw new Error('layout_group 缺少变体 ' + pickName + '（layout 与 layout_loc_off 必须都写）');

var renderPass = function (sizeScale) {
return lgLayout(pick, sizeScale);
};

var layoutOnce = function () {
var scale = 1, L = renderPass(scale), fitted = false;
for (var ip = 0; ip < 3; ip++) { if (!lgFitImages(L)) break; L = renderPass(scale); }
for (var pass = 0; pass < 3; pass++) {
var f = overlapFactor(L);
if (f >= 0.999) break;
var next = Math.max(0.4, f);
if (fitted && next > scale - 0.001) break;
scale = next; fitted = true;
L = renderPass(scale);
}

var eb = document.getElementById('wm-error');
if (scale <= 0.45) {
var diag = 'GUARD-MISJUDGE scale=' + scale.toFixed(3)
+ (window.__WM_OVERLAP && window.__WM_OVERLAP.length ? ' | ' + window.__WM_OVERLAP.join(' || ') : '');
window.__WM_GUARD_MISJUDGE = diag;
scale = 1; fitted = false; L = renderPass(1);
wmError(diag);
} else if (eb && /GUARD-MISJUDGE/.test(eb.textContent || '')) {

eb.textContent = ''; eb.style.display = 'none';
}
return { L: L, fitted: fitted };
};

var emitTelemetry = function (L, isFitted) {
var boxes = {}, texts = {}, fontsize = {}, strokes = 0, shapes = 0, seen = {};
for (var i = 0; i < L.views.length; i++) {
var v = L.views[i];
if (!v || !v.id) continue;
var id = seen[v.id] ? (v.id + '#' + i) : v.id;
seen[v.id] = true;
boxes[id] = { x: v.ax, y: v.ay, w: v.w, h: v.h };
if (v.textValue != null) texts[id] = v.textValue;
if (v.textMetrics && v.textMetrics.font) fontsize[id] = { size: v.textMetrics.sizePx, font: v.textMetrics.font['font-family'] };
if (v._svg) {
var svg = String(v._svg);
strokes += (svg.match(/stroke=/g) || []).length;
shapes += (svg.match(/<(path|rect|circle|ellipse|polygon|polyline|use|line)\b/g) || []).length;
}
}
window.__WM_TELEMETRY = {
unit: CONFIG.unit, boxes: boxes, texts: texts, fontsize: fontsize,
logoStrokes: strokes, logoShapes: shapes,
fitted: !!isFitted, variant: pickName,

band: Math.max(1, Math.floor(BAND_W)) + 'x' + Math.max(1, Math.floor(BAND_H)),
root: { clientWidth: Math.floor(BAND_W), scrollWidth: Math.floor(BAND_W), h: Math.floor(BAND_H) }
};
return window.__WM_TELEMETRY;
};

var first = layoutOnce();
var L = first.L, fitted = first.fitted;
emitTelemetry(L, fitted);

var canvas = document.getElementById('wm-canvas');
var paint = function (tree) {
if (!canvas || typeof wmPaint !== 'function') return;

var old = document.getElementById('wm-out');
if (old && old.parentNode) old.parentNode.removeChild(old);
try {
wmPaint(tree, canvas).then(null, function (e) {
wmError(e && e.message ? e.message : String(e));
});
} catch (e) { wmError(e && e.message ? e.message : String(e)); }
};
paint(L);

if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
document.fonts.ready.then(function () {
try {
var again = layoutOnce();
L = again.L; fitted = again.fitted;
emitTelemetry(L, fitted);
paint(L);
} catch (e) {
wmError(e && e.message ? e.message : String(e));
}
window.__WM_FINAL = true;
});
} else {
window.__WM_FINAL = true;
}
} catch (e) {
wmError(e && e.message ? e.message : String(e));
}
})();
