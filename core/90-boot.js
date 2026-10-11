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
      root.setAttribute('data-fit', '1');
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

    // 2) 覆盖对象 → 改写 CONFIG.appearance（preset 只存默认值；配色表由快捷指令传入，见 §4.5）
    var ap = CONFIG.appearance = CONFIG.appearance || {};
    var APP_KEYS = ['foreground-start','foreground-end','foreground-stop','foreground-direction',
                    'line-opacity','background-color','background-image'];
    for (var a = 0; a < APP_KEYS.length; a++) {
      var k = APP_KEYS[a];
      if (OVERRIDE && OVERRIDE[k] !== '' && OVERRIDE[k] != null) ap[k] = OVERRIDE[k];
    }
    var st = document.documentElement.style;
    st.setProperty('--background-color', APP('background-color', '#FFFFFF'));
    st.setProperty('--foreground-start', APP('foreground-start', '#000000'));
    st.setProperty('--foreground-end', APP('foreground-end', APP('foreground-start', '#000000')));
    st.setProperty('--foreground-stop', APP('foreground-stop', '0%'));
    st.setProperty('--foreground-direction', APP('foreground-direction', '90deg'));

    var root = document.getElementById('wm-root');
    // 背景图：快捷指令注入 data URI（style 里的 background-image = assets/background/<id>.png）；
    // 兼容旧写法：值若是名字则查 ASSETS['background:名字']（见踩坑 §19.10）
    var backgroundImage = APP('background-image', '');
    if (backgroundImage) {
      var bgUrl = backgroundImage.indexOf('data:') === 0 ? backgroundImage
                : (typeof ASSETS !== 'undefined' && ASSETS['background:' + backgroundImage]) || '';
      if (bgUrl) {
        root.style.backgroundImage = 'url(' + bgUrl + ')';
        root.style.backgroundSize = '100% 100%';
      }
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
