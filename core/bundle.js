// 00-util: 基础工具 —— 页面错误上报 + 选中样式取值。
//
// 单位链：unit = min(照片宽,照片高) / designShort（快捷指令按 preset.metadata.designShort 算好，
//   经 @@UNIT@@ 注入 CONFIG.unit）。不除 dpr：真机按请求点数出图，再放大 dpr 倍只会把字与
//   logo 弄糊（踩坑 §9.1b）。WebView 里 1 CSS px = 1 pt ⇒ dp × unit = px。
//
// 选中样式：CONFIG.appearance 是 90-boot 从 OVERRIDE（模板注入的选中样式 JSON）按规范 9 键抄出的
//   一份，键名 = preset 里 styles.<款式> 的字段名；APP(k) 是它唯一的读取入口。
//   这里不给缺键默认值：9 键齐全由构建期逐键校验（build.py 样式键 ↔ APP_KEYS 双向对账），
//   运行时缺键会直接暴露成空颜色 / NaN，而不是被一个"看起来正常"的默认值盖住。
var APP = function (k) {
  var a = CONFIG.appearance || {};
  return a[k];
};

// 错误上报：写进模板里的隐藏容器 #wm-error —— 用户看得到，校验脚本也从 DOM 里读它。
// 正常渲染时它必须保持空（verify91 把"探针报错非空"判为失败）。
var wmError = function (msg) {
  var b = document.getElementById('wm-error');
  if (b) { b.style.display = 'block'; b.textContent = 'watermark error: ' + msg; }
};

// 05-layout: 布局引擎（纯几何）—— 1:1 复刻小米 APK 水印模板的布局模型（p880yu 规则）。
// 规范来源：/Users/alex.long/小米/leica_watermark_replica.py（Dim/px/parse_gravity/measure/place）
//   · 尺寸：match_parent / wrap_content / Ndp / Npx / N%w / N%h
//   · gravity 位标志：1=top 2=bottom 4=left 8=right 16=center_vertical 32=center_horizontal 48=center
//   · 流式容器：水平 Σ(子宽+margin_left) 高=max(子高+margin_top)；垂直反之；overlap 两轴独立
//   · 仅"宽度确定"的容器内，水平 right/center 才脱离流绝对定位；垂直方向同理（高度确定）
//   · 交叉轴一律按 gravity 在容器内容盒里摆
//   · 本项目扩展：容器 padding_*（内容盒内缩）
// 本文件只管几何：读视图树字段算尺寸与坐标，外加两道防挤压（lgFitImages / overlapFactor）——
// 它们改的也是布局结果。颜色/透明度在 10-style，文本内容在 30-format，素材与 logo 上色在
// 20-build，像素绘制在 40-draw，编排在 90-boot。
var LG_WRAP_CONTENT = -1, LG_MATCH_PARENT = -2;
var LG_GRAV = { top: 1, bottom: 2, left: 4, right: 8, center_vertical: 16, center_horizontal: 32, center: 48 };
var LG_DIM_RE = /^(-?\d+\.?\d*)(dp|px|sp)$/;
var LG_W_RE = /^(\d+\.?\d*)%?[wW]$/;
var LG_H_RE = /^(\d+\.?\d*)%?[hH]$/;
// 安全间隙(dp)：同一水平行里，左侧内容与右侧"脱离流"的兄弟至少留这么多（harness 断言 ≥20dp，余 4dp）
var LG_GUARD_GAP_DP = 24;

// 节点长度一律是【dim 字符串】（"64dp" / "wrap_content" / "match_parent" / "50%w" / "2px"）：
// 裸数字是同一个概念的第二种写法，build.py 的节点 schema 校验直接拒掉（DIM_GRAMMAR）。
// 缺键/空串返回 wrap_content 是解析器的全域定义，不是给 preset 兜底：键缺失在构建期已经报错，
// 运行期既不猜数值也不抛错（抛错会让真机整页空白）。
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
// dp → px（scale = CONFIG.unit）；px/sp 原样；%w/%h 相对父约束（parent = 父的内容盒尺寸）
var lgPx = function (dim, scale, parent) {
  if (dim.u === 'px' || dim.u === 'sp') return dim.v;
  if (dim.u === '%w' || dim.u === '%h') return (parent || 0) * dim.v / 100.0;
  return dim.v * scale;
};
// margin_*/padding_* 的数值（dp）：非法/缺失/wrap/match = 0；px 与 % 一律按 dp 尺度当数值用
// （模板里这两者极少出现）
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

// ---------------------------------------------------------------- 视图树（preset 节点 → view）
// 节点 schema 只有一套（每份 preset 里同一类型的节点键集合完全一致，build.py 逐节点校验）：
//   Layout   : type id orientation layout_width layout_height gravity margin_left margin_top
//              padding_left padding_top padding_right padding_bottom background optional childViews
//   TextView : type id gravity margin_left margin_top optional text font_ref childViews
//   ImageView: type id gravity margin_left margin_top display_width display_height
//              max_width max_width_ratio path childViews
// 视图上的字段名与 preset 键名一一对应（layout_width / display_height / margin_left / childViews /
// font_ref / max_width / max_width_ratio …），不再另起缩写。除这些字段外只有两类内部值：
//   · 几何：w/h/x/y/ax/ay —— measure/place/flatten 算出来的像素
//   · 缓存：_key（父路径 + 下标，跨重排稳定，供 LG_IMG_FIT 索引）、_svg / _aspect（素材）、
//     textMetrics / textValue（TextView 专用：字体度量与展开后的文本）
// `path` 是图片来源的唯一声明（"photo" = 照片层、"logo" = 品牌标）；id 只当身份（遥测/调试）。
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
      max_width: lgNum(n.max_width),                    // 绝对宽度上限（dp；0dp = 不设该上限）
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

// ---------------------------------------------------------------- 单节点尺寸
// ★行内"图片让位"因子表：key（= 视图的 _key）→ 累计收缩因子（0..1）★
//   放在树外：lgLayout 每趟（每次 renderPass）都重建整棵视图树，因子只有存在树外、按稳定的
//   节点 key 索引，才能被 lgSizeImage 在下一趟重新应用。计算方是下面的 lgFitImages。
var LG_IMG_FIT = {};
var LG_IMG_FLOOR = 0.2;      // 安全网：任何让位都不把图片缩到标称宽度的 20% 以下

