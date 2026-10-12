// 00-util: 基础工具（单位换算 / DOM / 取值）
// 单位链：unit = min(照片宽,照片高) / designShort（快捷指令算好写进 RUNTIME.unit；不除 dpr，踩坑 §9.1b）
// WebView 里 1 CSS px = 1 pt ⇒ dp × unit = px
var DP = function (v) {                       // dp 数值 → px；带单位字符串（"100%" / "0.083em"）原样
  if (typeof v === 'number') return (v * CONFIG.unit) + 'px';
  return v;
};
var EL = function (tag, css, text) {
  var e = document.createElement(tag);
  if (css) for (var k in css) e.style[k] = css[k];
  if (text != null) e.textContent = text;
  return e;
};
var PAD = function (p, side) { return p && p[side] != null ? p[side] : 0; };
var FONT = function (n) { return n.font ? ((CONFIG.fonts || {})[n.font] || null) : null; };
// 外观取值：键 = CSS 属性名（= 该 preset 的 styles 那套），运行时已被 OVERRIDE（选中样式）改写（§4.5）
var APP = function (k, dflt) {
  var a = CONFIG.appearance || {};
  return (a[k] != null && a[k] !== '') ? a[k] : dflt;
};

// 05-layout: 通用布局引擎 —— 1:1 对应小米 APK 水印模板的布局模型（p880yu 规则）
// 规范来源：/Users/alex.long/小米/leica_watermark_replica.py（Dim/px/parse_gravity/measure/place）
//   · 尺寸：match_parent / wrap_content / Ndp / Npx / N%w / N%h
//   · gravity 位标志：1=top 2=bottom 4=left 8=right 16=center_vertical 32=center_horizontal 48=center
//   · 流式容器：水平 Σ(子宽+margin_left) 高=max(子高+margin_top)；垂直反之；overlap 两轴独立
//   · 仅"宽度确定"的容器内，水平 right/center 才脱离流绝对定位；垂直方向同理（高度确定）
//   · 交叉轴一律按 gravity 在容器内容盒里摆
// 本项目扩展（APK 原生没有、但产品需要）：容器 padding_*（内容盒内缩）
var LG_WRAP = -1, LG_MATCH = -2;
var LG_GRAV = { top: 1, bottom: 2, left: 4, right: 8, center_vertical: 16, center_horizontal: 32, center: 48 };
var LG_DIM_RE = /^(-?\d+\.?\d*)(dp|px|sp)?$/;
var LG_W_RE = /^(\d+\.?\d*)%?[wW]$/;
var LG_H_RE = /^(\d+\.?\d*)%?[hH]$/;

var lgDim = function (spec, dflt) {
  var d = (dflt === undefined) ? LG_WRAP : dflt;
  if (spec == null || spec === '') return { v: d, u: '' };
  var s = String(spec).trim();
  if (s === 'wrap_content' || s === 'auto') return { v: LG_WRAP, u: '' };
  if (s === 'match_parent' || s === '100%') return { v: LG_MATCH, u: '' };
  var m = LG_DIM_RE.exec(s);
  if (m) return { v: parseFloat(m[1]), u: m[2] || 'dp' };
  var mw = LG_W_RE.exec(s), mh = LG_H_RE.exec(s);
  if (mw) return { v: parseFloat(mw[1]), u: '%w' };
  if (mh) return { v: parseFloat(mh[1]), u: '%h' };
  var n = parseFloat(s);
  return isFinite(n) ? { v: n, u: 'dp' } : { v: LG_WRAP, u: '' };
};
// dp → px（scale = unit）；px 原样；%w/%h 相对父约束；wrap/match 由布局期决定（返回 null）
var lgPx = function (dim, scale, parent) {
  if (dim.u === 'dp' || dim.u === '') return dim.v * scale;
  if (dim.u === 'px' || dim.u === 'sp') return dim.v;
  if (dim.u === '%w' || dim.u === '%h') return (parent || 0) * dim.v / 100.0;
  return dim.v;
};
// margin_*/padding_* 的数值（dp），非法/缺失 = 0
var lgNum = function (spec) {
  if (spec == null || spec === '') return 0;
  var d = lgDim(spec);
  if (d.v === LG_WRAP || d.v === LG_MATCH) return 0;
  if (d.u === 'px') return d.v;          // 统一按 dp 尺度处理（模板里 px 极少）
  return d.v;
};
var lgGrav = function (s) {
  var g = 0, toks = String(s || '').split('|');
  for (var i = 0; i < toks.length; i++) g |= (LG_GRAV[toks[i].trim()] || 0);
  return g;
};

