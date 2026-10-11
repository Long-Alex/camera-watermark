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
  if (!iso) return '';
  var d = new Date(iso);
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
  var m = /@wm_time_(.+)$/.exec(tpl);
  if (m) return fmtTime(CONFIG.date, TIME_FMT['wm_time_' + m[1]] || m[1]);
  if (tpl.indexOf('location_latlng') >= 0) return latlng();
  // 涉及拍摄参数的行：四项都取"值或兜底"；连兜底都没有才整行置空（仍占一行高）
  var needExif = /@\{(focal|aperture|speed|iso)\}/.test(tpl);
  if (needExif && !(isFinite(pickNum('focal')) && isFinite(pickNum('aperture')) &&
                    isFinite(pickNum('speed')) && isFinite(pickNum('iso')))) return '';
  return tpl.replace(/@\{(\w+)\}/g, function (_, k) {
    switch (k) {
      case 'model':      return CONFIG.model || (CONFIG.fallback || {}).model || '';
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