// 图片：按 display_width/display_height 与素材宽高比求尺寸（复刻 measure 的 ImageView 分支）
var lgSizeImage = function (v, aspect) {
  var s = CONFIG.unit;
  var displayHeightPixels = (v.display_height.v === LG_WRAP_CONTENT || v.display_height.v === LG_MATCH_PARENT) ? 0 : v.display_height.v * s;
  var displayWidthPixels = (v.display_width.v === LG_WRAP_CONTENT || v.display_width.v === LG_MATCH_PARENT) ? 0 : v.display_width.v * s;
  if (!v.img) { v.w = v.h = 0; v.enabled = false; return; }
  if (displayWidthPixels > 0 && displayHeightPixels > 0) { v.w = displayWidthPixels; v.h = displayHeightPixels; }
  else if (displayHeightPixels > 0) { v.w = displayHeightPixels * aspect; v.h = displayHeightPixels; }
  else if (displayWidthPixels > 0) { v.w = displayWidthPixels; v.h = aspect > 0 ? displayWidthPixels / aspect : 0; }
  else { v.w = v.img.w * s; v.h = v.img.h * s; }   // 两轴都 wrap_content：素材自然尺寸（当前 preset 不出现）
  // ★宽度闸门 = min(max_width_ratio × display_height, max_width)★
  //   两个分量都是每个 ImageView 节点上必写的规范字段（build.py 校验存在与值域），引擎里不留
  //   任何"缺省比例/缺省上限"：max_width 是绝对硬上限（dp，"0dp" = 不设该上限），
  //   max_width_ratio 是宽度 ÷ 显示高度的比例闸门（无量纲，0 = 不限该闸门）。
  //   比例闸门必须存在：display_height 只是"盒子高"，管不住宽度 —— 长字标一旦无人争宽
  //   （竖排 / 行内余量很大）就会膨胀，shoton 78dp 的 SONY 443×78 比 380dp 宽的机型文案还宽。
  //   闸门比例也不能写成引擎常量：它必须逐款可声明。行内真的放不下时，先由 lgFitImages 让
  //   自适应宽度的图片让位（文字保持设计字号），而不是砍高度。
  var maxWidthDp = (v.max_width > 0) ? v.max_width : 0;                                // 绝对硬上限（dp）
  var maxWidthRatio = (v.max_width_ratio > 0) ? v.max_width_ratio : 0;                 // 比例闸门
  var displayHeightDp = (v.display_height && v.display_height.v !== LG_WRAP_CONTENT &&
                         v.display_height.v !== LG_MATCH_PARENT) ? v.display_height.v : 0;
  if (maxWidthRatio > 0 && displayHeightDp > 0) {
    var ratioDp = displayHeightDp * maxWidthRatio;
    maxWidthDp = (maxWidthDp > 0) ? Math.min(maxWidthDp, ratioDp) : ratioDp;
  }
  if (maxWidthDp > 0 && v.w > maxWidthDp * s) { v.w = maxWidthDp * s; v.h = aspect > 0 ? v.w / aspect : v.h; }
  // 行内让位因子（lgFitImages 按真实剩余宽度回填）：宽高一起等比缩，保证素材不变形
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
  if (v.optional && !t) {                       // 可选块（时间/定位）内容为空 ⇒ 整块隐藏，不留空行
    v.enabled = false; v.w = v.h = 0;
    return;
  }
  var lines = String(t).split('\n');
  var w = 0;
  for (var i = 0; i < lines.length; i++) w = Math.max(w, lgTextWidth(lines[i], f, sizePx));
  v.w = w;
  v.h = lineHeight * lines.length;              // 非 optional 的空文本仍占一行高（决定带高恒定）
};

// 可选容器（如 leica91 的 time_layout）：子树里一个非空文本都没有 ⇒ 整块隐藏
var lgAnyText = function (v) {
  if (v.type !== 'TextView') {
    for (var i = 0; i < (v.childViews || []).length; i++) if (lgAnyText(v.childViews[i])) return true;
    return false;
  }
  return !!v.textValue;
};

var _lgCtx = null;
// 测宽：字族/字重必须与 40-draw 的绘制走【同一个】串（wmFontStr → wmFontFam + wmFontWeight），
// 否则"量的宽度"和"画的字形"不是同一个字重。wmFontStr 在 40-draw.js（拼接顺序在 05 之后，
// 本函数是运行时调用，届时已就绪）。字族含空格必须加引号，否则 ctx.font 整条声明解析失败
// （Chrome 退回默认 10px）⇒ 测宽与绘制都偏小。
var lgTextWidth = function (text, font, sizePx) {
  if (_lgCtx == null) _lgCtx = document.createElement('canvas').getContext('2d');
  var ls = parseFloat(font['letter-spacing']) || 0;        // em
  _lgCtx.font = wmFontStr(font, sizePx);
  var w = _lgCtx.measureText(text).width;
  return w + ls * sizePx * String(text).length;            // 与逐字绘制一致：每字符都补一个 letterSpacing
};

