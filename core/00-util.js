// 00-util: 基础工具（单位换算 / DOM / 取值）
// 单位链：unit = min(照片宽,照片高) / dpr / designShort（快捷指令算好写进 RUNTIME.unit）
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