// ---------------------------------------------------------------- 颜色（APK：#AARRGGBB / @foreground=N / @color=）
var LG_NAMED = { black: '#000000', white: '#FFFFFF', transparent: 'transparent' };
var lgRgba = function (argb, alphaScale) {
  if (argb == null || argb === '') return null;
  var s = String(argb).trim();
  if (s.charAt(0) !== '#') return LG_NAMED[s] || s;
  var h = s.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var a = 1, r, g, b;
  if (h.length === 8) { a = parseInt(h.slice(0, 2), 16) / 255; h = h.slice(2); }
  r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 2 + 2), 16); b = parseInt(h.slice(4, 6), 16);
  if (alphaScale != null) a = a * alphaScale;
  if (a >= 0.999) return 'rgb(' + r + ',' + g + ',' + b + ')';
  return 'rgba(' + r + ',' + g + ',' + b + ',' + (Math.round(a * 1000) / 1000) + ')';
};
var lgAlphaOf = function (argb) {
  var s = String(argb == null ? '' : argb).trim();
  if (s.charAt(0) !== '#' || s.length !== 9) return 1;
  return parseInt(s.slice(1, 3), 16) / 255;
};
// 主题调色板：preset.wmRes.backgrounds = [{name, value:"@color=#AARRGGBB", foreground:[...]}]
var lgThemeOf = function (preset) {
  var list = ((preset || {}).wmRes || {}).backgrounds || [];
  for (var i = 0; i < list.length; i++) if (list[i].name === 'white') return list[i];
  return list[0] || null;
};
var lgPalette = function (theme) { return (theme && theme.foreground) || []; };

// ---------------------------------------------------------------- 文本占位符（APK fill_views 语义）
// 模板写法： "@model= @{series}@{versionNumber}" / "@time=@wm_time_yyyy_MM_dd_HH_mm"
//           "@exif=@{focal}mm  f/@{aperture}  @{speed}s  ISO@{iso}" / "@location=location_latlng;@locationLimit=0.8"
var lgTextOf = function (node) {
  var raw = String(node.text || '');
  if (!raw) return '';
  var eq = raw.indexOf('=');
  var kind = raw.slice(0, eq).replace(/^@/, '');
  var tpl = raw.slice(eq + 1);
  if (kind === 'model') {
    // @{logo} = 品牌字标（本项目不用）、@{versionNumber} APK 硬编码为空、@{versionName} = 版本名
    return expand(tpl.replace(/@\{logo\}/g, '').replace(/@\{versionNumber\}/g, ''));
  }
  if (kind === 'time') {
    var key = tpl.split(';')[0].trim().replace(/^@/, '');
    return fmtTime(CONFIG.date, TIME_FMT[key] || 'yyyy.MM.dd HH:mm');
  }
  if (kind === 'exif') {
    return expand(tpl.split(';')[0]);          // expand 内含 E0 语义：四项缺一即整行为空
  }
  if (kind === 'location') {
    return tpl.indexOf('location_latlng') >= 0 ? latlng() : '';
  }
  if (kind === 'filter' || kind === 'custom') {
    return '';                                  // 本项目不提供影像风格徽标 / 自定义签名
  }
  return '';
};

