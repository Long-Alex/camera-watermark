// 10-style: layout 节点 → CSS 样式对象（字段名即 CSS 属性名，纯数字 = dp）
// 对照 p880yu：水平容器 Σ(子宽+margin_left) / 高 = max(子高+margin_top)；垂直容器反过来。
var LAYOUT_PROPS = ['width','height','min-width','max-width','margin-top','margin-bottom','margin-left','margin-right',
                    'padding-top','padding-bottom','padding-left','padding-right',
                    'background-color','justify-content','align-items','align-self','flex-direction','flex','opacity'];
var LEN_PROP = /^(margin-|padding-|width$|height$|min-width$|max-width$)/;
var nodeStyle = function (n, font) {
  var css = { boxSizing: 'border-box' };
  LAYOUT_PROPS.forEach(function (p) {
    if (n[p] != null) css[p] = LEN_PROP.test(p) ? DP(n[p]) : n[p];
  });
  if (n.padding) {
    css['padding-top']    = DP(PAD(n.padding, 'top'));
    css['padding-bottom'] = DP(PAD(n.padding, 'bottom'));
    css['padding-left']   = DP(PAD(n.padding, 'left'));
    css['padding-right']  = DP(PAD(n.padding, 'right'));
  }
  if (n.flex == null) css['flex-shrink'] = 0;      // 引擎不压缩固定尺寸子项（分隔线 2dp 不能被挤掉）
  var t = n.type;
  if (t === 'row')    { css.display = 'flex'; css['flex-direction'] = 'row'; }
  if (t === 'column') { css.display = 'flex'; css['flex-direction'] = 'column'; css['align-items'] = css['align-items'] || 'flex-start'; }
  if (t === 'text' && font) {
    css['font-family'] = font['font-family'];
    css['font-size']   = DP(font['font-size']);        // px = size(dp) × scale（b.f()）
    css['line-height'] = DP(font['line-height']);      // = (descent − ascent) × size（MiSans hhea）
    css['min-height']  = DP(font['line-height']);      // 空文本视图仍占一行高（b.f() 不跳过）
    css['font-weight'] = font['font-weight'];
    css['white-space'] = 'pre';                        // EXIF/经纬度双空格 + 绝不换行
    css['word-break']  = 'keep-all';
    if (font.opacity != null) css.opacity = font.opacity;               // @foreground=2 ⇒ 50%
    if (font['letter-spacing']) css['letter-spacing'] = font['letter-spacing'];  // em ⇒ 随字号缩放
    if (n['text-align'] === 'right') css['align-self'] = 'flex-end';   // layout_gravity=right
  }
  if (n.css) (n.css || '').split(';').forEach(function (kv) {          // 逃生舱：节点级 css 最后写入
    var i = kv.indexOf(':'); if (i > 0) css[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return css;
};
