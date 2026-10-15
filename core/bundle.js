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
// ★ 颜色一律是 8 位 ARGB 十六进制（#AARRGGBB，Android 口径：前两位 = alpha）：
//   styles 的 foreground-start/-end 与字体色都已按这一种形态规范化，构建期也照这个校验（build.py 3.25）。
//   以前混用 CSS 具名色（"black" / "white"）逼着这里带一张具名色表 + 一个 lgRgba 解析器 —— 两者都已删除。
// ★ @foreground=N 只表达【透明度层级】，颜色另有唯一来源（styles.foreground-start）★
//   N 的 alpha 由每个样式自己声明的 styles.<id>.foreground-slots 给出（见下面 lgForegroundAlpha）；
//   原先那套"从 APK 调色板 wmRes.background 里挑一份"的逻辑（lgHex6/lgLumOf/lgSwatchValue/lgPaletteFor）
//   已整体删除 —— 它让同一个 alpha 同时写在 styles 与 wmRes 两处，正是"两处不一致"的根源。
// ★ 颜色拆解（全项目唯一的颜色解析器）★
//   本项目 preset 的颜色契约是 **#AARRGGBB（前两位 = alpha，Android/APK 原文）**，构建期也照这个校验
//   （build.py 3.25）。但浏览器把 8 位十六进制按 **#RRGGBBAA** 解析 ⇒ 直接把 preset 的 #AARRGGBB 塞给
//   ctx.fillStyle / SVG stop-color 会【把 alpha 当成红色通道、把蓝色当成 alpha】：
//     实测 #FFE6A54F（本该是不透明金）被解析成 rgba(255,230,165,0.31) ⇒ 文字整片发灰发暗；
//     实测同样的值当 SVG 渐变 stop-color 时，logo 被压成 (93,85,65)（= 31% 金压在 #141414 上）；
//     #66E6A54F（40% 金）被解析成 rgba(102,230,84,0.31) ⇒ 偏绿。
//   所以颜色一律先在这里拆成【不含 alpha 的颜色串】+【alpha（0..1）】：
//     · canvas：颜色串进 fillStyle/addColorStop，alpha 单独用 globalAlpha 合成
//       （不能把 alpha 留在颜色串里：会被浏览器按"未 premultiply 的 RGB"再混一次，见 40-draw 注释）；
//     · SVG：颜色串进 stop-color，alpha 进 **独立的 stop-opacity**（SVG 1.1 通用属性）——
//       WebKit 对 stop-color 里写 rgba() 的支持面窄，不依赖它。
//   返回 {rgb, alpha, argb}：rgb = '#RRGGBB'（6/3 位原样、8 位剥掉 alpha）、具名色/已是 CSS 形态原样、
//   transparent 原样、空串 → ''；argb = 输入是否为 8 位 ARGB（调用方要还原 rgba() 字面量时用）。
//   "@color=X" 前缀（APK 用来显式指定调色板外的颜色）在此剥掉。
var lgColorParts = function (ref) {
  var s = String(ref == null ? '' : ref).trim();
  if (s.charAt(0) === '@' && s.indexOf('=') > 0) s = s.slice(s.indexOf('=') + 1).trim();
  if (!s) return { rgb: '', alpha: 1, argb: false };
  if (s === 'transparent') return { rgb: s, alpha: 0, argb: false };
  if (s.charAt(0) !== '#') return { rgb: s, alpha: 1, argb: false };              // 具名色/已是 CSS 形态：原样
  var h = s.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length === 6 && /^[0-9a-f]{6}$/i.test(h)) return { rgb: s, alpha: 1, argb: false };  // #RRGGBB：CSS 与项目语义一致
  if (h.length !== 8 || !/^[0-9a-f]{8}$/i.test(h)) return { rgb: s, alpha: 1, argb: false }; // 其它形态：交给浏览器自己判
  var a = parseInt(h.slice(0, 2), 16) / 255;
  return { rgb: '#' + h.slice(2), alpha: isFinite(a) ? a : 1, argb: true };
};
// 取颜色的 alpha（0..1）：#AARRGGBB → AA/255；transparent → 0；其余（#RRGGBB 等）→ 1；
// "@color=X"（同族前缀）→ 去掉前缀按 X 算。等价于 lgColorParts(...).alpha，只是省掉临时对象。
var lgColorAlpha = function (ref) { return lgColorParts(ref).alpha; };
// ARGB → canvas/CSS 颜色串（外部契约不变：8 位 → 'rgba(r,g,b,a)'，6/3 位与具名色原样返回）
var lgCssColor = function (ref) {
  var p = lgColorParts(ref);
  if (!p.rgb) return '';
  if (!p.argb) return p.rgb;                                 // 6 位 / 3 位 / 具名色：CSS 语义与项目一致，原样
  var r = parseInt(p.rgb.slice(1, 3), 16), g = parseInt(p.rgb.slice(3, 5), 16), b = parseInt(p.rgb.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + (Math.round(p.alpha * 1000) / 1000) + ')';
};
// ★ @foreground=N 的透明度语义（全项目唯一口径，方案 B：styles 是唯一来源）★
//   APK 的 @foreground=N 本来是"主题调色板第 N 项（一个带 alpha 的 ARGB 颜色）"。
//   本项目只沿用其中的【透明度层级】：颜色一律取 styles.foreground-start（渐变另有 foreground-end），
//   第 N 档的 alpha 由【该样式自己声明】的 styles.<id>.foreground-slots[N] 给出 ——
//   引擎不再从 preset.wmRes.background 里"按底色精确匹配 / 按明度就近挑"一份调色板：
//     黑金款与黑色款的调色板 value 同为 #141414 ⇒ 精确匹配也必然先命中 black，
//     于是金款的槽位只能来自 black（颜色对、透明度错）；而 alpha 又已经写在 styles.line-opacity 里
//     ⇒ 同一个概念写两处，两边一旦不一致就没有权威。两者现已收敛为 styles 一处。
//   · 槽位写【数字 0..1】而不是 APK 的 #AARRGGBB：引擎只消费 alpha（颜色另有来源），
//     而 8 位十六进制表达不了 line-opacity 的精确浮点（0.3 ≠ #4D/255 = 0.30196…），写颜色会破坏逐像素等价。
//   · 槽位 1（分隔线 @foreground=1）的权威是 styles.line-opacity（浮点精确值），
//     foreground-slots[1] 是它的同义项，build.py 强制两者相等（见 core/10-style.js lgFillAlpha）。
//   · 数组里没声明这一档（N 越界）= 不透明：这是本文件唯一的默认值，与参考实现 WmRes.resolve_color
//     的越界兜底（返回不透明的 #FF000000）同义；三份 preset 都声明满 5 档，正常路径不会走到。
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
// 文字颜色（font.color）的透明度：@foreground=N → 该样式的第 N 个槽位；其余（#AARRGGBB / @color=#..）→ 颜色自带 alpha
var lgTextAlpha = function (ref, style) {
  var s = String(ref == null ? '' : ref).trim();
  if (s.indexOf('@foreground=') === 0) return lgForegroundAlpha(s.split('=')[1], style);
  return lgColorAlpha(s);
};

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
    // ★自定义文本优先★：用户词典里填了 exifText 且该款式声明支持 ⇒ 整条拍摄参数用自定义文本
    //（leica91 把拍摄参数拆成两行 ⇒ userConfig.exifText=false，这里取不到自定义文本，仍走 实际值>兜底值）
    var et = (typeof userExifText === 'function') ? userExifText() : '';
    if (et) return et;
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
// pkey = 父节点路径（"#索引"逐级拼接）⇒ 每个 view 有一个【跨重排稳定】的 key。见 lgSizeImage 的让位因子表。
var lgBuild = function (nodes, pkey) {
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
      img: null, enabled: true, w: 0, h: 0, x: 0, y: 0, _t: null,
      _key: (pkey || '') + '#' + i
    };
    if (v.type === 'Layout') {
      v.gravity = lgGrav(n.gravity);
      v.children = lgBuild(n.childViews, v._key);
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

// ---------------------------------------------------------------- 图片视图：尺寸 + 行内让位因子
// ★行内"图片让位"因子表：key → 累计收缩因子（0..1）★
//   放这里而不是 90-boot 的局部变量，是因为 lgLayout 每趟（每次 renderPass）都重建整棵视图树，
//   因子必须存在树外、按【跨重排稳定的节点 key】索引，才能被 lgSizeImage 在下一趟重新应用。
//   计算方是 90-boot 的 lgFitImages（它拿得到绝对坐标 = 真实剩余宽度）。
var LG_IMG_FIT = {};
var LG_IMG_FLOOR = 0.2;      // 安全网：任何让位都不把图片缩到标称宽度的 20% 以下

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
  // ★宽度上限只认节点自己声明的 dp 预算（max_width；0/缺省 = 不限）★
  //   这里以前还有一条 "min(max_width, 显示高度 × 2)" 的派生上限（commit f82c8c1 / 踩坑 §26）：
  //   那是为 12.8:1 的哈苏 wordmark 打的补丁，而该素材已在 4384774 换成 1.26:1 的"H"标 ——
  //   补丁的触发素材不在了，只留下副作用：宽高比 > 2 的素材 display_height 形同虚设
  //   （Canon 4.75 → 高度只达成 42%、SONY 5.68 → 35%），节点声明的 max_width 也被架空。
  //   派生值还跟行内真实剩余宽度无关（"各处兜底、各处不一致"的根源）。
  //   放不下由 90-boot 的 lgFitImages【让图片让位】处理：先缩自适应宽度的图片，文字保持设计字号。
  var capDp = (typeof v.maxW === 'number' && v.maxW > 0) ? v.maxW : 0;
  if (capDp > 0 && v.w > capDp * s) { v.w = capDp * s; v.h = aspect > 0 ? v.w / aspect : v.h; }
  // 行内让位因子（lgFitImages 按真实剩余宽度回填）：宽高一起等比缩，保证素材不变形
  var fit = LG_IMG_FIT[v._key];
  if (fit > 0 && fit < 1) { v.w *= fit; v.h *= fit; }
};

var lgTextSize = function (v, sizeScale) {
  var f = (CONFIG.fonts || {})[v.font] || null;
  if (!f) { v.w = v.h = 0; return; }
  var sizePx = f['font-size'] * CONFIG.unit * (sizeScale || 1);
  v._t = { font: f, sizePx: sizePx, lh: f['line-height'] * CONFIG.unit };
  var t = lgTextOf(v);
  v._text = t;
  if (v.optional && !t) {                       // 可选块（时间/定位）内容为空 ⇒ 整块隐藏，不留空行
    v.enabled = false; v.w = v.h = 0;
    return;
  }
  var lines = String(t).split('\n');
  var w = 0;
  for (var i = 0; i < lines.length; i++) w = Math.max(w, lgTextWidth(lines[i], f, sizePx));
  v.w = (f._indent ? 0 : 0) + w;
  v.h = (f['line-height'] * CONFIG.unit) * lines.length;   // 非 optional 的空文本仍占一行高（历史口径）
};

// 可选容器（如 leica91 的 time_layout）：子树里一个非空文本都没有 ⇒ 整块隐藏
var lgAnyText = function (v) {
  if (v.type !== 'TextView') {
    for (var i = 0; i < (v.children || []).length; i++) if (lgAnyText(v.children[i])) return true;
    return false;
  }
  return !!v._text;
};

var _lgCtx = null;
// 字族含空格必须加引号，否则 ctx.font 解析失败（Chrome 退回默认 10px）⇒ 测宽与绘制都偏小。
// wmFontFam 在 core/40-draw.js（拼接顺序在 05 之后，但本函数是运行时调用，届时已就绪）。
var lgFontFam = function (fam) {
  return (typeof wmFontFam === 'function') ? wmFontFam(fam) : String(fam || 'sans-serif');
};
var lgTextWidth = function (text, font, sizePx) {
  if (_lgCtx == null) _lgCtx = document.createElement('canvas').getContext('2d');
  var ls = parseFloat(font['letter-spacing']) || 0;        // em
  // 字重必须与 40-draw 的绘制走【同一个】映射（wmFontWeight：设计字重 → 最近百位档），
  // 否则"量的宽度"和"画的字形"不是同一个字重。
  var fw = (typeof wmFontWeight === 'function') ? wmFontWeight(font) : (font['font-weight'] || 400);
  _lgCtx.font = fw + ' ' + sizePx + 'px ' + lgFontFam(font['font-family']);
  var w = _lgCtx.measureText(text).width;
  return w + ls * sizePx * String(text).length;            // CSS/Paint 每字符都补一个 letterSpacing
};

var lgMeasure = function (v, pw, ph, sizeScale) {
  var s = CONFIG.unit;
  if (v.type === 'Layout') {
    var pcw = (v.lw.v !== LG_WRAP && v.lw.v !== LG_MATCH) ? lgPx(v.lw, s, pw) : pw;
    var pch = (v.lh.v !== LG_WRAP && v.lh.v !== LG_MATCH) ? lgPx(v.lh, s, ph) : ph;
    for (var i = 0; i < v.children.length; i++) lgMeasure(v.children[i], pcw, pch, sizeScale);
    if (v.optional && !lgAnyText(v)) {             // 可选容器没有可显示文本（如关掉日期）⇒ 整块隐藏
      v.enabled = false; v.w = v.h = 0;
      return;
    }
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
//   "@foreground=N" = 前景色条（分隔线）—— 颜色取样式前景，透明度取【该样式声明的第 N 个槽位】
//   "@background=name" = 主题底色 —— 本项目由 styles 的 background-color 统一决定，节点不再刷一层
// ★ 不再另乘任何透明度：@foreground=N 的 alpha 已经由 styles.foreground-slots 给全，
//   颜色自带的 alpha 也由 wmDrawFill 单独取出（见 40-draw 注释），两个都乘就会重复相乘
//   —— 参考件 leica_1 的分隔线实测是 30% 黑，再乘一次会掉到 9%（见 _local 对照）。
//   分隔线（N=1）的 alpha 唯一来源 = styles.line-opacity：它是浮点精确值（0.3 / 0.7 / 0.6 …），
//   而槽位数组是数字，两者是同义项 —— build.py 强制 foreground-slots[1] == line-opacity，
//   所以这里取哪个都不会出现"两处不一致"；取 line-opacity 是为了保住历史口径与浮点精度。
var lgFillAlpha = function (n, style) {
  var idx = parseInt(n, 10);
  if (!isFinite(idx) || idx < 0) idx = 0;
  if (idx === 1) {
    var lo = parseFloat(APP('line-opacity', NaN));
    if (isFinite(lo)) return Math.max(0, Math.min(1, lo));
  }
  return lgForegroundAlpha(idx, style);
};
var fillFor = function (v) {
  var bg = v.background;
  if (!bg) return null;
  if (bg.indexOf('@foreground=') === 0) {
    var idx = parseInt(bg.split('=')[1], 10) || 0;
    return { foreground: true, alpha: lgFillAlpha(idx, CONFIG.appearance) };
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
      // ★ 颜色必须先归一（lgColorParts）：preset 是 #AARRGGBB，而 SVG 把 8 位十六进制按 #RRGGBBAA 解析。
      //   直接塞原值 ⇒ 不透明金 #FFE6A54F 变成 rgb(255,230,165) + alpha 0x4F=31%（logo 实测被压成 (93,85,65)）。
      //   正解：stop-color 只放 RGB；alpha 用 SVG 1.1 的独立属性 stop-opacity
      //   （不写 "stop-color: rgba(...)"：WebKit 对它的支持面窄）。alpha=1 时不下发，
      //   这样 6 位色的款式（rose/dark/light/red）DOM 与像素都逐字节不变。
      var c = lgColorParts(st[1]);
      s.setAttribute('offset', st[0]);
      s.setAttribute('stop-color', c.rgb);
      if (c.alpha < 1) s.setAttribute('stop-opacity', String(c.alpha));
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

// 【已删除 lgNodeDom】纯 canvas 直绘：不再创建任何布局 DOM 节点。
// 布局数据由 lgLayout 产出（{tree, views}），绘制由 core/40-draw.js 直接画到 #wm-canvas。

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

// ---------------------------------------------------------------- 用户词典（快捷指令里那个"用户配置"词典）
// ★取值优先级：【自定义文本（用户填了 + 该款式支持）】>【照片里实际读到的值】>【词典里的兜底值】★
// 兜底值统一来自快捷指令的用户词典（不再写在各 preset 里）；preset 只用 userConfig 声明"支持哪些开关"：
//   userConfig.date / .exifText / .locationText（true = 这款水印支持；不支持当作用户没设，保持原行为）
var userCfg = function () {
  // 优先读页面里的 <script id="wm-user" type="application/json">（快捷指令用 replaceText 注入）。
  // 若快捷指令是旧版、没替换这个占位符 ⇒ JSON.parse 抛错 ⇒ 退回 {}（只是没有兜底值/开关，不会整页语法错）。
  var el = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('wm-user') : null;
  if (el) {
    try {
      var o = JSON.parse(el.textContent || '{}');
      if (o && typeof o === 'object') return o;
    } catch (e) { /* 旧版快捷指令：忽略 */ }
  }
  return (typeof USER !== 'undefined' && USER && typeof USER === 'object') ? USER : {};
};
var userCap = function (k) { return (CONFIG.userConfig || {})[k] === true; };
var userStr = function (key) {
  var v = userCfg()[key];
  if (typeof v === 'string') return v.trim();
  return (typeof v === 'number') ? String(v) : '';
};
var userBool = function (key) {           // 词典里的开关（Shortcuts 布尔经 JSON 过来就是 true/false）
  var v = userCfg()[key];
  return (v === true || v === 1 || v === '1' || v === 'true');
};
var userGroup = function (group, k) {     // 词典里的分组（「拍摄参数」「经纬度」）
  var g = userCfg()[group];
  if (!g || typeof g !== 'object') return undefined;
  var v = g[k];
  return (v === undefined || v === null || v === '') ? undefined : v;
};
var userGroupStr = function (group, k) {  // 分组里的文本项（如 exif.text / location.text）
  var v = userGroup(group, k);
  return (typeof v === 'string') ? v.trim() : (typeof v === 'number' ? String(v) : '');
};
// 兜底值：model / date 在顶层；focal·aperture·speed·iso 在 exif 分组；latitude·longitude 在 location 分组
var userFbVal = function (k) {
  if (k === 'model' || k === 'date') {
    var v = userCfg()[k];
    return (v === undefined || v === null || v === '') ? undefined : v;
  }
  if (k === 'latitude' || k === 'longitude') return userGroup('location', k);
  return userGroup('exif', k);
};
var userShowDate = function () {          // showDate 开关（款式不支持就不生效）
  return userCap('date') ? (userCfg().showDate !== false) : true;
};
var userShowLocation = function () {      // showLocation 开关：false ⇒ 经纬度整行隐掉（含自定义文本）
  return userCfg().showLocation !== false;
};
// 自定义文本：★没有开关★ —— 有值就用（外加款式支持），空值自然不生效
var userExifText = function () {
  if (!userCap('exifText')) return '';
  return userStr('exifText');
};
var userLocText = function () {
  if (!userCap('locationText')) return '';
  return userStr('locationText');
};
// 兜底值：用户词典优先（preset 里已不再写 fallback，这句是给旧数据留的最后兼容）
var fbVal = function (k) {
  var v = userFbVal(k);
  return (v !== undefined) ? v : (CONFIG.fallback || {})[k];
};

// 兜底日期：支持 ①"now"（= 渲染时刻）②ISO8601（2026-10-14T22:41:22+08:00）
//            ③任何 new Date() 能解析的格式；解析不了（含 "2026年10月14日 下午10:39" 这种本地化串、
//            以及 "{CurrentDate}" 这类变量占位符）⇒ 一律退回渲染时刻，绝不报错/出空。
var fbDate = function () {
  var fb = fbVal('date');
  if (fb === undefined || fb === null) return null;
  var s = String(fb).trim();
  if (!s || s.toLowerCase() === 'now') return null;
  if (s.charAt(0) === '{' || s.charAt(0) === '@') return null;   // 变量占位符
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};
var fmtTime = function (iso, pattern) {
  if (!userShowDate()) return '';          // 用户关了日期 ⇒ 时间节点整块隐藏（05-layout 的 optional 塌陷）
  var d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) d = fbDate();     // 照片里没日期 ⇒ 读兜底日期
  if (!d || isNaN(d.getTime())) d = new Date();   // 兜底也没有/解析不了 ⇒ 渲染时刻
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
  // "有定位" = 照片有经纬度、或用户指定了自定义文本/兜底经纬度（快捷指令侧同口径判定，决定版式与带高）
  if (!userShowLocation()) return false;   // 用户关掉定位行 ⇒ 一律按"无定位"排版
  if (userLocText()) return true;
  if (CONFIG.lat != null && CONFIG.lat !== '' && CONFIG.lon != null && CONFIG.lon !== '') return true;
  return userFbVal('latitude') !== undefined && userFbVal('longitude') !== undefined;
};
var latlng = function () {             // 单行，纬经之间【两个空格】（模板不拆行）
  if (!userShowLocation()) return '';  // showLocation=false ⇒ 整行为空 ⇒ optional 节点塌陷（隐掉）
  var t = userLocText();               // 1) 自定义文本（如"九州歌盛世"）
  if (t) return t;
  var lat = CONFIG.lat, lon = CONFIG.lon;
  if (lat == null || lat === '' || lon == null || lon === '') {   // 2) 照片实际值 → 3) 词典兜底值
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
// 取值链：运行时值 → 用户词典兜底值 → NaN/空（截图、无 EXIF、无机型都不会空/出错）
var pickNum = function (k) {
  var n = numValue(CONFIG[k]);
  if (isFinite(n) && n > 0) return n;
  var f = numValue(fbVal(k));
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
      case 'model':      return CONFIG.model || fbVal('model') || '';
      case 'series':     return CONFIG.model || fbVal('model') || '';                  // APK: @{series} = 机型串
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

// 40-draw: view 树 → canvas 绘制 → 页面里唯一的一个 <img>
// 为什么要有这一层（根因）：快捷指令的取图动作 is.workflow.actions.detect.images 是从页面内容里
// 【提取图像】，不是给页面截图。AlphaTest 4 能取到透明 PNG，是因为它的页面 JS 把结果画进 <canvas>，
// 再 document.body.appendChild(new Image()).src = canvas.toDataURL('image/png')
// ⇒ 页面里恰好有一个 <img>，其 src 是带 alpha 的成品 PNG。
// 我们原来是 DOM+CSS（div/span + 内联 SVG），页面里没有任何 <img> ⇒ 提取不到 ⇒ 白底 / 叠放报
// "变量不包括要叠放的图像"。所以渲染结果必须变成"页面里唯一的一个 <img>"。
//
// 布局坐标不由本层负责：05-layout 的 measure/place/lgFlatten 已经给出每个节点的绝对像素
// （v.ax / v.ay / v.w / v.h），这里只做绘制。

// CSS 语义的角度 → canvas 线性渐变的起终点
// CSS：0deg = 朝上、90deg = 朝右（顺时针）；渐变线长 = |w·sinθ| + |h·cosθ|（规范公式）
// 之前用 (|w·dx|+|h·dy|)/2，水平场景（90deg）恰好等价，45deg 的分隔线只有一半长 ⇒ 取色偏差
var wmGradAxis = function (deg, x, y, w, h) {
  var th = deg * Math.PI / 180;
  var dx = Math.sin(th), dy = -Math.cos(th);
  var cx = x + w / 2, cy = y + h / 2;
  var len = Math.abs(w * Math.sin(th)) + Math.abs(h * Math.cos(th));
  var hx = dx * len / 2, hy = dy * len / 2;
  return [cx - hx, cy - hy, cx + hx, cy + hy];
};

// 前景渐变（文字/分隔线都用它）：CSS `linear-gradient(<direction>, A <stop>, B)` 的语义是
//   · 0% → stop%：纯 A（第一个颜色位置之前都是它）
//   · stop% → 100%：A → B 渐变
// 早先写成 A@0 / B@stop / B@1，等于 0→stop 一直在 A→B 插值 ⇒ 分隔线取色偏
var wmForeground = function (ctx, x, y, w, h) {
  var deg = parseFloat(APP('foreground-direction', '90deg'));
  if (!isFinite(deg)) deg = 90;
  var a = wmGradAxis(deg, x, y, w, h);
  var g = ctx.createLinearGradient(a[0], a[1], a[2], a[3]);
  var start = APP('foreground-start', '#000000');
  var end = APP('foreground-end', start);
  var stop = parseFloat(APP('foreground-stop', '0%'));
  if (!isFinite(stop)) stop = 0;
  stop = Math.min(0.999, Math.max(0, stop / 100));
  // ★ 颜色必须过 lgCssColor：preset 是 #AARRGGBB（Android 口径），canvas 只认 #RRGGBB/#RRGGBBAA。
  //   颜色自带的 alpha 不在这里用（它由 lgTextAlpha/lgFillAlpha 取出来当 globalAlpha，见 05-layout）。
  g.addColorStop(0, lgCssColor(start));
  if (stop > 0) g.addColorStop(stop, lgCssColor(start));
  g.addColorStop(stop, lgCssColor(end));
  if (stop < 1) g.addColorStop(1, lgCssColor(end));
  return g;
};

// ctx.font 的字族处理（踩坑）：
//  1) 含空格的族名必须加引号；
//  2) -apple-system / BlinkMacSystemFont / system-ui / ui-* 是【CSS 专有关键字】，canvas 的
//     ctx.font 不接受它们；一旦出现，整条 font 声明解析失败 ⇒ Chrome 保留上一次的字体
//     （默认 10px）⇒ 文字画出来只有一半大、测宽也偏小（真机与本地校验都会中招）。
//     所以这里把 CSS 专有关键字过滤掉，只留真实族名与通用族。
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

// 字重映射（唯一口径：05-layout 的测宽与这里的绘制都必须走它，否则"量的宽度"和"画的字形"不是一个字重）：
//   canvas 的 ctx.font 只认 100..900 的【百位档】，静态字体（Helvetica Neue / SF）也不吃 wght 变体轴
//   （把 501/451/620 这类数值写进去只会按 CSS 字重匹配规则落到 Medium/Bold 等固定字面 ⇒ 观感偏粗）。
//   取数优先级：font['design-weight']（= APK wmRes.fonts.*.variation 的 'wght' N，权威设计值）
//              → font['font-weight']（apk2preset 的手工档位 620/550/500，只用于没有 design-weight 的旧 preset）。
//   ★ 收敛方向 = 【向下取整到百位档】，不是就近四舍五入：我们的系统字体在同一档位上比 MiSans VF 观感更重，
//     就近取整会把设计值 451 抬到 500 ⇒ 日期/经纬度行跟机型行一样粗（用户反馈"字重太大"）；
//     而参考配置里第二行本就比第一行细（MiSans 451 vs 501）。
//   同文案/同尺度的并排对照见 _local/stroke_vs_ref.png：机型行 501↔500 吻合、第二行 451↔400 吻合。
//     映射表：401→400、451→400、501→500、550→500、620→600（下限 100，上限 900）
var wmFontWeight = function (f) {
  var raw = (f && typeof f === 'object')
    ? ((f['design-weight'] != null && f['design-weight'] !== '') ? f['design-weight'] : f['font-weight'])
    : f;
  var n = parseFloat(raw);
  if (!isFinite(n) || n <= 0) return 400;
  return Math.max(100, Math.min(900, Math.floor(n / 100) * 100));
};
var wmFontStr = function (f, sizePx) {
  return wmFontWeight(f) + ' ' + sizePx + 'px ' + wmFontFam(f['font-family']);
};

// text-shadow: "0 1px 1px #80000000" / "0px 1px 2px rgba(0,0,0,.6)" → ctx.shadow*
// 单位可省（preset 里就是 "0 1px 1px …"）
var wmShadow = function (ctx, css) {
  ctx.shadowOffsetX = ctx.shadowOffsetY = ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0,0,0,0)';
  if (!css) return;
  var m = String(css).match(/(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(.+)$/);
  if (!m) return;
  ctx.shadowOffsetX = parseFloat(m[1]);
  ctx.shadowOffsetY = parseFloat(m[2]);
  ctx.shadowBlur = parseFloat(m[3]);
  ctx.shadowColor = m[4].trim();
};

// 文本：逐字绘制以复刻 letter-spacing（10-style 的 CSS 和 05-layout 的 lgTextWidth 都是
// "measureText + 每字符补一个 letterSpacing"，逐字推进才能与布局宽度一致）
var wmDrawText = function (ctx, v) {
  if (!v._t || !v._text) return;
  var f = v._t.font, sizePx = v._t.sizePx;
  ctx.save();
  ctx.font = wmFontStr(f, sizePx);
  ctx.textBaseline = 'alphabetic';
  // 文字透明度 = 颜色自带的 alpha × font.opacity（两个独立来源，同时存在就【相乘】）：
  //   颜色 alpha：@foreground=N → 选中样式声明的第 N 个槽位（styles.foreground-slots[N]；
  //   莱卡 1 号浅色款 f2 = @foreground=2 ⇒ 50% 黑，以前被忽略 ⇒ 日期/经纬度那行偏深）；
  //   #AARRGGBB / @color=#AARRGGBB → 颜色通道里的 alpha。
  //   font.opacity：字体对象上的显式不透明度（目前 preset 未用，保留语义）。
  var ca = lgTextAlpha(f.color, CONFIG.appearance);
  if (f.opacity != null) ca *= parseFloat(f.opacity);
  ctx.globalAlpha = isFinite(ca) ? Math.max(0, Math.min(1, ca)) : 1;
  wmShadow(ctx, f.shadow);
  var ls = (parseFloat(f['letter-spacing']) || 0) * sizePx;
  var lines = String(v._text).split('\n');
  var lh = v._t.lh || sizePx;
  // 复刻 CSS 的 half-leading：行盒高 lh，字形盒高 (ascent+descent) 居中 ⇒ 基线 = 顶 + (lh-(a+d))/2 + a
  var mm = ctx.measureText('Hg');
  var asc = mm.fontBoundingBoxAscent, desc = mm.fontBoundingBoxDescent;
  if (asc == null || !isFinite(asc)) { asc = sizePx * 0.8; desc = sizePx * 0.2; }
  if (desc == null || !isFinite(desc)) desc = sizePx * 0.2;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var x = v.ax;
    var y = v.ay + lh * i + (lh - (asc + desc)) / 2 + asc;
    // ★渐变的"作用框"= 从本节点左边缘起算、宽度撑到整条水印带★（不是节点自己的紧框）。
    //   对齐 V11 的机制：它把渐变挂在很宽的 flex 容器上（background-clip:text 裁成文字），
    //   每个元素各自从自己的左边缘开始 ⇒ 文字基本落在 0~30% 的"纯 start 色"区，看起来是柔和的纯色。
    //   我们以前用文字紧框 ⇒ 45°（玫瑰金）会在每个字内部斜切，又乱又脏；
    //   改成宽框后，只有 start≠end 的款式（当前 = rose）视觉变化；gold/dark/light/red 两个 stop 同色，逐像素不变。
    var gradW = (typeof BAND_PX_W === 'number' && isFinite(BAND_PX_W) && BAND_PX_W > 0)
      ? Math.max(v.w || 1, BAND_PX_W - v.ax) : (v.w || 1);
    ctx.fillStyle = wmForeground(ctx, v.ax, v.ay, gradW, lh);    if (ls <= 0.001) { ctx.fillText(line, x, y); continue; }
    for (var c = 0; c < line.length; c++) {
      var ch = line.charAt(c);
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + ls;
    }
  }
  ctx.restore();
};

// 分隔线等：节点自身带 @foreground 填充 ⇒ 用【样式前景色 + 该样式第 N 个槽位的 alpha】铺（与参考实现
// resolve_color 一致：参考件就是把 @foreground=N 解析成一个带 alpha 的纯色）。alpha 的推导与
// "为什么不另乘别的透明度" 见 10-style.js 的 lgFillAlpha 注释。
// 两张来源都是"纯色 + 独立 alpha"：颜色串只留 RGB（lgCssColor 会把颜色自带的 alpha 也带进去，
// 这里再被下面的 globalAlpha 乘一次就是双层 alpha ⇒ 偏暗，所以 fillStyle 用 lgCssColor 的结果、
// alpha 统一由 fill.alpha 给）。
var wmDrawFill = function (ctx, v) {
  var fill = fillFor(v);
  if (!fill || !fill.foreground) return false;
  ctx.save();
  if (fill.alpha != null) ctx.globalAlpha = Math.max(0, Math.min(1, fill.alpha));
  ctx.fillStyle = lgCssColor(APP('foreground-start', '#000000'));
  ctx.fillRect(v.ax, v.ay, v.w, v.h);
  ctx.restore();
  return true;
};

// 底色：stitch(拼接)款样式有底色 ⇒ 铺满画布；overlay(叠加)款是 transparent ⇒ 不铺（保住 alpha）
var wmDrawBackdrop = function (ctx, W, H) {
  var bgc = String(APP('background-color', '')).trim();
  if (!bgc || bgc === 'transparent' || bgc === 'none') return;
  ctx.save();
  ctx.fillStyle = lgCssColor(bgc);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

// 背景图（样式里的 background-image）：cover / stretch / repeat，复用模板原有的 bg-fit 语义
var wmDrawBgImage = function (ctx, W, H, img) {
  if (!img || !img.width || !img.height) return;
  var fit = APP('background-fit', 'cover');
  ctx.save();
  if (fit === 'stretch') {
    ctx.drawImage(img, 0, 0, W, H);
  } else if (fit === 'repeat') {
    var rh = H, rw = img.width * (H / img.height);
    for (var x = 0; x < W; x += rw) ctx.drawImage(img, x, 0, rw, rh);
  } else {                                  // cover：等比铺满、居中裁切
    var sc = Math.max(W / img.width, H / img.height);
    var dw = img.width * sc, dh = img.height * sc;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  ctx.restore();
};

// 品牌标（内联 SVG）：先用 05/20 同一套渐变规则上色，再转成 data URI 交给 <img> 光栅化
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
  paintGradient(inner);
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

// 绘制整棵树：底色 → 背景图 → 各节点（分隔线/文字/logo）
// 返回 Promise，完成后 canvas 上就是最终像素
var wmPaint = function (L, canvas) {
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;

  // 背景图：BG_URI 是纯 base64（真机）或完整 data URI（本地校验/历史版本）
  var raw = (typeof BG_URI === 'string') ? BG_URI : '';
  var uri = raw.length > 64 ? (raw.indexOf('data:') === 0 ? raw : 'data:image/png;base64,' + raw) : '';
  var views = L.views || [];
  var logos = {}, bgImg = null;

  // 完整绘制（z 序：底色 → 背景图 → 其余节点）
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

  // ★ 第一遍（同步）：不需要图片资源的部分先画完，并【同步发布】页面里那个 <img>。
  //   原因：取图动作 detect.images 是"从页面内容里提取图像"，页面加载完成那一刻就必须存在合法 <img>；
  //   若等到 Promise（logo/背景图异步加载）才创建，真机很可能在它出现前就取过图 ⇒ 取不到/白底。
  drawAll();
  var published = wmPublish(canvas);

  // 第二遍（异步）：logo 与背景图就绪后完整重绘，并更新已发布 <img> 的 src。
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

// 把 canvas 变成页面里唯一的一个 <img>：detect.images 提取的就是它
// 发布后把 canvas 藏起来：页面（以及本地校验的截图）显示的就是这张成品图，
// 避免"canvas + img 叠在同一位置"把半透明像素合成两次。
var wmPublish = function (canvas) {
  // 尺寸自检（硬要求）：detect.images 提取的是 <img> 的自然尺寸，下游 resizeImageByLongestEdge(…, photoWidth)
  // 依赖它恰好等于 BAND_W×BAND_H。若不等就写进 #wm-error —— 本地校验与真机都会立刻看到，
  // 避免"校验全绿、真机尺寸错"这种沉默失败。
  // 口径 = 整数像素、向下取整（见 index.html.txt）：用原始 BAND_H 比会把 180.5 vs 180 误报成尺寸错。
  var expW = (typeof BAND_PX_W === 'number') ? BAND_PX_W
           : ((typeof BAND_W === 'number' && isFinite(BAND_W)) ? Math.max(1, Math.floor(BAND_W)) : 0);
  var expH = (typeof BAND_PX_H === 'number') ? BAND_PX_H
           : ((typeof BAND_H === 'number' && isFinite(BAND_H)) ? Math.max(1, Math.floor(BAND_H)) : 0);
  var okSize = (expW > 0 && expH > 0) ? (canvas.width === expW && canvas.height === expH) : true;
  if (!okSize) {
    var box0 = document.getElementById('wm-error');
    if (box0) {
      box0.style.display = 'block';
      box0.textContent = 'watermark error: canvas size ' + canvas.width + 'x' + canvas.height +
                         ' != BAND ' + expW + 'x' + expH;
    }
  }
  var img = document.getElementById('wm-out');
  if (!img) {                       // 幂等：绝不产生第二个 #wm-out（detect.images 需要页面里恰好一个图）
    img = new Image();
    img.id = 'wm-out';
    img.setAttribute('data-wm-out', '1');
    document.body.appendChild(img);
  }
  img.width = canvas.width;
  img.height = canvas.height;
  img.setAttribute('data-wm-size', canvas.width + 'x' + canvas.height);   // 供 local_verify 从 DOM dump 断言
  img.src = canvas.toDataURL('image/png');
  canvas.style.visibility = 'hidden';
  return img;
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
    //    foreground-slots 是 @foreground=N 的透明度槽位数组（见 core/05-layout lgForegroundAlpha）：
    //    选中样式的整份词典都在这里落地，缺了它就把槽位悄悄丢了。
    var ap = CONFIG.appearance = CONFIG.appearance || {};
    var APP_KEYS = ['foreground-start','foreground-end','foreground-stop','foreground-direction',
                    'foreground-slots',
                    'line-opacity','background-color','background-image','background-fit','text-shadow'];
    for (var a = 0; a < APP_KEYS.length; a++) {
      var ak = APP_KEYS[a];
      if (OVERRIDE && OVERRIDE[ak] !== '' && OVERRIDE[ak] != null) ap[ak] = OVERRIDE[ak];
    }
    var st = document.documentElement.style;
    // overlay(叠加)类模板：整页必须透明 —— 不能落回 #FFFFFF 默认值（否则水印层铺满画布 = 白底）
    var __bgc = APP('background-color', '#FFFFFF');
    if (CONFIG.compose && CONFIG.compose.mode === 'overlay') __bgc = 'transparent';
    st.setProperty('--background-color', __bgc);
    st.setProperty('--foreground-start', APP('foreground-start', '#000000'));
    st.setProperty('--foreground-end', APP('foreground-end', APP('foreground-start', '#000000')));
    st.setProperty('--foreground-stop', APP('foreground-stop', '0%'));
    st.setProperty('--foreground-direction', APP('foreground-direction', '90deg'));

    // 纯 canvas 直绘：页面里【没有任何布局 DOM 盒子】（#wm-root 已删除）。
    // 底色 / 背景图 / 文字 / 分隔线 / logo 全部由 40-draw.js 按布局树的绝对坐标画进 #wm-canvas，
    // 再把 canvas 发布成页面里唯一的一个 <img>（取图动作 detect.images 靠提取这个 <img>）。

    // 3) 选 layout 变体 —— 变体名是一套固定词汇（build.py 会校验，两个 preset 必须一致）：
    //      layout = 有定位用的版式；layout_loc_off = 无定位用的版式；
    //      单变体 preset 只写 layout（= 两种定位共用同一版式，bandDpGps = bandDpLocOff）。
    //    以前对"非常规命名"（如 91 号的 center_top）用 names[0] 兜底，那是在迁就两个 preset
    //    命名不一致；现在 preset 已统一成 layout/layout_loc_off，兜底删除：不满足契约就报错。
    var gps = hasGps(), variants = CONFIG.layout_group || [], pick = null, pickName = '';
    var names = [];
    for (var v = 0; v < variants.length; v++) names.push(Object.keys(variants[v])[0]);
    var want = gps ? 'layout' : 'layout_loc_off';
    if (names.indexOf(want) >= 0) pickName = want;
    else if (names.length === 1) pickName = names[0];   // 单变体：有/无定位共用同一版式
    if (!pickName) throw new Error('layout_group 缺少变体 ' + want + '（多变体 preset 必须同时给 layout 与 layout_loc_off）');
    for (var w = 0; w < variants.length; w++) {
      if (Object.keys(variants[w])[0] === pickName) { pick = variants[w][pickName]; break; }
    }
    if (!pick) throw new Error('layout_group 为空');

    // 4) 通用布局引擎：measure/place（绝对坐标）→ 布局树（【不建任何 DOM】）。文字被挤时按比例缩字号重排（幂等）
    var renderPass = function (sizeScale) {
      return lgLayout(pick, sizeScale);
    };
    // 防挤压（本项目兜底；小米引擎无此逻辑）：同一行内，若左侧内容压进了右侧"脱离流"的兄弟
    // （right/center gravity，位置由父容器固定）所占区域，就按【可用空间】缩字号重排。
    // 三条判据都是踩过的坑：
    //   ① 必须两轴相交：只比 x 会把同一列上下两个 band 的兄弟误判（曾把 91 整层缩到 0.4 下限）
    //   ② 整行叠加层（layout_width=match_parent，如 91 的 right_bottom_group）设计如此，不参与。
    //      ★判据看【声明】不看几何★：原来是"几何上 b 完全包住 a 就当叠加层跳过"，右组一旦过宽
    //      （b.ax < a.ax）就会被误判成叠加层、整条判据跳过 ⇒ 布局已经坏掉却没人报错
    //      （实测 max_width=0 + 12.8:1 词标：logo 819×64、b.ax=-218、logo 出画布，fitted 仍是 False）。
    //   ③ 因子用 avail = b.ax - gap - a.ax 算，而不是两盒跨度 span —— span 里混进很宽的右组会把
    //      因子算得极轻（long_model 只缩 0.6%，依然压住 logo，实测报"logo 会贴住机型文字"）
    var LG_GUARD_GAP_DP = 24;   // 安全间隙(dp)：机型文字与右组至少留 24dp（harness 断言 ≥20dp，余 4dp）
    var overlapFactor = function (L) {
      var worst = 1, gapPx = LG_GUARD_GAP_DP * CONFIG.unit;
      var walk = function (v) {
        if (v.type === 'Layout' && v.orientation === 'horizontal') {
          var vis = [];
          for (var i = 0; i < v.children.length; i++) {
            var c = v.children[i];
            if (c.enabled && c.w > 1) vis.push(c);
          }
          for (var j = 1; j < vis.length; j++) {
            var a = vis[j - 1], b = vis[j];
            // ① 同一行
            if (!(a.ay < b.ay + b.h - 0.5 && b.ay < a.ay + a.h - 0.5)) continue;
            // ② 整行叠加层不参与（按声明判据）
            if (b.lw && b.lw.v === LG_MATCH) continue;
            // ③ b 在右侧且 a 挤进了它前面的安全间隙 ⇒ 按可用空间缩
            var avail = b.ax - gapPx - a.ax;
            if (avail > 0.5 && a.w > avail + 0.5) {
              var f = Math.max(0.4, avail / a.w);
              worst = Math.min(worst, f);
              // 诊断：记录被判挤压的一对（写进 #wm-error，verify91/local_verify 都能看到）
              if (!window.__WM_OVERLAP) window.__WM_OVERLAP = [];
              if (window.__WM_OVERLAP.length < 8) {
                window.__WM_OVERLAP.push((v.id || '?') + ': ' + (a.id || '?') + '(' + a.ax.toFixed(1) + '+'
                  + a.w.toFixed(1) + ',y' + a.ay.toFixed(1) + ')' + ' × ' + (b.id || '?') + '(' + b.ax.toFixed(1)
                  + ',y' + b.ay.toFixed(1) + ')' + ' avail=' + avail.toFixed(1) + ' f=' + f.toFixed(3));
              }
            }
          }
        }
        for (var m = 0; m < v.children.length; m++) walk(v.children[m]);
      };
      for (var t = 0; t < L.tree.length; t++) walk(L.tree[t]);
      return worst;
    };
    // 防挤压第一道（B：行内让位）：与 overlapFactor 同一套 a/b 判据，但【先让自适应宽度的图片让位】——
    // 文字保持设计字号。overflow = a 右缘(+安全间隙) 越过 b 左缘多少 ⇒ b 里最宽的那张 auto 宽度图片
    // 按这个量缩宽、高等比跟着缩；缩到 LG_IMG_FLOOR 还不够，才交给 overlapFactor 缩字号兜底。
    // ★预算必须是布局期算出来的（真实剩余宽度），不能写静态常量★ —— 这正是已删的"高度 × 2"的根本毛病：
    //   它跟行内容宽、跟兄弟们的实际宽度都无关，所以宽字标只能被砍高度。
    // 幂等：因子存在树外的 LG_IMG_FIT（见 05-layout），每轮 renderPass 从标称尺寸重排后再算。
    var lgFitImages = function (L) {
      var changed = false, gapPx = LG_GUARD_GAP_DP * CONFIG.unit;
      var widestAutoImage = function (n, best) {
        if (n.type === 'ImageView' && n.enabled && n.dw && (n.dw.v === 0 || n.dw.v === LG_WRAP) &&
            n.w > (best ? best.w : 0)) best = n;
        for (var k = 0; k < (n.children || []).length; k++) best = widestAutoImage(n.children[k], best);
        return best;
      };
      var walk = function (v) {
        if (v.type === 'Layout' && v.orientation === 'horizontal') {
          var vis = [];
          for (var i = 0; i < v.children.length; i++) {
            var c = v.children[i];
            if (c.enabled && c.w > 1) vis.push(c);
          }
          for (var j = 1; j < vis.length; j++) {
            var a = vis[j - 1], b = vis[j];
            if (!(a.ay < b.ay + b.h - 0.5 && b.ay < a.ay + a.h - 0.5)) continue;   // ① 同一行
            if (b.lw && b.lw.v === LG_MATCH) continue;                             // ② 整行叠加层
            var overflow = (a.ax + a.w + gapPx) - b.ax;                            // ③ 压进安全间隙多少
            if (overflow <= 0.5) continue;
            var img = widestAutoImage(b, null);
            if (!img) continue;                                                    // b 里没图片 ⇒ 交给缩字号
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
        for (var m = 0; m < v.children.length; m++) walk(v.children[m]);
      };
      for (var t2 = 0; t2 < L.tree.length; t2++) walk(L.tree[t2]);
      return changed;
    };
    // 4a) 渲染遥测：页面已无任何布局 DOM，校验需要的版式数据（boxes/texts/fontsize/…）
    //     由布局树暴露到 window.__WM_TELEMETRY，字段名与旧 DOM 探测保持一致。
    var emitTelemetry = function (L2, isFitted) {
      var boxes = {}, texts = {}, fontsize = {}, strokes = 0, shapes = 0, seen = {};
      for (var i = 0; i < L2.views.length; i++) {
        var v = L2.views[i];
        if (!v || !v.id) continue;
        var id = seen[v.id] ? (v.id + '#' + i) : v.id;
        seen[v.id] = true;
        boxes[id] = { x: v.ax, y: v.ay, w: v.w, h: v.h };
        if (v._text != null) texts[id] = v._text;
        if (v._t && v._t.font) fontsize[id] = { size: v._t.sizePx, font: v._t.font['font-family'] };
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
        // 带尺寸用整数像素、向下取整（口径见 index.html.txt）：校验脚本的 band_h 来自 wm_plan 的
        // int(renderHeight)，两边必须一致，否则真机"页面 BAND 180.5 vs 成品 180"会被判成尺寸错。
        band: Math.max(1, Math.floor(BAND_W)) + 'x' + Math.max(1, Math.floor(BAND_H)),
        root: { clientWidth: Math.floor(BAND_W), scrollWidth: Math.floor(BAND_W), h: Math.floor(BAND_H) }
      };
      return window.__WM_TELEMETRY;
    };

    // 布局 + 防挤压（同一水平容器【同一行内】相邻子项两轴都重叠 ⇒ 缩字号重排）。
    // 注意：首次执行时 webfont 可能还没就绪，measureText 会落到回退字体、测得的宽度偏窄；
    // 因此 document.fonts.ready 之后必须【重新布局 + 刷新遥测 + 重绘】（否则校验读到过时数据、画布也偏窄）。
    var layoutOnce = function () {
      var scale = 1, Lx = renderPass(scale), fx = false;
      // 先让图片让位（线性收敛，两趟内停）：让位后文字一般一个像素都不用动，也就不会触发下面的缩字号。
      for (var ip = 0; ip < 3; ip++) { if (!lgFitImages(Lx)) break; Lx = renderPass(scale); }
      for (var pass = 0; pass < 3; pass++) {
        var f = overlapFactor(Lx);
        if (f >= 0.999) break;
        var next = Math.max(0.4, f);              // 单轮因子（每轮从标称尺寸重排），硬下限 0.4
        if (fx && next > scale - 0.001) break;    // 不再变好就停，避免用更大的因子重排反而又重叠
        scale = next; fx = true;
        Lx = renderPass(scale);
      }
      // 自检：只有在【逼近硬下限】时才判定为守卫误判（真机表现为整层文字骤小、版式全错）。
      // 注意不能用 "<0.95 一律复位"：long_model 这类"长机型号 + 右侧 logo"的用例本来就
      // 需要缩到 ~0.9 才能留出间隙，复位成 1 反而让两者重叠（实测该用例会因此报错）。
      var eb = document.getElementById('wm-error');
      if (scale <= 0.45) {
        var diag = 'GUARD-MISJUDGE scale=' + scale.toFixed(3)
          + (window.__WM_OVERLAP && window.__WM_OVERLAP.length ? ' | ' + window.__WM_OVERLAP.join(' || ') : '');
        window.__WM_GUARD_MISJUDGE = diag;
        scale = 1; fx = false; Lx = renderPass(1);
        if (eb) { eb.style.display = 'block'; eb.textContent = diag; }
      } else if (eb && /^GUARD-MISJUDGE/.test(eb.textContent || '')) {
        // 本轮没误判：清掉上一轮（字体就绪前）留下的守卫告警，避免陈旧信号
        eb.textContent = ''; eb.style.display = 'none';
      }
      return { L: Lx, fitted: fx };
    };
    var first = layoutOnce();
    var L = first.L, fitted = first.fitted;
    emitTelemetry(L, fitted);

    // 4b) 画布发布：把同一棵布局树画进 #wm-canvas，再让 canvas 变成页面里【唯一的一个 <img>】。
    //     取图动作 is.workflow.actions.detect.images 是从页面内容里提取图像（不是截图），
    //     只有存在这个 <img> 才能拿到带 alpha 的成品（见 40-draw 顶部说明）。
    var canvas = document.getElementById('wm-canvas');
    var paint = function (L2) {
      if (!canvas || typeof wmPaint !== 'function') return;
      var old = document.getElementById('wm-out');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      try {
        wmPaint(L2, canvas).then(function () { wmPublish(canvas); });
      } catch (e) { fail(e && e.message ? e.message : String(e)); }
    };
    paint(L);
    // 首次（同步）布局可能发生在 webfont 就绪前 ⇒ 宽度偏窄、遥测是过时数据。
    // __WM_FINAL 是给校验用的"最终态"信号：只有 fonts.ready 之后的重排完成才置位，
    // 校验探针必须等到它再读数（否则会读到字体就绪前的旧版式 —— 实测过这种偶发）。
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () {
        try {
          var again = layoutOnce();      // 字体就绪后重新测量（宽度会变）⇒ 遥测与画布一起刷新
          L = again.L; fitted = again.fitted;
          emitTelemetry(L, fitted);
          paint(L);
        } catch (e) {}
        window.__WM_FINAL = true;
      });
    } else {
      window.__WM_FINAL = true;
    }
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
})();