// ---------------------------------------------------------------- 视图树（APK childViews → view）
var lgBuild = function (nodes) {
  var out = [];
  for (var i = 0; i < (nodes || []).length; i++) {
    var n = nodes[i], v = {
      id: n.id || '', type: n.type || '', orientation: n.orientation || 'horizontal',
      gravity: 0, lw: lgDim(n.layout_width !== undefined ? n.layout_width : 'wrap_content'),
      lh: lgDim(n.layout_height !== undefined ? n.layout_height : 'wrap_content'),
      ml: lgNum(n.margin_left), mt: lgNum(n.margin_top),
      pl: lgNum(n.padding_left), pt: lgNum(n.padding_top),
      pr: lgNum(n.padding_right), pb: lgNum(n.padding_bottom),
      background: n.background || null, children: [], text: '', font: null,
      optional: !!n.optional, dw: lgDim(n.display_width, 0), dh: lgDim(n.display_height, 0),
      maxW: (typeof n.max_width === 'number') ? n.max_width : null,
      img: null, enabled: true, w: 0, h: 0, x: 0, y: 0, _t: null
    };
    if (v.type === 'Layout') {
      v.gravity = lgGrav(n.gravity);
      v.children = lgBuild(n.childViews);
    } else if (v.type === 'TextView') {
      v.gravity = lgGrav(n.layout_gravity);
      v.text = n.text || '';
      v.font = n.font_ref || null;
    } else if (v.type === 'ImageView') {
      v.gravity = lgGrav(n.layout_gravity);
      v.src = n.path || '';
    }
    out.push(v);
  }
  return out;
};

// 图片视图：按 display_height/width 与素材宽高比求尺寸（复刻 measure 的 ImageView 分支；dp × unit → px）
var lgSizeImage = function (v, aspect) {
  var s = CONFIG.unit;
  var dh = (v.dh.v === LG_WRAP || v.dh.v === LG_MATCH) ? 0 : v.dh.v * s;
  var dw = (v.dw.v === LG_WRAP || v.dw.v === LG_MATCH) ? 0 : v.dw.v * s;
  if (!v.img) { v.w = v.h = 0; v.enabled = false; return; }
  if (dw > 0 && dh > 0) { v.w = dw; v.h = dh; }
  else if (dh > 0) { v.w = dh * aspect; v.h = dh; }
  else if (dw > 0) { v.w = dw; v.h = aspect > 0 ? dw / aspect : 0; }
  else { v.w = v.img.w * s; v.h = v.img.h * s; }
  if (v.maxW && v.w > v.maxW * s) { v.w = v.maxW * s; v.h = aspect > 0 ? v.w / aspect : v.h; }
};

var lgTextSize = function (v, sizeScale) {
  var f = (CONFIG.fonts || {})[v.font] || null;
  if (!f) { v.w = v.h = 0; return; }
  var sizePx = f['font-size'] * CONFIG.unit * (sizeScale || 1);
  v._t = { font: f, sizePx: sizePx, lh: f['line-height'] * CONFIG.unit };
  var t = lgTextOf(v);
  v._text = t;
  var lines = String(t).split('\n');
  var w = 0;
  for (var i = 0; i < lines.length; i++) w = Math.max(w, lgTextWidth(lines[i], f, sizePx));
  v.w = (f._indent ? 0 : 0) + w;
  v.h = (f['line-height'] * CONFIG.unit) * lines.length;   // 空文本仍占一行高
};

var _lgCtx = null;
var lgTextWidth = function (text, font, sizePx) {
  if (_lgCtx == null) _lgCtx = document.createElement('canvas').getContext('2d');
  var ls = parseFloat(font['letter-spacing']) || 0;        // em
  _lgCtx.font = (font['font-weight'] || 400) + ' ' + sizePx + 'px ' + (font['font-family'] || 'sans-serif');
  var w = _lgCtx.measureText(text).width;
  return w + ls * sizePx * String(text).length;            // CSS/Paint 每字符都补一个 letterSpacing
};

var lgMeasure = function (v, pw, ph, sizeScale) {
  var s = CONFIG.unit;
  if (v.type === 'Layout') {
    var pcw = (v.lw.v !== LG_WRAP && v.lw.v !== LG_MATCH) ? lgPx(v.lw, s, pw) : pw;
    var pch = (v.lh.v !== LG_WRAP && v.lh.v !== LG_MATCH) ? lgPx(v.lh, s, ph) : ph;
    for (var i = 0; i < v.children.length; i++) lgMeasure(v.children[i], pcw, pch, sizeScale);
    var w = 0, h = 0;
    for (var j = 0; j < v.children.length; j++) {
      var c = v.children[j];
      if (!c.enabled) continue;
      var ml = Math.max(0, c.ml) * s, mt = Math.max(0, c.mt) * s;
      if (v.orientation === 'horizontal') { w += c.w + ml; h = Math.max(h, c.h + mt); }
      else if (v.orientation === 'overlap') { w = Math.max(w, c.w + ml); h = Math.max(h, c.h + mt); }
      else { h += c.h + mt; w = Math.max(w, c.w + ml); }
    }
    if (v.lw.v === LG_MATCH) w = pw || w; else if (v.lw.v !== LG_WRAP) w = lgPx(v.lw, s, pw);
    if (v.lh.v === LG_MATCH) h = ph || h; else if (v.lh.v !== LG_WRAP) h = lgPx(v.lh, s, ph);
    v.w = w + v.pl * s + v.pr * s;                 // 本项目扩展：内容盒 + padding
    v.h = h + v.pt * s + v.pb * s;
  } else if (v.type === 'ImageView') {
    lgSizeImage(v, v._aspect || 1);
  } else if (v.type === 'TextView') {
    lgTextSize(v, sizeScale);
  }
};

