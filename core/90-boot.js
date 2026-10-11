// 90-boot: 入口 —— RUNTIME → CONFIG → 选 layout 变体 → CSS 变量 → 建 DOM → 防溢出
(function () {
  var fail = function (msg) {
    var b = document.getElementById('wm-error');
    if (b) { b.style.display = 'block'; b.textContent = 'watermark error: ' + msg; }
  };
  var fit = function (root) {                 // JS 缩字号防换行（§4.3 前提：文本单行）
    for (var pass = 0; pass < 3; pass++) {
      var sw = root.scrollWidth, cw = root.clientWidth;
      if (!sw || !cw || sw - cw <= 1) return;
      var k = cw / sw, nodes = root.querySelectorAll('.tn');
      for (var i = 0; i < nodes.length; i++) {
        var base = parseFloat(nodes[i].getAttribute('data-fs'));
        if (base) nodes[i].style.fontSize = (base * k) + 'px';
      }
    }
  };
  try {
    // 1) 运行时值合并进 CONFIG（扁平注入，见踩坑 §18.3）
    var keys = ['unit','model','versionName','date','focal','focalActual','aperture','speed','iso','lat','lon','lens'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (RTV && RTV[k] !== '' && RTV[k] != null) CONFIG[k] = RTV[k];
    }
    CONFIG.unit = parseFloat(CONFIG.unit) || 1;

    // 2) 主题变量（§4.5 覆盖对象）
    var st = document.documentElement.style;
    st.setProperty('--watermark-bg', OVERRIDE.bgColor || '#FFFFFF');
    st.setProperty('--foreground-start', OVERRIDE.foregroundStart || '#000000');
    st.setProperty('--foreground-end', OVERRIDE.foregroundEnd || OVERRIDE.foregroundStart || '#000000');
    st.setProperty('--foreground-stop', OVERRIDE.foregroundStop || '0%');
    st.setProperty('--foreground-direction', OVERRIDE.foregroundDirection || '90deg');

    var root = document.getElementById('wm-root');
    if (OVERRIDE.bgImage && typeof ASSETS !== 'undefined' && ASSETS['background:' + OVERRIDE.bgImage]) {
      root.style.backgroundImage = 'url(' + ASSETS['background:' + OVERRIDE.bgImage] + ')';
      root.style.backgroundSize = '100% 100%';
    }

    // 3) layout 变体：lat/lon 均非空 ⇒ layout；任一为空 ⇒ layout_loc_off（§5.3）
    var gps = hasGps(), variants = CONFIG.layout_group || [], pick = null;
    for (var v = 0; v < variants.length; v++) {
      var name = Object.keys(variants[v])[0];
      if (name === (gps ? 'layout' : 'layout_loc_off')) { pick = variants[v][name]; break; }
    }
    if (!pick && variants.length) pick = variants[variants.length - 1][Object.keys(variants[variants.length - 1])[0]];
    if (!pick) throw new Error('layout_group 为空');

    // 4) 建 DOM + 防溢出
    for (var n = 0; n < pick.length; n++) root.appendChild(buildNode(pick[n]));
    fit(root);
    root.setAttribute('data-variant', gps ? 'layout' : 'layout_loc_off');
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
})();
