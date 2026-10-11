// 10-style: layout 节点 → CSS 样式对象（字段名即 CSS 属性名，纯数字=dp）
var LAYOUT_PROPS = ['width','height','margin-top','margin-bottom','margin-left','margin-right',
                    'padding-top','padding-bottom','padding-left','padding-right',
                    'text-align','background-color','justify-content','align-items','flex-direction','flex'];
var nodeStyle = function (n, font) {
  var css = { boxSizing: 'border-box' };
  LAYOUT_PROPS.forEach(function (p) {
    if (n[p] != null) css[p] = (/^(margin|padding)/.test(p) || p === 'width' || p === 'height') ? DP(n[p]) : n[p];
  });
  if (n.padding) {
    css['padding-top'] = DP(PAD(n.padding,'top')); css['padding-bottom'] = DP(PAD(n.padding,'bottom'));
    css['padding-left'] = DP(PAD(n.padding,'left')); css['padding-right'] = DP(PAD(n.padding,'right'));
  }
  var t = n.type;
  if (t === 'row')    css.display = 'flex', css['flex-direction'] = 'row';
  if (t === 'column') css.display = 'flex', css['flex-direction'] = 'column', css['align-items'] = css['align-items'] || 'flex-start';
  if (t === 'text' && font) {
    css['font-family']    = "-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC',sans-serif";
    css['font-size']      = DP(font['font-size']);
    css['font-weight']    = font['font-weight'];
    css['line-height']    = DP(font['line-height']);
    if (font.color) css.color = font.color;
    if (font['letter-spacing']) css['letter-spacing'] = font['letter-spacing'];
    css['white-space']    = 'pre';
    if (n['text-align'] === 'right') css['align-self'] = 'flex-end';
  }
  if (t === 'image') css.color = css.color || '#000';
  // The preset root carries a literal white background. Apply the selected
  // theme to that node so it survives the layout's own inline background.
  if (n.id === 'bottom_layout' && OVERRIDE.bgColor) css['background-color'] = OVERRIDE.bgColor;
  if (n.css) (n.css || '').split(';').forEach(function (kv) {
    var i = kv.indexOf(':'); if (i > 0) css[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return css;
};