// 摆放：把 v 的子项在 v 的内容盒里摆好（复刻 place()）
var lgPlace = function (v) {
  var s = CONFIG.unit;
  var ox = v.pl * s, oy = v.pt * s;                 // 内容盒原点（本项目扩展）
  var W = v.w - v.pl * s - v.pr * s, H = v.h - v.pt * s - v.pb * s;
  var defW = (v.lw.v === LG_MATCH), defH = (v.lh.v === LG_MATCH);   // 复刻 place(): 仅 match_parent 才脱离流
  var horiz = v.orientation === 'horizontal', cursor = 0;
  for (var i = 0; i < v.children.length; i++) {
    var c = v.children[i];
    if (!c.enabled) continue;
    var g = c.gravity, ml = c.ml * s, mt = c.mt * s;
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

// 展平成绝对坐标列表（父级偏移累加）
var lgFlatten = function (v, out, ox, oy) {
  if (out == null) { out = []; ox = 0; oy = 0; }
  v.ax = ox + v.x; v.ay = oy + v.y;
  out.push(v);
  for (var i = 0; i < v.children.length; i++) lgFlatten(v.children[i], out, v.ax, v.ay);
  return out;
};

// 10-style: view 树 → 绝对定位的 CSS（坐标由 05-layout 的 measure/place 算好）
// 小米引擎用绝对坐标画布绘制（p880yu），这里同构：每个节点 = 一个绝对定位的盒子，
// 位置/尺寸 = 布局引擎算出的 px（dp × unit），不再依赖 flex 猜尺寸。
var ABS_BOX = function (v) {
  return {
    position: 'absolute',
    left: v.ax + 'px', top: v.ay + 'px',
    width: v.w + 'px', height: v.h + 'px',
    boxSizing: 'border-box'
  };
};

// 文本：字体度量仍按设计字体（MiSans：ascent 1.044em / descent 0.282em，行高 = 1.326×size）
var textCss = function (v) {
  var css = ABS_BOX(v), f = v._t.font;
  css.fontFamily = f['font-family'];
  css.fontSize = v._t.sizePx + 'px';
  css.lineHeight = v._t.lh + 'px';
  css.fontWeight = f['font-weight'];
  css.whiteSpace = 'pre';                          // EXIF/经度双空格 + 绝不换行
  css.overflow = 'visible';
  if (f['letter-spacing']) css.letterSpacing = f['letter-spacing'];
  if (f.opacity != null) css.opacity = f.opacity;
  if (f.shadow) css.textShadow = f.shadow;
  var align = f.textAlign || (v.gravity & 8 ? 'right' : (v.gravity & 32 ? 'center' : 'left'));
  css.textAlign = align;
  return css;
};

// 节点自身的填充：
//   "@foreground=N" = 前景色条（分隔线）—— 用样式渐变 + line-opacity
//   "@background=name" = 主题底色 —— 本项目由 styles 的 background-color 统一决定，节点不再刷一层
var fillFor = function (v) {
  var bg = v.background;
  if (!bg) return null;
  if (bg.indexOf('@foreground=') === 0) {
    var idx = parseInt(bg.split('=')[1], 10) || 0;
    return { gradient: true, opacity: (idx === 1) ? APP('line-opacity', 1) : 1 };
  }
  return null;
};

// 20-build: view 树 → 绝对定位 DOM
// 图片：内联 SVG（只有内联才吃得到模板 CSS/渐变，见踩坑 §4.5）；
//       纯色标（fill=currentColor / 无 fill）走样式渐变，品牌色标（Leica/Nikon/ZEISS）保留自带填色。
var SVG_GRADIENT_ID = 'wm-fg-gradient';
var GRADIENT_SHAPES = 'path,rect,circle,ellipse,polygon,polyline,use,line';
var wantsPaint = function (v) { return v == null || v === '' || v === 'currentColor'; };

var paintGradient = function (svg) {
  var ns = 'http://www.w3.org/2000/svg';
  var defs = document.createElementNS(ns, 'defs');
  var g = document.createElementNS(ns, 'linearGradient');
  var angle = (parseFloat(APP('foreground-direction', '90deg')) - 90) * Math.PI / 180;
  var dx = Math.cos(angle), dy = Math.sin(angle);
  g.setAttribute('id', SVG_GRADIENT_ID);
  g.setAttribute('x1', (50 - dx * 50) + '%'); g.setAttribute('y1', (50 - dy * 50) + '%');
  g.setAttribute('x2', (50 + dx * 50) + '%'); g.setAttribute('y2', (50 + dy * 50) + '%');
  [[APP('foreground-stop', '0%'), APP('foreground-start', '#000000')], ['100%', APP('foreground-end', '#000000')]]
    .forEach(function (st) {
      var s = document.createElementNS(ns, 'stop');
      s.setAttribute('offset', st[0]); s.setAttribute('stop-color', st[1]);
      g.appendChild(s);
    });
  defs.appendChild(g);
  svg.insertBefore(defs, svg.firstChild);
  var shapes = svg.querySelectorAll(GRADIENT_SHAPES);
  for (var i = 0; i < shapes.length; i++) {
    if (wantsPaint(shapes[i].getAttribute('fill'))) shapes[i].setAttribute('fill', 'url(#' + SVG_GRADIENT_ID + ')');
    var strokeAttr = shapes[i].getAttribute('stroke');          // ⚠ 没写 stroke 的图形不能再补描边（会描出一圈黑框）
    if (strokeAttr != null && strokeAttr !== 'none' && wantsPaint(strokeAttr)) {
      shapes[i].setAttribute('stroke', 'url(#' + SVG_GRADIENT_ID + ')');
    }
  }
};

// 素材挂载：品牌标来自页面里的 #wm-logo-src（快捷指令注入的 SVG）；缺失 ⇒ 视图不渲染（enabled=false）
var lgAssets = function (root) {
  var walk = function (v) {
    if (v.type === 'ImageView') {
      if (String(v.id).indexOf('src_image') === 0) {         // 照片层：由快捷指令在外层合成，引擎不画
        v.enabled = false; v.img = null;
      } else {
        var svg = (document.getElementById('wm-logo-src') || {}).innerHTML || '';
        var box = document.createElement('div');
        box.innerHTML = svg;
        var inner = box.querySelector('svg');
        if (inner) {
          var vb = (inner.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
          var ratio = (vb.length === 4 && vb[2] > 0 && vb[3] > 0) ? vb[2] / vb[3]
            : (parseFloat(inner.getAttribute('width')) > 0 && parseFloat(inner.getAttribute('height')) > 0)
              ? parseFloat(inner.getAttribute('width')) / parseFloat(inner.getAttribute('height')) : 1;
          v.img = { w: 1, h: 1 }; v._aspect = ratio; v._svg = svg;
        } else { v.img = null; v.enabled = false; }
      }
    }
    for (var i = 0; i < v.children.length; i++) walk(v.children[i]);
  };
  for (var i = 0; i < root.length; i++) walk(root[i]);
};

var lgNodeDom = function (v) {
  if (!v.enabled) { var skip = EL('div', { display: 'none' }); skip.setAttribute('data-id', v.id); return skip; }
  if (v.type === 'TextView') {
    var e = EL('div', textCss(v), v._text || '');
    e.className = 'tn';
    e.setAttribute('data-id', v.id);
    e.setAttribute('data-fs', (v._t.sizePx) + 'px');
    e.setAttribute('data-font', v.font || '');
    return e;
  }
  if (v.type === 'ImageView') {
    var box = EL('div', ABS_BOX(v));
    box.setAttribute('data-id', v.id);
    if (v._svg) {
      box.innerHTML = v._svg;
      var inner = box.querySelector('svg');
      if (inner) {
        inner.setAttribute('width', v.w); inner.setAttribute('height', v.h);
        inner.style.width = v.w + 'px'; inner.style.height = v.h + 'px';
        inner.style.display = 'block';
        inner.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        paintGradient(inner);
        box.setAttribute('data-ratio', (v._aspect || 1).toFixed(4));
      }
    }
    return box;
  }
  // Layout
  var d = EL('div', ABS_BOX(v));
  d.setAttribute('data-id', v.id);
  var fill = fillFor(v);
  if (fill && fill.gradient) {
    d.style.backgroundImage = 'linear-gradient(' + APP('foreground-direction', '90deg') + ',var(--foreground-start) ' +
      APP('foreground-stop', '0%') + ',var(--foreground-end))';
    if (fill.opacity != null) d.style.opacity = fill.opacity;
  }
  return d;
};

// 布局 + 建树：返回 {tree, views}（views = 绝对坐标展平列表）
var lgLayout = function (nodes, sizeScale) {
  var tree = lgBuild(nodes);
  lgAssets(tree);
  var W = (typeof BAND_W === 'number' && BAND_W > 0) ? BAND_W : 0;
  var H = (typeof BAND_H === 'number' && BAND_H > 0) ? BAND_H : 0;
  var views = [];
  for (var i = 0; i < tree.length; i++) {
    lgMeasure(tree[i], W, H, sizeScale);
    tree[i].x = 0; tree[i].y = 0;                    // 根节点贴页面左上角，子项在它自己的内容盒里摆
    lgPlace(tree[i]);
    lgFlatten(tree[i], views, 0, 0);
  }
  return { tree: tree, views: views, W: W, H: H };
};

// 30-format: token 展开（唯一权威表见文档 §5.3；时间格式表 = 小米 arsc 字符串池）
var TIME_FMT = {                       // @wm_time_* → SimpleDateFormat 原文
  wm_time_yyyy_MM_dd_HH_mm: 'yyyy.MM.dd HH:mm',
  wm_time_yyyy_MM_dd:       'yyyy.MM.dd',
  wm_time_HH_mm:            'HH:mm',
  wm_time_MM:               'MM',
  wm_time_dd:               'dd',
  wm_time_week:             'EEEE'
};
var WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var pad2 = function (x) { return (x < 10 ? '0' : '') + x; };
var fmtTime = function (iso, pattern) {
  var d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) {          // 时间缺失/无效 ⇒ fallback.date（"now" = 渲染时刻）
    var fb = (CONFIG.fallback || {}).date;
    d = (fb && fb !== 'now') ? new Date(fb) : new Date();
  }
  if (isNaN(d.getTime())) return '';
  return pattern.replace(/yyyy/g, d.getFullYear())
                .replace(/EEEE/g, WEEK[d.getDay()])
                .replace(/MM/g, pad2(d.getMonth() + 1))
                .replace(/dd/g, pad2(d.getDate()))
                .replace(/HH/g, pad2(d.getHours()))
                .replace(/mm/g, pad2(d.getMinutes()))
                .replace(/ss/g, pad2(d.getSeconds()));
};
var dms = function (v, pos, neg) {     // Ci.a.d(): 度分秒整数截断 + 半球后缀
  var hemi = v >= 0 ? pos : neg, a = Math.abs(v);
  var d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.floor(((a - d) * 60 - m) * 60);
  return d + '°' + m + "'" + pad2(s) + '"' + hemi;
};
var hasGps = function () {
  return CONFIG.lat != null && CONFIG.lat !== '' && CONFIG.lon != null && CONFIG.lon !== '';
};
var latlng = function () {             // 单行，纬经之间【两个空格】（模板不拆行）
  return hasGps() ? (dms(Number(CONFIG.lat), 'N', 'S') + '  ' + dms(Number(CONFIG.lon), 'E', 'W')) : '';
};
var numValue = function (x) {
  if (typeof x === 'string' && x.indexOf('/') >= 0) {
    var p = x.split('/'), a = Number(p[0]), b = Number(p[1]);
    if (isFinite(a) && isFinite(b) && b !== 0) return a / b;
  }
  var n = Number(x);
  return isFinite(n) ? n : NaN;
};
var fmtFixed = function (x, dec) {     // 定点后去尾零（2.6 → "2.6"，2.0 → "2"）
  x = Number(x);
  return isFinite(x) ? String(Number(x.toFixed(dec))) : '';
};
var fmtSpeed = function (x) {          // <1s ⇒ 1/N；≥1s ⇒ %g（复刻 fmt_speed）
  x = Number(x);
  if (!isFinite(x) || x <= 0) return '';
  if (x >= 1) return String(parseFloat(x.toPrecision(6)));
  return '1/' + Math.round(1 / x);
};
// 取值链：运行时值 → preset.fallback 兜底 → NaN/空（截图、无 EXIF、无机型都不会空/出错）
var pickNum = function (k) {
  var n = numValue(CONFIG[k]);
  if (isFinite(n) && n > 0) return n;
  var f = numValue((CONFIG.fallback || {})[k]);
  return (isFinite(f) && f > 0) ? f : NaN;
};

var expand = function (tpl) {
  if (tpl == null) return '';
  // 就地替换（不早返回）：模板里可以同时有时间和别的 token；早返回会把其余内容整行吞掉
  tpl = tpl.replace(/@wm_time_(\w+)/g, function (_, k) {
    return fmtTime(CONFIG.date, TIME_FMT['wm_time_' + k] || k);
  });
  tpl = tpl.replace(/location_latlng/g, latlng());
  // 涉及拍摄参数的行：四项都取"值或兜底"；连兜底都没有才整行置空（仍占一行高）
  var needExif = /@\{(focal|aperture|speed|iso)\}/.test(tpl);
  if (needExif && !(isFinite(pickNum('focal')) && isFinite(pickNum('aperture')) &&
                    isFinite(pickNum('speed')) && isFinite(pickNum('iso')))) return '';
  return tpl.replace(/@\{(\w+)\}/g, function (_, k) {
    switch (k) {
      case 'model':      return CONFIG.model || (CONFIG.fallback || {}).model || '';
      case 'series':     return CONFIG.model || (CONFIG.fallback || {}).model || '';   // APK: @{series} = 机型串
      case 'versionNumber': return '';                                                  // APK 里硬编码为空
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

// 90-boot: 入口 —— RUNTIME → CONFIG → 选 layout 变体 → CSS 变量 → 绝对定位建树 → 防挤压
(function () {
  var fail = function (msg) {
    var b = document.getElementById('wm-error');
    if (b) { b.style.display = 'block'; b.textContent = 'watermark error: ' + msg; }
  };
  try {
    // 1) 运行时值合并进 CONFIG（扁平注入，见踩坑 §18.3）
    var keys = ['unit','model','versionName','date','focal','focalActual','aperture','speed','iso','lat','lon','lens'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (RTV && RTV[k] !== '' && RTV[k] != null) CONFIG[k] = RTV[k];
    }
    CONFIG.unit = parseFloat(CONFIG.unit) || 1;

    // 2) 选中样式（快捷指令从该 preset 的 styles 里挑一款传进来）→ 改写 CONFIG.appearance，见 §4.5
    var ap = CONFIG.appearance = CONFIG.appearance || {};
    var APP_KEYS = ['foreground-start','foreground-end','foreground-stop','foreground-direction',
                    'line-opacity','background-color','background-image','background-fit','text-shadow'];
    for (var a = 0; a < APP_KEYS.length; a++) {
      var ak = APP_KEYS[a];
      if (OVERRIDE && OVERRIDE[ak] !== '' && OVERRIDE[ak] != null) ap[ak] = OVERRIDE[ak];
    }
    var st = document.documentElement.style;
    st.setProperty('--background-color', APP('background-color', '#FFFFFF'));
    st.setProperty('--foreground-start', APP('foreground-start', '#000000'));
    st.setProperty('--foreground-end', APP('foreground-end', APP('foreground-start', '#000000')));
    st.setProperty('--foreground-stop', APP('foreground-stop', '0%'));
    st.setProperty('--foreground-direction', APP('foreground-direction', '90deg'));

    var root = document.getElementById('wm-root');
    // 背景图：快捷指令注入 BG_URI（纯 base64，或历史/本地校验用的完整 data URI）；
    // 缩放/定位由模板静态 CSS 给 cover/center/no-repeat，再按 background-fit 用内联样式覆盖。
    var bandW = (typeof BAND_W === 'number' && BAND_W > 0) ? BAND_W : 0;
    var bandH = (typeof BAND_H === 'number' && BAND_H > 0) ? BAND_H : 0;
    var bgRaw = BG_URI || '';
    var backgroundImage = (bgRaw.length > 64)
      ? (bgRaw.indexOf('data:') === 0 ? bgRaw : ('data:image/png;base64,' + bgRaw))
      : '';
    if (bandW && bandH) { root.style.width = bandW + 'px'; root.style.height = bandH + 'px'; }
    // 叠加(overlay)类模板：整页必须透明（照片在快捷指令侧合成，页面只提供水印层）
    // 参考实现(leica_watermark_replica)与用户的「隐私水印V5」都是无底色页面 ⇒ 透明
    if (CONFIG.compose && CONFIG.compose.mode === 'overlay') {
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
      root.style.background = 'transparent';
      root.style.backgroundColor = 'transparent';
    }

    if (backgroundImage) {
      document.documentElement.style.setProperty('--bg-image', 'url("' + backgroundImage + '")');
      var bgFit = APP('background-fit', 'cover');
      root.style.backgroundSize = (bgFit === 'stretch') ? '100% 100%' : (bgFit === 'repeat') ? 'auto 100%' : 'cover';
      root.style.backgroundPosition = 'center';
      root.style.backgroundRepeat = (bgFit === 'repeat') ? 'repeat-x' : 'no-repeat';
    }

    // 3) 选 layout 变体：有 layout / layout_loc_off 两个就按 GPS 有无二选一；
    //    单变体（如 91 号的 center_top）直接用；多而非常规命名时取第一个。
    var gps = hasGps(), variants = CONFIG.layout_group || [], pick = null, pickName = '';
    var names = [];
    for (var v = 0; v < variants.length; v++) names.push(Object.keys(variants[v])[0]);
    var want = gps ? 'layout' : 'layout_loc_off';
    if (names.indexOf(want) >= 0) pickName = want;
    else pickName = names.length ? names[0] : '';
    for (var w = 0; w < variants.length; w++) {
      if (Object.keys(variants[w])[0] === pickName) { pick = variants[w][pickName]; break; }
    }
    if (!pick) throw new Error('layout_group 为空');

    // 4) 通用布局引擎：measure/place（绝对坐标）→ DOM。文字被挤时按比例缩字号重排（幂等）
    var renderPass = function (sizeScale) {
      while (root.firstChild) root.removeChild(root.firstChild);
      var L = lgLayout(pick, sizeScale);
      for (var n = 0; n < L.views.length; n++) root.appendChild(lgNodeDom(L.views[n]));
      return L;
    };
    // 防挤压：同一水平容器里相邻子项横向重叠 ⇒ 缩字号重排（小米引擎无此逻辑，是本项目的兜底）
    var overlapFactor = function (L) {
      var worst = 1;
      var walk = function (v) {
        if (v.type === 'Layout' && v.orientation === 'horizontal') {
          var vis = [];
          for (var i = 0; i < v.children.length; i++) {
            var c = v.children[i];
            if (c.enabled && c.w > 1) vis.push(c);
          }
          for (var j = 1; j < vis.length; j++) {
            var a = vis[j - 1], b = vis[j];
            var ov = (a.ax + a.w) - b.ax;
            if (ov > 0.5) {
              var span = a.w + b.w;
              if (span > 0) worst = Math.min(worst, Math.max(0.4, (span - ov) / span));
            }
          }
        }
        for (var m = 0; m < v.children.length; m++) walk(v.children[m]);
      };
      for (var t = 0; t < L.tree.length; t++) walk(L.tree[t]);
      return worst;
    };
    var L = renderPass(1);
    for (var pass = 0; pass < 3; pass++) {
      var f = overlapFactor(L);
      if (f >= 0.999) break;
      root.setAttribute('data-fit', '1');
      L = renderPass(f);
    }
    root.setAttribute('data-variant', pickName);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { try { renderPass(root.getAttribute('data-fit') === '1' ? 0.9 : 1); } catch (e) {} });
    }
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
})();
