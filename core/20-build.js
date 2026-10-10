// 20-build: layout 树 → DOM
var buildNode = function (n) {
  var font = n.font ? CONFIG.fonts[n.font] : null;
  var css  = nodeStyle(n, font);
  var t = n.type;

  if (t === 'divider') { var d = EL('div', css); return d; }
  if (t === 'image') {
    var box = EL('div', css); box.style.display = 'flex';
    var src = document.getElementById('wm-logo-src');
    var svg = src ? src.innerHTML : '';
    if (svg) {
      box.innerHTML = svg;                           // SVG 内联（currentColor 跟随 css.color）
      var inner = box.querySelector('svg');           // 让 SVG 撑满容器（否则被自身 width/height 框死）
      if (inner) { inner.style.height = '100%'; inner.style.width = 'auto'; inner.setAttribute('height', '100%'); }
      box.style.alignItems = 'center';
    }
    if (n.optional && !svg) box.style.display = 'none';
    return box;
  }
  if (t === 'text') {
    var txt = expand(n.text);
    if (n.optional && !txt) { var h = EL('div'); h.style.display = 'none'; return h; }
    var e = EL('div', css, txt);
    e.className = 'tn';
    return e;
  }
  // row / column
  var root = EL('div', css);
  (n.children || []).forEach(function (c) { root.appendChild(buildNode(c)); });
  return root;
};
var fitText = function (root) {                    // 机型防溢出：缩字号（最多 6 步）
  var nodes = root.querySelectorAll('.tn');
  for (var i = 0; i < nodes.length; i++) {
    var e = nodes[i], s = parseFloat(e.style.fontSize) || 0, step = 0;
    while (e.scrollWidth > e.clientWidth + 1 && s > 8 && step < 6) {
      s *= 0.94; e.style.fontSize = s + 'px'; step++;
    }
  }
};