// ---------------------------------------------------------------- measure / place / flatten
var lgMeasure = function (v, pw, ph, sizeScale) {
  var s = CONFIG.unit;
  if (v.type === 'Layout') {
    var pcw = (v.layout_width.v !== LG_WRAP_CONTENT && v.layout_width.v !== LG_MATCH_PARENT) ? lgPx(v.layout_width, s, pw) : pw;
    var pch = (v.layout_height.v !== LG_WRAP_CONTENT && v.layout_height.v !== LG_MATCH_PARENT) ? lgPx(v.layout_height, s, ph) : ph;
    for (var i = 0; i < v.childViews.length; i++) lgMeasure(v.childViews[i], pcw, pch, sizeScale);
    if (v.optional && !lgAnyText(v)) {             // 可选容器没有可显示文本（如关掉日期）⇒ 整块隐藏
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
    v.w = w + v.padding_left * s + v.padding_right * s;   // 本项目扩展：内容盒 + padding
    v.h = h + v.padding_top * s + v.padding_bottom * s;
  } else if (v.type === 'ImageView') {
    lgSizeImage(v, v._aspect || 1);
  } else if (v.type === 'TextView') {
    lgTextSize(v, sizeScale);
  }
};

// 摆放：把 v 的子项在 v 的内容盒里摆好（复刻 place()）
var lgPlace = function (v) {
  var s = CONFIG.unit;
  var ox = v.padding_left * s, oy = v.padding_top * s;   // 内容盒原点（本项目扩展）
  var W = v.w - v.padding_left * s - v.padding_right * s, H = v.h - v.padding_top * s - v.padding_bottom * s;
  var defW = (v.layout_width.v === LG_MATCH_PARENT), defH = (v.layout_height.v === LG_MATCH_PARENT);  // 仅 match_parent 才脱离流
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

// 展平成绝对坐标列表（父级偏移累加）：每个节点补上 ax/ay
var lgFlatten = function (v, out, ox, oy) {
  v.ax = ox + v.x; v.ay = oy + v.y;
  out.push(v);
  for (var i = 0; i < v.childViews.length; i++) lgFlatten(v.childViews[i], out, v.ax, v.ay);
};

// ---------------------------------------------------------------- 防挤压（本项目兜底；小米引擎无此逻辑）
// 判据（三条都是踩过的坑）：
//   ① 必须两轴相交：只比 x 会把同一列上下两个 band 的兄弟误判（曾把 91 整层缩到 0.4 下限）
//   ② 整行叠加层（layout_width = match_parent，如 91 的 right_bottom_group）设计如此，不参与 ——
//      判据看【声明】不看几何：几何判据（"b 完全包住 a"）在右组过宽（b.ax < a.ax）时会整条跳过，
//      布局已经坏掉却没人报错
//   ③ 因子按 avail = b.ax - 安全间隙 - a.ax 算，而不是两盒跨度 span（span 里混进很宽的右组会把
//      因子算得极轻，long_model 只缩 0.6%，依然压住 logo）
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
        if (!(a.ay < b.ay + b.h - 0.5 && b.ay < a.ay + a.h - 0.5)) continue;   // ① 同一行
        if (b.layout_width && b.layout_width.v === LG_MATCH_PARENT) continue;    // ② 整行叠加层不参与
        var avail = b.ax - gapPx - a.ax;                                       // ③ b 右侧的安全可用宽度
        if (avail > 0.5 && a.w > avail + 0.5) {
          var f = Math.max(0.4, avail / a.w);
          worst = Math.min(worst, f);
          // 诊断：记录被判挤压的一对（写进 window.__WM_OVERLAP，校验脚本能读到）
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

// 防挤压第一道（行内让位）：与 overlapFactor 同一套 a/b 判据，但先让【自适应宽度的图片】让位 ——
// 文字保持设计字号。overflow = a 的右缘(+安全间隙) 越过 b 左缘多少 ⇒ b 里最宽的那张 auto 宽度
// 图片按这个量缩宽、高等比跟着缩；缩到 LG_IMG_FLOOR 还不够，才交给 overlapFactor 缩字号兜底。
// 预算必须是布局期算出来的真实剩余宽度，不能写静态常量（常量与行内容宽、与兄弟的实际宽度无关）。
// 幂等：因子存在树外的 LG_IMG_FIT，每轮 renderPass 从标称尺寸重排后再算。
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
        if (!(a.ay < b.ay + b.h - 0.5 && b.ay < a.ay + a.h - 0.5)) continue;        // ① 同一行
        if (b.layout_width && b.layout_width.v === LG_MATCH_PARENT) continue;         // ② 整行叠加层
        var overflow = (a.ax + a.w + gapPx) - b.ax;                                  // ③ 压进安全间隙多少
        if (overflow <= 0.5) continue;
        var img = widestAutoImage(b, null);
        if (!img) continue;                                                          // b 里没图片 ⇒ 交给缩字号
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

// 10-style: 样式 → 颜色与透明度（本文件是全项目唯一的颜色/alpha 解析处）。
//
// 颜色契约 = #AARRGGBB（前两位是 alpha，Android/APK 口径；构建期也照这个校验），
//   而浏览器把 8 位十六进制按 #RRGGBBAA 解析 ⇒ 必须在这里先拆成【RGB 串】+【alpha 0..1】，
//   否则 #FFE6A54F（本该是不透明金）会被当成 rgba(255,230,165,0.31)：文字整片发灰、
//   logo 被压成 (93,85,65)。两个消费方各自合成：
//     · canvas（40-draw）：颜色串进 fillStyle，alpha 走 globalAlpha；
//     · SVG（20-build 的 logo 渐变）：颜色串进 stop-color，alpha 走独立的 stop-opacity
//       （不写 stop-color: rgba(...)：WebKit 对它的支持面窄）。
//
// @foreground=N 只表达【透明度层级】，颜色另有唯一来源（styles.foreground-start，渐变取 -end）：
//   第 N 档的 alpha = 该款式自己声明的 styles.<款式>.foreground-slots[N]；
//   数组里没有这一档（N 越界）= 不透明（参考实现 WmRes.resolve_color 的越界兜底同义）。
//   分隔线（@foreground=1）的权威是 styles.line-opacity：它是浮点精确值（0.3 / 0.7 / 0.6 …），
//   而 foreground-slots 是数字数组 —— 两者是同义项，build.py 强制 slots[1] == line-opacity，
//   取哪个都不会出现"两处不一致"；取 line-opacity 是为了保住浮点精度
//   （0.3 ≠ #4D/255 = 0.30196…，写颜色会破坏逐像素等价）。

// 颜色拆解：返回 {rgb, alpha, argb}
//   rgb   = '#RRGGBB'（6/3 位原样、8 位剥掉前两位 alpha）；具名色 / 已是 CSS 形态原样；
//           'transparent' 原样；空串 → ''
//   alpha = 0..1（8 位 ARGB 取前两位；transparent = 0；其余 = 1）
//   argb  = 输入是否为 8 位 ARGB（调用方要还原 rgba() 字面量时用）
//   "@color=X"（APK 显式指定调色板外颜色的前缀）在这里剥掉。
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
// 颜色自带的 alpha（0..1）：等价于 lgColorParts(...).alpha，省掉调用方的临时对象。
var lgColorAlpha = function (ref) { return lgColorParts(ref).alpha; };
// 颜色 → canvas/CSS 颜色串：8 位 ARGB → 'rgba(r,g,b,a)'；6/3 位与具名色原样返回（CSS 语义一致）。
var lgCssColor = function (ref) {
  var p = lgColorParts(ref);
  if (!p.rgb) return '';
  if (!p.argb) return p.rgb;
  var r = parseInt(p.rgb.slice(1, 3), 16), g = parseInt(p.rgb.slice(3, 5), 16), b = parseInt(p.rgb.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + (Math.round(p.alpha * 1000) / 1000) + ')';
};
// @foreground=N 的 alpha：越界（N 不在 slots 里 / N 不是数字）= 1（不透明）。
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
// 前景渐变的 stop 位置（唯一口径）：styles.foreground-stop 是百分数串（构建期钉死 'N%'），
// 返回 0..0.999 —— 上限 0.999 保证 stop 之后"纯 end 色"那一段始终存在（两个 stop 完全重合时
// canvas 的插值区间会退化成 0）。
var lgForegroundStop = function () {
  var stop = parseFloat(APP('foreground-stop'));
  if (!isFinite(stop)) stop = 0;
  return Math.min(0.999, Math.max(0, stop / 100));
};

// ---------------------------------------------------------------- 节点自身的填充
// background 的值域由构建期钉死为 '' 或 '@foreground=N'：前者 = 不填充（主题底色统一由
// styles.background-color 铺满画布，节点不再刷一层），后者 = 前景色条（分隔线）。
// alpha 只来自样式一处；颜色自带的 alpha 由 lgCssColor → globalAlpha 处理，两者不重复相乘
// （再乘一次会让 30% 黑的分隔线掉到 9%）。
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

// 20-build: 素材挂载 + logo 上色 + 布局驱动。
//   · lgAssets     —— 按节点 path 认素材来源："photo" = 照片层（引擎不画）、"logo" = 页面里
//                     #wm-logo-src 的 SVG（由快捷指令注入）
//   · wmLogoSvgGradient —— 给内联 SVG 的"纯色标"上样式前景渐变（品牌色标保留自带填色）
//   · lgLayout     —— 一趟完整布局：建树 → 挂素材 → measure → place → 展平
// 几何在 05-layout，颜色在 10-style，绘制在 40-draw。
var WM_LOGO_GRADIENT_ID = 'wm-fg-gradient';
var WM_LOGO_SHAPES = 'path,rect,circle,ellipse,polygon,polyline,use,line';
// 纯色标 = 没写 fill、或者 fill 指向主题语义（currentColor）的图形
var wmWantsPaint = function (v) { return v == null || v === '' || v === 'currentColor'; };

// 给一段内联 SVG 插一个前景渐变 defs，并把"纯色标"的 fill/stroke 指过去。
// 只有内联 SVG 才吃得到页面里的渐变（外部 <img> 引用拿不到 defs）。
var wmLogoSvgGradient = function (svg) {
  var ns = 'http://www.w3.org/2000/svg';
  var defs = document.createElementNS(ns, 'defs');
  var g = document.createElementNS(ns, 'linearGradient');
  var angle = (parseFloat(APP('foreground-direction')) - 90) * Math.PI / 180;
  var dx = Math.cos(angle), dy = Math.sin(angle);
  g.setAttribute('id', WM_LOGO_GRADIENT_ID);
  g.setAttribute('x1', (50 - dx * 50) + '%'); g.setAttribute('y1', (50 - dy * 50) + '%');
  g.setAttribute('x2', (50 + dx * 50) + '%'); g.setAttribute('y2', (50 + dy * 50) + '%');
  // offset 直接用 preset 的百分数字面量（"30%"）：SVG 的 offset 就是百分数/小数，保持原文
  // 既不需要浮点转写，也不会因为舍入把没变过的款式改成另一个字符串。
  [[APP('foreground-stop'), APP('foreground-start')], ['100%', APP('foreground-end')]]
    .forEach(function (st) {
      var s = document.createElementNS(ns, 'stop');
      // 颜色必须先归一（lgColorParts）：preset 是 #AARRGGBB，而 SVG 把 8 位十六进制按 #RRGGBBAA 解析，
      // 直接塞原值会把不透明金 #FFE6A54F 变成 rgb(255,230,165) + alpha 0x4F=31%（logo 被压成 (93,85,65)）。
      // 所以 stop-color 只放 RGB，alpha 走 SVG 1.1 的独立属性 stop-opacity；alpha=1 时不下发，
      // 6 位色的款式（rose/dark/light/red）序列化结果与像素都逐字节不变。
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
    // ⚠ 没写 stroke 的图形不能再补描边：补上会描出一圈主题色（浅色款 = 黑框）
    var strokeAttr = shapes[i].getAttribute('stroke');
    if (strokeAttr != null && strokeAttr !== 'none' && wmWantsPaint(strokeAttr)) {
      shapes[i].setAttribute('stroke', 'url(#' + WM_LOGO_GRADIENT_ID + ')');
    }
  }
};

// 素材挂载：#wm-logo-src 的 SVG 文本 → 视图上的 _svg（原文，遥测要数图形/描边）+ _aspect（宽高比）。
// 图片节点只有一个来源判据 —— 节点的 path（构建期校验值域只允许 "photo" / "logo"）；id 只当身份。
// 同一份 SVG 文本在每趟 renderPass 里都会被重新解析，所以按文本缓存宽高比（文本由快捷指令注入，渲染期不变）。
var _lgLogo = { svg: null, aspect: 1 };
var lgAssets = function (root) {
  var walk = function (v) {
    if (v.type === 'ImageView') {
      if (v.path === 'photo') {
        v.enabled = false; v.img = null;        // 照片层由快捷指令在外层合成，引擎不画
      } else {
        var svg = (document.getElementById('wm-logo-src') || {}).innerHTML || '';
        var inner = null;
        if (svg) {                              // 解析 SVG 才能取 viewBox/width/height（无需真的上屏）
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
          // w/h 占位 1dp：SVG 没有天然像素尺寸，display_width/height 都写 wrap_content 时才用得到
          // 它（当前三份 preset 的 logo 都写死了 display_height，正常路径不会走到那一支）。
          v.img = { w: 1, h: 1 }; v._aspect = _lgLogo.aspect; v._svg = svg;
        } else { v.img = null; v.enabled = false; }   // 没注入 SVG ⇒ 整个标不存在（不画空框）
      }
    }
    for (var i = 0; i < v.childViews.length; i++) walk(v.childViews[i]);
  };
  for (var i = 0; i < root.length; i++) walk(root[i]);
};

// 一趟布局：返回 {tree, views}（views = 绝对坐标展平列表，供 40-draw 直接画、供 90-boot 出遥测）。
// BAND_W / BAND_H 由模板注入（画布的像素尺寸）；typeof 只是防止模板少注入一个全局就把整页打断。
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
  return { tree: tree, views: views };
};

// 30-format: 文本内容 —— preset 节点上的 text 模板 → 最终字符串。
// 覆盖四件事：时间 token 表、用户词典（兜底值/开关/自定义文本）、EXIF 与定位的数值格式化、
// 以及 token 展开。几何一律不管（尺寸与坐标在 05-layout），颜色在 10-style。
// 时间 token 的值域就是下面的 TIME_FMT（唯一权威表；build.py 从这里抽出 token 集合做构建期校验）。
var TIME_FMT = {                       // @wm_time_* → SimpleDateFormat 原文（小米 arsc 字符串池）
  wm_time_yyyy_MM_dd_HH_mm: 'yyyy.MM.dd HH:mm',
  wm_time_yyyy_MM_dd:       'yyyy.MM.dd',
  wm_time_HH_mm:            'HH:mm',
  wm_time_MM:               'MM',
  wm_time_dd:               'dd',
  wm_time_week:             'EEEE'
};
var WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var pad2 = function (x) { return (x < 10 ? '0' : '') + x; };

// ---------------------------------------------------------------- 用户词典
// 词典来自模板里的 <script id="wm-user" type="application/json">（快捷指令用 replaceText 注入），
// 结构：model / date / showDate / showLocation / exifText / locationText / exif{focal,aperture,speed,iso}
// / location{latitude,longitude}。★取值优先级：【自定义文本（用户填了 + 该款式声明支持）】>
// 【照片里实际读到的值】>【词典里的兜底值】★；兜底值只有这一处（preset 里不再有 fallback）。
// preset 侧只用 userConfig 声明"这款支持哪些开关"：date / exifText / locationText
// （true = 支持；不支持当作用户没设，保持原行为）。
// 整个渲染期词典不会变 ⇒ 解析一次就缓存（取值函数多、每趟布局都会调，不缓存会反复 JSON.parse）；
// 内容不是合法 JSON（占位符没被替换成 JSON）⇒ 视为没有用户词典：只少了兜底值与开关，不出语法错。
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
var userGroup = function (group, k) {     // 词典里的分组（「exif」「location」）
  var g = userCfg()[group];
  if (!g || typeof g !== 'object') return undefined;
  var v = g[k];
  return (v === undefined || v === null || v === '') ? undefined : v;
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
  return userConfigSupports('date') ? (userCfg().showDate !== false) : true;
};
var userShowLocation = function () {      // showLocation 开关：false ⇒ 经纬度整行隐掉（含自定义文本）
  return userCfg().showLocation !== false;
};
// 自定义文本没有独立开关：该款式声明支持（userConfig.exifText / locationText）且词典里有值就用，空值自然不生效
var userExifText = function () {
  if (!userConfigSupports('exifText')) return '';
  return userStr('exifText');
};
var userLocText = function () {
  if (!userConfigSupports('locationText')) return '';
  return userStr('locationText');
};

// ---------------------------------------------------------------- 时间
// 兜底日期：①"now" 或空 ②ISO8601 ③任何 new Date() 能解析的串 ⇒ 用它；解析不了
// （含 "2026年10月14日 下午10:39" 这种本地化串、以及 "{CurrentDate}" 这类变量占位符）⇒ null
// （= 退回渲染时刻），绝不报错/出空。
var userFbDate = function () {
  var fb = userFbVal('date');
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
  if (!d || isNaN(d.getTime())) d = userFbDate();   // 照片里没日期 ⇒ 兜底日期
  if (!d || isNaN(d.getTime())) d = new Date();     // 兜底也没有/解析不了 ⇒ 渲染时刻
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
// "有定位" = 照片有经纬度、或用户指定了自定义文本/兜底经纬度。快捷指令侧也按这个口径判定
// （它决定版式与带高；两边不一致就会出现空带或裁切）。用户关掉定位行 ⇒ 一律按"无定位"排版。
var hasGps = function () {
  if (!userShowLocation()) return false;
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

// ---------------------------------------------------------------- 数值格式化
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
// 取值链：运行时值 → 用户词典兜底值 → NaN（截图、无 EXIF、无机型都不会空/出错）
var pickNum = function (k) {
  var n = numValue(CONFIG[k]);
  if (isFinite(n) && n > 0) return n;
  var f = numValue(userFbVal(k));
  return (isFinite(f) && f > 0) ? f : NaN;
};

// ---------------------------------------------------------------- token 展开
var expand = function (tpl) {
  if (tpl == null) return '';
  // 就地替换（不早返回）：模板里可以同时有时间和别的 token；早返回会把其余内容整行吞掉
  tpl = tpl.replace(/@wm_time_(\w+)/g, function (_, k) {
    // 未知 token = 空串：build.py 已把 token 值域钉死在 TIME_FMT 上，引擎不替 preset 猜格式
    var pat = TIME_FMT['wm_time_' + k];
    return pat ? fmtTime(CONFIG.date, pat) : '';
  });
  tpl = tpl.replace(/location_latlng/g, latlng());
  // 涉及拍摄参数的行：四项都取"值或兜底"；连兜底都没有才整行置空（仍占一行高）
  var needExif = /@\{(focal|aperture|speed|iso)\}/.test(tpl);
  if (needExif && !(isFinite(pickNum('focal')) && isFinite(pickNum('aperture')) &&
                    isFinite(pickNum('speed')) && isFinite(pickNum('iso')))) return '';
  return tpl.replace(/@\{(\w+)\}/g, function (_, k) {
    switch (k) {
      case 'model':      return CONFIG.model || userFbVal('model') || '';
      case 'series':     return CONFIG.model || userFbVal('model') || '';              // APK: @{series} = 机型串
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

// 节点的 text 模板 → 字符串。前缀（"@kind="）决定这一行由谁供给（APK fill_views 语义）：
//   @model=    机型（@{series} / @{versionName}，@{logo} 与 @{versionNumber} = 空）
//   @time=     @wm_time_* token（+ ";" 之后的参数忽略）
//   @exif=     用户自定义拍摄参数文本（该款式支持且词典有值）优先，否则四项 EXIF 实际值 > 兜底值
//   @location= location_latlng 占位符（自定义文本 > 实际经纬度 > 兜底经纬度）
//   @filter= / @custom=  本项目不提供影像风格徽标 / 自定义签名 ⇒ 空
// 时间 token 未知 = 空串（不猜默认格式）。
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
    // 自定义拍摄参数文本优先（支持它的款式把整条拍摄参数换成用户文本；不支持则取不到 ⇒ 走实际值 > 兜底值）
    var et = userExifText();
    if (et) return et;
    return expand(tpl.split(';')[0]);          // expand 内含"四项缺一即整行为空"的语义
  }
  if (kind === 'location') {
    return tpl.indexOf('location_latlng') >= 0 ? latlng() : '';
  }
  return '';                                   // filter / custom / 未知前缀：本项目没有内容可给
};

// 40-draw: 绘制 —— 布局树 → canvas → 页面里唯一的一个 <img>。
//
// 为什么必须发布成 <img>：快捷指令的取图动作 is.workflow.actions.detect.images 是从页面内容里
// 【提取图像】，不是给页面截图。带 alpha 的成品必须是页面里恰好一个 <img>，其 src 是 canvas
// 导出的 PNG（AlphaTest 4 的做法）。页面里没有 <img> ⇒ 提取不到 ⇒ 真机报"变量不包括要叠放的图像"。
// 另外 canvas 元素本身必须藏起来：它与 <img> 同位叠加会把半透明像素合成两次。
//
// 本层不做布局：坐标/尺寸来自 05-layout（v.ax / v.ay / v.w / v.h），颜色与 alpha 来自 10-style，
// logo 的 SVG 上色来自 20-build。这里只负责画、以及把结果发布出去。

// CSS 语义的角度 → canvas 线性渐变的起终点
// CSS：0deg = 朝上、90deg = 朝右（顺时针）；渐变线长 = |w·sinθ| + |h·cosθ|（规范公式）
var wmGradAxis = function (deg, x, y, w, h) {
  var th = deg * Math.PI / 180;
  var dx = Math.sin(th), dy = -Math.cos(th);
  var cx = x + w / 2, cy = y + h / 2;
  var len = Math.abs(w * Math.sin(th)) + Math.abs(h * Math.cos(th));
  var hx = dx * len / 2, hy = dy * len / 2;
  return [cx - hx, cy - hy, cx + hx, cy + hy];
};

// 前景渐变（文字 / 分隔线都用它）：复刻 CSS linear-gradient(<direction>, A <stop>, B) 的取色语义
//   · 0% → stop%：纯 A（第一个颜色位置之前都是它）
//   · stop% → 100%：A → B 渐变
// 颜色必须过 lgCssColor：preset 是 #AARRGGBB（Android 口径），canvas 只认 #RRGGBB / #RRGGBBAA。
// 颜色自带的 alpha 不在这里用 —— 它由 lgTextAlpha / lgFillAlpha 取出当 globalAlpha（见 05-layout 注释）。
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

// ctx.font 的字族处理（两条都是真机/浏览器实测的硬约束）：
//  1) 含空格的族名必须加引号，否则 ctx.font 整条声明解析失败；
//  2) -apple-system / BlinkMacSystemFont / system-ui / ui-* 是【CSS 专有关键字】，canvas 的
//     ctx.font 不接受它们；一旦出现，整条 font 声明被忽略、Chrome 保留上一次的字体（默认 10px）
//     ⇒ 文字画出来只有一半大、测宽也偏小。所以这里把 CSS 专有关键字过滤掉，只留真实族名与通用族。
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

// 字重映射（唯一口径：05-layout 的测宽与这里的绘制都走它，否则"量的宽度"和"画的字形"不是一个字重）：
//   canvas 的 ctx.font 只认 100..900 的【百位档】，静态字体（Helvetica Neue / SF）也不吃 wght 变体轴，
//   把 501/451/620 这类数值写进去只会按 CSS 字重匹配规则落到 Medium/Bold 等固定字面 ⇒ 观感偏粗。
//   取数来源只有一个：font['design-weight']（= APK wmRes.fonts.*.variation 的 'wght' N，权威设计值；
//   构建期强制必填）。
//   ★收敛方向 = 向下取整到百位档，不是就近四舍五入★：本项目的系统字体在同一档位上比 MiSans VF
//   观感更重，就近取整会把设计值 451 抬到 500 ⇒ 日期/经纬度行跟机型行一样粗。
//   映射表：401→400、451→400、501→500、550→500、620→600（下限 100，上限 900）。
var wmFontWeight = function (f) {
  var n = parseFloat(f['design-weight']);
  if (!isFinite(n) || n <= 0) return 400;
  return Math.max(100, Math.min(900, Math.floor(n / 100) * 100));
};
var wmFontStr = function (f, sizePx) {
  return wmFontWeight(f) + ' ' + sizePx + 'px ' + wmFontFam(f['font-family']);
};

// 文字阴影：CSS 简写 → ctx.shadow*。格式 <x> <y> [blur] <color>，数值可省 px、可为负数。
// 颜色必须过 lgCssColor：preset 的长度/颜色一律 ARGB 口径（#80000000 = 50% 黑），
// 而 canvas 自己的 8 位十六进制按 CSS 的 #RRGGBBAA 解析（#80000000 会变成全透明 rgba(128,0,0,0)）。
// blur 省略时按 0 处理；颜色取简写的最后一个空白分隔字段（因此颜色本身不能含空格，
// 六位色 / 具名色 / rgba(...) 均满足）。
var wmShadow = function (ctx, css) {
  ctx.shadowOffsetX = ctx.shadowOffsetY = ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0,0,0,0)';
  var s = String(css == null ? '' : css).trim();
  if (!s) return;
  var parts = s.split(/\s+/);
  if (parts.length < 2) return;                       // 至少 <x> <color>
  var color = parts[parts.length - 1];
  var nums = parts.slice(0, parts.length - 1);
  if (nums.length > 3) return;                        // 颜色带空格（如 "0 0 rgba(0, 0, 0, .5)"）不支持
  var xy = nums.map(function (t) { return parseFloat(t); });
  if (!isFinite(xy[0]) || !isFinite(xy[1])) return;
  ctx.shadowOffsetX = xy[0];
  ctx.shadowOffsetY = xy[1];
  ctx.shadowBlur = nums.length > 2 && isFinite(xy[2]) ? xy[2] : 0;
  var c = lgCssColor(color);
  if (c) ctx.shadowColor = c;
};

// 文本：逐字绘制以复刻 letter-spacing（05-layout 的 lgTextWidth 也是"整串宽度 + 每字符补一个
// letterSpacing"，逐字推进才能让画出来的字与量出来的宽一致）。
var wmDrawText = function (ctx, v) {
  if (!v.textMetrics || !v.textValue) return;
  var f = v.textMetrics.font, sizePx = v.textMetrics.sizePx;
  ctx.save();
  ctx.font = wmFontStr(f, sizePx);
  ctx.textBaseline = 'alphabetic';
  // 文字透明度 = 颜色自带的 alpha × font.opacity（两个独立来源，同时存在就相乘）：
  //   颜色 alpha：@foreground=N → 该样式声明的第 N 个槽位（styles.<款式>.foreground-slots[N]，
  //   如莱卡浅色款 f2 = @foreground=2 ⇒ 50% 黑）；#AARRGGBB / @color=#AARRGGBB → 颜色通道里的 alpha。
  //   font.opacity：字体对象上的显式不透明度（规范必填键，当前每款都写 1）。
  var ca = lgTextAlpha(f.color, CONFIG.appearance);
  ca *= parseFloat(f.opacity);
  ctx.globalAlpha = isFinite(ca) ? Math.max(0, Math.min(1, ca)) : 1;
  wmShadow(ctx, f.shadow);
  var ls = (parseFloat(f['letter-spacing']) || 0) * sizePx;
  var lines = String(v.textValue).split('\n');
  var lh = v.textMetrics.lineHeight || sizePx;
  // 复刻 CSS 的 half-leading：行盒高 lh，字形盒高 (ascent+descent) 居中 ⇒ 基线 = 顶 + (lh-(a+d))/2 + a
  var mm = ctx.measureText('Hg');
  var asc = mm.fontBoundingBoxAscent, desc = mm.fontBoundingBoxDescent;
  if (asc == null || !isFinite(asc)) { asc = sizePx * 0.8; desc = sizePx * 0.2; }
  if (desc == null || !isFinite(desc)) desc = sizePx * 0.2;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var x = v.ax;
    var y = v.ay + lh * i + (lh - (asc + desc)) / 2 + asc;
    // ★渐变的"作用框" = 从本节点左边缘起算、宽度撑到整条水印带★（不是节点自己的紧框）：
    //   参考件把渐变挂在很宽的 flex 容器上（background-clip:text 裁成文字），每个元素都从自己的
    //   左边缘起算 ⇒ 文字落在 0~30% 的"纯 start 色"区，看起来是柔和的纯色。用文字紧框则 45°
    //   （玫瑰金）的渐变会在每个字内部斜切；两种 stop 同色的款式（gold/dark/light/red）不受影响。
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

// 节点自身带 @foreground=N 填充（分隔线）：铺前景色 + 该槽位的 alpha，与参考实现 resolve_color
// （把 @foreground=N 解析成一个带 alpha 的纯色）一致。fillStyle 用 lgCssColor、alpha 用 fill.alpha：
// 两者都是"纯色 + 独立 alpha"，若把颜色自带的 alpha 也留在颜色串里就会被下面的 globalAlpha
// 乘第二次 ⇒ 偏暗。
var wmDrawFill = function (ctx, v) {
  var fill = lgFillFor(v);
  if (!fill) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, fill.alpha));
  ctx.fillStyle = lgCssColor(APP('foreground-start'));
  ctx.fillRect(v.ax, v.ay, v.w, v.h);
  ctx.restore();
};

// 底色：stitch(拼接)款样式有底色 ⇒ 铺满画布；overlay(叠加)款是 transparent ⇒ 不铺（保住 alpha）
var wmDrawBackdrop = function (ctx, W, H) {
  var bgc = String(APP('background-color')).trim();
  if (!bgc || bgc === 'transparent' || bgc === 'none') return;
  ctx.save();
  ctx.fillStyle = lgCssColor(bgc);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

// 背景图（styles.background-image）：按 styles.background-fit 铺 —— cover 等比铺满居中裁切 /
// stretch 拉满 / repeat 按高度等比横向平铺。背景图铺在底色之上、节点之下。
var wmDrawBgImage = function (ctx, W, H, img) {
  if (!img || !img.width || !img.height) return;
  var fit = APP('background-fit');
  ctx.save();
  if (fit === 'stretch') {
    ctx.drawImage(img, 0, 0, W, H);
  } else if (fit === 'repeat') {
    var rh = H, rw = img.width * (H / img.height);
    for (var x = 0; x < W; x += rw) ctx.drawImage(img, x, 0, rw, rh);
  } else {                                  // cover（也是 background-fit 留空时的口径）
    var sc = Math.max(W / img.width, H / img.height);
    var dw = img.width * sc, dh = img.height * sc;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  ctx.restore();
};

// 品牌标（内联 SVG）：先按 20-build 的规则上色，再序列化成 data URI 交给 <img> 光栅化。
// 每次都从 _svg 原文重新解析（拿到一个干净的元素；直接复用同一个元素会让 wmLogoSvgGradient
// 反复插入 <defs>）。缩放用 preserveAspectRatio=meet，宽高取布局算好的像素值。
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

// 图片加载：失败也 resolve(null) —— 缺 logo/缺背景图时页面照常出图，只是少画那一层。
var wmLoadImage = function (src) {
  return new Promise(function (resolve) {
    var im = new Image();
    im.onload = function () { resolve(im); };
    im.onerror = function () { resolve(null); };
    im.src = src;
  });
};
// SVG 文本 → data URI。先走 encodeURIComponent 保证非 ASCII（中文/特殊符号）不炸 btoa；
// 万一抛错（理论上只有非法码点）就直接 btoa 原文，宁可少一层编码也不要整页不出图。
var wmSvgDataUri = function (svg) {
  var b64;
  try { b64 = btoa(unescape(encodeURIComponent(svg))); }
  catch (e) { b64 = btoa(svg); }
  return 'data:image/svg+xml;base64,' + b64;
};

// 绘制整棵树：底色 → 背景图 → 各节点（分隔线 / 文字 / logo）。返回 Promise，resolve 时
// canvas 上就是最终像素。
var wmPaint = function (L, canvas) {
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;

  // 背景图：BG_URI 是纯 base64（真机）或完整 data URI（本地校验）
  var raw = (typeof BG_URI === 'string') ? BG_URI : '';
  var uri = raw.length > 64 ? (raw.indexOf('data:') === 0 ? raw : 'data:image/png;base64,' + raw) : '';
  var views = L.views || [];
  // 节点 id 在构建期被钉死（logo 节点只能叫 logo、每个变体最多一个）⇒ 以 id 为键缓存光栅化的标
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

  // ★ 第一遍（同步）：不需要图片资源的部分先画完，并同步发布页面里那个 <img>。
  //   取图动作是在页面内容里找图像，页面加载完成那一刻就必须存在合法 <img>；
  //   若等到 Promise（logo/背景图异步加载）才创建，真机很可能在它出现前就取过图 ⇒ 取不到/白底。
  drawAll();
  var published = wmPublish(canvas);

  // 第二遍（异步）：logo 与背景图就绪后完整重绘，并更新已发布 <img> 的 src
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

// 把 canvas 变成页面里唯一的一个 <img>：detect.images 提取的就是它。发布后把 canvas 藏起来，
// 页面（以及本地校验的截图）显示的就是这张成品图，避免 canvas 与 <img> 同位叠两次半透明像素。
var wmPublish = function (canvas) {
  // 尺寸自检（硬要求）：detect.images 提取的是 <img> 的自然尺寸，下游按照片宽缩放时依赖它恰好
  // 等于 BAND_W×BAND_H。不等就写进 #wm-error —— 本地校验与真机都会立刻看到，避免"校验全绿、
  // 真机尺寸错"这种沉默失败。口径 = 整数像素、向下取整（与模板里 canvas 的 width/height 一致）。
  var expW = (typeof BAND_PX_W === 'number') ? BAND_PX_W
           : ((typeof BAND_W === 'number' && isFinite(BAND_W)) ? Math.max(1, Math.floor(BAND_W)) : 0);
  var expH = (typeof BAND_PX_H === 'number') ? BAND_PX_H
           : ((typeof BAND_H === 'number' && isFinite(BAND_H)) ? Math.max(1, Math.floor(BAND_H)) : 0);
  var okSize = (expW > 0 && expH > 0) ? (canvas.width === expW && canvas.height === expH) : true;
  if (!okSize) {
    wmError('canvas size ' + canvas.width + 'x' + canvas.height + ' != BAND ' + expW + 'x' + expH);
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
  img.setAttribute('data-wm-size', canvas.width + 'x' + canvas.height);   // 供校验脚本从 DOM 断言
  img.src = canvas.toDataURL('image/png');
  canvas.style.visibility = 'hidden';
  return img;
};

// 90-boot: 入口 —— 注入的运行时值 → CONFIG → 选中样式 → 选 layout 变体 → 布局（含防挤压）→
// 出遥测 → 绘制并发布 <img>。本文件只做编排与对外信号（window.__WM_TELEMETRY / __WM_FINAL /
// __WM_OVERLAP / __WM_IMGFIT / __WM_GUARD_MISJUDGE），几何在 05-layout、颜色在 10-style、
// 素材在 20-build、文本在 30-format、绘制在 40-draw。
(function () {
  try {
    // 1) 运行时值合并进 CONFIG：模板按值注入（@@UNIT@@/@@MODEL@@/…），空值与 null 不覆盖 preset
    var keys = ['unit','model','versionName','date','focal','focalActual','aperture','speed','iso','lat','lon','lens'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (RTV && RTV[k] !== '' && RTV[k] != null) CONFIG[k] = RTV[k];
    }
    CONFIG.unit = parseFloat(CONFIG.unit) || 1;

    // 2) 选中样式：快捷指令从该 preset 的 styles 里挑一款注入（OVERRIDE），这里按规范 9 键抄进
    //    CONFIG.appearance，后面的 APP(k) 都从这里取值。
    //    APP_KEYS 必须【恰好】是规范样式的 9 个键（build.py 拿它和 styles.json 双向对账）：
    //    少一个 ⇒ 注入的值被静默丢掉；多一个 ⇒ 引擎里没人读的死键。
    //    含 foreground-slots：@foreground=N 的透明度槽位数组（见 10-style 的 lgForegroundAlpha）。
    var ap = CONFIG.appearance = {};
    var APP_KEYS = ['foreground-start','foreground-end','foreground-stop','foreground-direction',
                    'line-opacity','background-color','background-image','background-fit',
                    'foreground-slots'];
    for (var a = 0; a < APP_KEYS.length; a++) {
      ap[APP_KEYS[a]] = OVERRIDE[APP_KEYS[a]];
    }

    // 3) 选 layout 变体：layout_group 是按变体名索引的对象（与 metadata.bandDpByVariant 同构），
    //    变体名是一套固定词汇，构建期强校验两个都在（layout = 有定位用 / layout_loc_off = 无定位用），
    //    所以这里没有"取第一个"的兜底：缺变体直接报错，不猜布局。
    var gps = hasGps(), variants = CONFIG.layout_group || {};
    var pickName = gps ? 'layout' : 'layout_loc_off';
    var pick = variants[pickName];
    if (!pick) throw new Error('layout_group 缺少变体 ' + pickName + '（layout 与 layout_loc_off 必须都写）');

    // 4) 布局：measure/place 出绝对坐标（不建任何 DOM），文字被挤时按比例缩字号重排（幂等）
    var renderPass = function (sizeScale) {
      return lgLayout(pick, sizeScale);
    };
    // 4a) 防挤压两道（都在 05-layout）：
    //     ① lgFitImages  —— 同一行放不下时先让"自适应宽度的图片"让位（文字保持设计字号）
    //     ② overlapFactor —— 让位到安全网仍放不下，才按可用空间缩整层字号
    //     顺序不能反：先缩字号会把整层文字变小，而实际问题往往只是图片太宽。
    var layoutOnce = function () {
      var scale = 1, L = renderPass(scale), fitted = false;
      for (var ip = 0; ip < 3; ip++) { if (!lgFitImages(L)) break; L = renderPass(scale); }
      for (var pass = 0; pass < 3; pass++) {
        var f = overlapFactor(L);
        if (f >= 0.999) break;
        var next = Math.max(0.4, f);              // 单轮因子（每轮从标称尺寸重排），硬下限 0.4
        if (fitted && next > scale - 0.001) break; // 不再变好就停，避免用更大的因子重排反而又重叠
        scale = next; fitted = true;
        L = renderPass(scale);
      }
      // 自检：只有【逼近硬下限】才判定为守卫误判（真机表现为整层文字骤小、版式全错）。
      // 不能写成"<0.95 一律复位"：long_model 这类"长机型号 + 右侧 logo"本来就要缩到 ~0.9 才留得出间隙。
      var eb = document.getElementById('wm-error');
      if (scale <= 0.45) {
        var diag = 'GUARD-MISJUDGE scale=' + scale.toFixed(3)
          + (window.__WM_OVERLAP && window.__WM_OVERLAP.length ? ' | ' + window.__WM_OVERLAP.join(' || ') : '');
        window.__WM_GUARD_MISJUDGE = diag;
        scale = 1; fitted = false; L = renderPass(1);
        wmError(diag);
      } else if (eb && /GUARD-MISJUDGE/.test(eb.textContent || '')) {
        // 本轮没误判：清掉上一轮（字体就绪前）留下的守卫告警，避免陈旧信号
        eb.textContent = ''; eb.style.display = 'none';
      }
      return { L: L, fitted: fitted };
    };

    // 4b) 渲染遥测：页面已无任何布局 DOM，校验需要的版式数据（boxes/texts/fontsize/…）由布局树
    //     暴露到 window.__WM_TELEMETRY。字段名是 local_verify.py 探针的读取契约，改名要同步改它。
    var emitTelemetry = function (L, isFitted) {
      var boxes = {}, texts = {}, fontsize = {}, strokes = 0, shapes = 0, seen = {};
      for (var i = 0; i < L.views.length; i++) {
        var v = L.views[i];
        if (!v || !v.id) continue;
        var id = seen[v.id] ? (v.id + '#' + i) : v.id;   // 同 id 多次出现（如两个变体同名节点）时补下标
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
        // 带尺寸用整数像素、向下取整：校验脚本的 band_h 来自 wm_plan 的 int(renderHeight)，
        // 两边必须同一口径，否则真机"页面 180.5 vs 成品 180"会被判成尺寸错。
        band: Math.max(1, Math.floor(BAND_W)) + 'x' + Math.max(1, Math.floor(BAND_H)),
        root: { clientWidth: Math.floor(BAND_W), scrollWidth: Math.floor(BAND_W), h: Math.floor(BAND_H) }
      };
      return window.__WM_TELEMETRY;
    };

    var first = layoutOnce();
    var L = first.L, fitted = first.fitted;
    emitTelemetry(L, fitted);

    // 5) 绘制：同一棵布局树画进 #wm-canvas，由 canvas 发布出页面里【唯一的一个 <img>】
    //    （取图动作靠提取这个 <img>，见 40-draw 顶部说明）。
    var canvas = document.getElementById('wm-canvas');
    var paint = function (tree) {
      if (!canvas || typeof wmPaint !== 'function') return;
      // 重新发布：先摘掉上一张 #wm-out，保证页面上任何时候都只有一张成品图
      var old = document.getElementById('wm-out');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      try {
        wmPaint(tree, canvas).then(null, function (e) {
          wmError(e && e.message ? e.message : String(e));
        });
      } catch (e) { wmError(e && e.message ? e.message : String(e)); }
    };
    paint(L);

    // 首次（同步）布局可能发生在 webfont 就绪前 ⇒ measureText 落到回退字体、宽度偏窄、遥测过时。
    // 所以 fonts.ready 之后必须重排 + 刷新遥测 + 重绘。__WM_FINAL 是给校验用的"最终态"信号：
    // 探针必须等到它再读数，否则会读到字体就绪前的旧版式。
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
