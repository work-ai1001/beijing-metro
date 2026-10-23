/* ==========================================================
   站名志 · 北京地铁全网图
   ========================================================== */
(function () {
  "use strict";

  var MAP = window.BJ_MAP;
  var CUR = window.BJ_STATIONS;
  var COLORS = window.BJ_MAP_LINE_COLORS;
  var NS = "http://www.w3.org/2000/svg";

  var VB = { w: MAP.width, h: MAP.height };
  var stations = MAP.stations;
  var byName = {};
  stations.forEach(function (s) { byName[s.n] = s; });

  var curatedNames = Object.keys(CUR).filter(function (n) { return byName[n]; });
  var curatedSet = {};
  curatedNames.forEach(function (n) { curatedSet[n] = 1; });

  var LINE_ORDER = [
    "1号线", "2号线", "3号线", "4号线", "5号线", "6号线", "7号线", "8号线", "9号线",
    "10号线", "11号线", "12号线", "13号线", "14号线", "15号线", "16号线", "17号线",
    "18号线", "19号线", "S1线", "昌平线", "亦庄线", "房山线", "燕房线", "西郊线",
    "亦庄T1线", "首都机场线", "大兴机场线"
  ];
  var LINE_RANK = {};
  LINE_ORDER.forEach(function (l, i) { LINE_RANK[l] = i; });

  var svg = document.getElementById("mapSvg");
  var world = document.getElementById("world");
  var markersLayer = document.getElementById("markers");
  var panel = document.getElementById("panel");
  var backdrop = document.getElementById("backdrop");
  var loading = document.getElementById("loading");
  var mapHint = document.getElementById("mapHint");
  var tip = document.getElementById("tip");
  var tipName = document.getElementById("tipName");
  var tipMeta = document.getElementById("tipMeta");

  var markerEls = [];
  var activeMarker = null;
  var currentName = null;
  var panelTimer = 0;

  /* ---------------- 工具 ---------------- */
  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function normalize(str) {
    return (str || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
  }

  function sortLines(lines) {
    return lines.slice().sort(function (a, b) {
      var ra = LINE_RANK[a] === undefined ? 99 : LINE_RANK[a];
      var rb = LINE_RANK[b] === undefined ? 99 : LINE_RANK[b];
      return ra - rb;
    });
  }

  function lineColor(name) { return COLORS[name] || "#6f756c"; }

  function briefOrigin(name) {
    var n = name;
    if (/门$/.test(n)) {
      return "站名沿用附近地名「" + n + "」。以“门”结尾的地名，多与旧时城门、院门或一处出入口有关，后来逐渐变成整片区域的称呼。";
    }
    if (/桥$/.test(n)) {
      return "站名取自附近的「" + n + "」。北京多桥，桥名往往来自跨河的位置、桥的形制或旁边的聚落，后来成了这一带的地名。";
    }
    if (/(寺|庙|庵|观|堂)$/.test(n)) {
      return "站名取自附近的「" + n + "」。旧时寺庙、庵堂往往是聚落的地标，围绕香火和庙会慢慢形成街市，站名便沿用至今。";
    }
    if (/(园|苑|公园)$/.test(n)) {
      return "站名取自附近的「" + n + "」。北京以“园”“苑”为名的地片，多与旧时园林、果园、菜园或后来的新建小区有关。";
    }
    if (/(村|庄|营|屯|店|窑|坊|铺)$/.test(n)) {
      return "站名取自附近的「" + n + "」。这是典型的聚落型地名：先有村、庄、营房或店铺，后来聚落扩大，名字被道路和地铁站继承下来。";
    }
    if (/(河|湖|海|潭|湾|渠|沟)$/.test(n)) {
      return "站名取自附近的「" + n + "」。北京的地名里留着大量水系记忆，河、湖、潭、湾既是地貌，也是沿岸聚落的名字。";
    }
    if (/(路|街|口|里|胡同)$/.test(n)) {
      return "站名直接沿用附近的道路或街巷名「" + n + "」。这类站名最好认，也最容易在城市改造后，替一条消失的老街继续“活着”。";
    }
    if (/(塔|亭|台|楼|阁)$/.test(n)) {
      return "站名取自附近的「" + n + "」。塔、亭、台、楼、阁多是历史上的地标建筑，建筑可能不在了，名字却留在了地名里。";
    }
    if (/(站|机场)$/.test(n)) {
      return "站名因附近的火车站、机场或交通枢纽得名。这类站名出现得较晚，却最能标记一座城市的对外方向。";
    }
    if (/(东|西|南|北)$/.test(n)) {
      return "站名由附近地名加方位词构成，表示位于该片区的" + n.slice(-1) + "侧。方位词看着简单，却是老北京最常用的定位方式。";
    }
    return "站名取自附近地名「" + n + "」，是北京常见的片区型站名。具体的村落、道路或建筑来历，地方志里有更细的记载。";
  }

  /* ---------------- 地图相机 ---------------- */
  var k = 1, tx = 0, ty = 0;
  var raf = 0;

  function clampCameraValues(c) {
    c.tx = clamp(c.tx, VB.w * (1 - c.k), 0);
    c.ty = clamp(c.ty, VB.h * (1 - c.k), 0);
    return c;
  }

  function clampCamera() {
    tx = clamp(tx, VB.w * (1 - k), 0);
    ty = clamp(ty, VB.h * (1 - k), 0);
  }

  function updateMarkerSizes() {
    var inv = 1 / k;
    markerEls.forEach(function (m) {
      m.dot.setAttribute("r", m.base * inv);
      m.hit.setAttribute("r", 58 * inv);
      if (m.halo) m.halo.setAttribute("r", m.base * 1.75 * inv);
    });
  }

  function renderMap() {
    world.setAttribute("transform", "translate(" + tx + " " + ty + ") scale(" + k + ")");
    updateMarkerSizes();
  }

  function scheduleRender() {
    if (raf) return;
    raf = window.requestAnimationFrame(function () {
      raf = 0;
      renderMap();
    });
  }

  function clientToView(clientX, clientY) {
    var ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    var p = svg.createSVGPoint();
    p.x = clientX; p.y = clientY;
    return p.matrixTransform(ctm.inverse());
  }

  function zoomAt(px, py, nextK) {
    nextK = clamp(nextK, 1, 10);
    if (Math.abs(nextK - k) < 0.0001) return;
    var wx = (px - tx) / k;
    var wy = (py - ty) / k;
    k = nextK;
    tx = px - wx * k;
    ty = py - wy * k;
    clampCamera();
    scheduleRender();
    interacted();
  }

  function zoomCenter(factor) {
    zoomAt(VB.w / 2, VB.h / 2, k * factor);
  }

  function animateCamera(target, dur) {
    target = clampCameraValues({ k: target.k, tx: target.tx, ty: target.ty });
    var from = { k: k, tx: tx, ty: ty };
    var t0 = performance.now();
    dur = dur || 420;
    function step(now) {
      var t = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - t, 3);
      k = from.k + (target.k - from.k) * e;
      tx = from.tx + (target.tx - from.tx) * e;
      ty = from.ty + (target.ty - from.ty) * e;
      renderMap();
      if (t < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  function flyToStation(name) {
    var s = byName[name];
    if (!s) return;
    var targetK = Math.max(3.1, k);
    var wide = window.innerWidth > 760;
    var cx = VB.w * (wide ? 0.42 : 0.5);
    var cy = VB.h * (wide ? 0.5 : 0.42);
    animateCamera({
      k: targetK,
      tx: cx - s.x * targetK,
      ty: cy - s.y * targetK
    });
  }

  function resetCamera() {
    animateCamera({ k: 1, tx: 0, ty: 0 }, 460);
    hideTip();
  }

  var hintGone = false;
  function interacted() {
    if (hintGone) return;
    hintGone = true;
    mapHint.classList.add("fade");
  }

  /* ---------------- 标记 ---------------- */
  function markerClass(s) {
    return "mk" + (s.c ? " curated" : "") + (s.t ? " transfer" : "");
  }

  function buildMarkers() {
    var order = stations.slice().sort(function (a, b) {
      if (a.c !== b.c) return a.c - b.c;
      if (a.t !== b.t) return a.t - b.t;
      return 0;
    });

    var frag = document.createDocumentFragment();
    order.forEach(function (s) {
      var g = el("g", {
        "class": markerClass(s),
        "data-name": s.n,
        "transform": "translate(" + s.x + " " + s.y + ")",
        tabindex: "0",
        role: "button",
        "aria-label": s.n + "，" + (s.c ? "有完整故事" : "站点简注")
      });

      var halo = el("circle", { "class": "halo", cx: 0, cy: 0, r: 1 });
      var dot = el("circle", { "class": "dot", cx: 0, cy: 0, r: 1 });
      var hit = el("circle", { "class": "hit", cx: 0, cy: 0, r: 1 });

      g.appendChild(halo);
      g.appendChild(dot);
      g.appendChild(hit);
      frag.appendChild(g);

      var base = s.c ? 32 : (s.t ? 27 : 20);
      markerEls.push({ s: s, g: g, dot: dot, hit: hit, halo: halo, base: base });

      g.addEventListener("click", function (ev) {
        ev.stopPropagation();
        hideTip();
        interacted();
        openStation(s.n);
      });

      g.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          openStation(s.n);
        }
      });

      if (window.matchMedia("(hover: hover)").matches) {
        g.addEventListener("pointerenter", function (ev) { showTip(s, ev); });
        g.addEventListener("pointermove", moveTip);
        g.addEventListener("pointerleave", hideTip);
      }
    });

    markersLayer.appendChild(frag);
    updateMarkerSizes();
  }

  function showTip(s, ev) {
    tipName.textContent = s.n;
    var lines = sortLines(s.l).slice(0, 3).join(" / ");
    tipMeta.textContent = (s.c ? "有完整故事" : (s.closed ? "施工封闭 · 简注" : "待补充简注")) +
      (lines ? " · " + lines : "");
    tip.classList.add("on");
    moveTip(ev);
  }

  function moveTip(ev) {
    if (!tip.classList.contains("on")) return;
    var pad = 14;
    var w = tip.offsetWidth || 120;
    var h = tip.offsetHeight || 48;
    var x = ev.clientX + pad;
    var y = ev.clientY + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function hideTip() { tip.classList.remove("on"); }

  function setActive(name) {
    if (activeMarker) activeMarker.classList.remove("active");
    activeMarker = null;
    var m = markerEls.filter(function (x) { return x.s.n === name; })[0];
    if (m) { m.g.classList.add("active"); activeMarker = m.g; }
  }

  /* ---------------- 面板 ---------------- */
  function renderBadges(target, lines, closed) {
    target.innerHTML = "";
    sortLines(lines).forEach(function (l) {
      var b = document.createElement("span");
      b.className = "line-badge";
      b.style.setProperty("--lc", lineColor(l));
      var dot = document.createElement("i");
      b.appendChild(dot);
      b.appendChild(document.createTextNode(l));
      target.appendChild(b);
    });
    if (closed) {
      var c = document.createElement("span");
      c.className = "line-badge";
      c.style.setProperty("--lc", "#a16a2b");
      c.appendChild(document.createTextNode("施工封闭"));
      target.appendChild(c);
    }
  }

  function renderPanel(s) {
    var c = CUR[s.n];
    var lines = s.l.length ? s.l : ["北京地铁"];
    document.getElementById("pName").textContent = s.n;
    renderBadges(document.getElementById("pLines"), lines, s.closed);

    panel.style.setProperty("--accent", lineColor(lines[0]));

    var py = document.getElementById("pPy");
    var tag = document.getElementById("pTag");
    var storyBlock = document.getElementById("storyBlock");
    var pending = document.getElementById("pending");
    var nearby = document.getElementById("nearby");
    var foot = document.getElementById("panelFoot");
    var originTitle = document.getElementById("pOriginTitle");

    if (c) {
      py.textContent = c.py;
      tag.textContent = c.tag;
      originTitle.textContent = "地名由来";
      document.getElementById("pOrigin").textContent = c.origin;
      document.getElementById("pStory").textContent = c.story;
      storyBlock.hidden = false;
      pending.hidden = true;
      nearby.hidden = true;
      foot.hidden = false;

      var i = curatedNames.indexOf(s.n);
      document.getElementById("pCount").textContent = (i + 1) + " / " + curatedNames.length;
      document.getElementById("prevBtn").disabled = i <= 0;
      document.getElementById("nextBtn").disabled = i >= curatedNames.length - 1;
    } else {
      py.textContent = s.closed ? "施工封闭 · 站点简注" : "站点简注";
      tag.textContent = s.closed ? "施工封闭" : "待补充";
      originTitle.textContent = "地名简注";
      document.getElementById("pOrigin").textContent = briefOrigin(s.n);
      storyBlock.hidden = true;
      pending.hidden = false;
      foot.hidden = true;
      renderNearby(s);
      nearby.hidden = false;
    }

    document.getElementById("panelBody").scrollTop = 0;
  }

  function renderNearby(s) {
    var wrap = document.getElementById("nearbyList");
    wrap.innerHTML = "";
    var list = curatedNames
      .filter(function (n) { return n !== s.n; })
      .map(function (n) {
        var t = byName[n];
        var dx = t.x - s.x, dy = t.y - s.y;
        return { n: n, d: dx * dx + dy * dy };
      })
      .sort(function (a, b) { return a.d - b.d; })
      .slice(0, 3);

    list.forEach(function (item) {
      var b = document.createElement("button");
      b.type = "button";
      var i = document.createElement("i");
      b.appendChild(i);
      b.appendChild(document.createTextNode(item.n));
      b.addEventListener("click", function () {
        openStation(item.n, { fly: true });
      });
      wrap.appendChild(b);
    });
  }

  function openStation(name, opts) {
    var s = byName[name];
    if (!s) return;
    currentName = name;
    suggest.hidden = true;
    if (!s.c && markersLayer.classList.contains("only-curated")) setOnlyCurated(false);
    setActive(name);
    renderPanel(s);

    window.clearTimeout(panelTimer);
    panel.hidden = false;
    backdrop.hidden = false;
    window.requestAnimationFrame(function () {
      panel.classList.add("open");
      backdrop.classList.add("on");
    });

    try { history.replaceState(null, "", "#" + encodeURIComponent(name)); } catch (e) {}
    if (opts && opts.fly) flyToStation(name);
    interacted();
  }

  function closePanel() {
    if (panel.hidden) return;
    panel.classList.remove("open");
    backdrop.classList.remove("on");
    hideTip();
    if (activeMarker) activeMarker.classList.remove("active");
    activeMarker = null;
    currentName = null;
    panelTimer = window.setTimeout(function () {
      panel.hidden = true;
      backdrop.hidden = true;
    }, 320);
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }

  /* ---------------- 搜索 ---------------- */
  var search = document.getElementById("search");
  var suggest = document.getElementById("suggest");
  var pyIndex = {};
  Object.keys(CUR).forEach(function (n) {
    pyIndex[n] = normalize(CUR[n].py);
  });

  var suggestItems = [];
  var suggestActive = -1;

  function stationMeta(s) {
    var lines = sortLines(s.l).slice(0, 2).join(" / ");
    return (s.c ? "有故事" : "简注") + (lines ? " · " + lines : "");
  }

  function renderSuggest(q) {
    var query = q.trim();
    suggest.innerHTML = "";
    suggestItems = [];
    suggestActive = -1;

    if (!query) {
      suggest.hidden = true;
      return;
    }

    var qn = normalize(query);
    var hits = stations.filter(function (s) {
      return s.n.indexOf(query) !== -1 || (pyIndex[s.n] && pyIndex[s.n].indexOf(qn) !== -1);
    }).sort(function (a, b) {
      if (a.c !== b.c) return b.c - a.c;
      return a.n.length - b.n.length;
    }).slice(0, 8);

    if (!hits.length) {
      var empty = document.createElement("li");
      empty.className = "s-empty";
      empty.textContent = "没有找到这个站名";
      suggest.appendChild(empty);
      suggest.hidden = false;
      return;
    }

    hits.forEach(function (s) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");

      var nm = document.createElement("span");
      nm.className = "s-name";
      nm.textContent = s.n;

      var meta = document.createElement("span");
      meta.className = "s-lines";
      meta.textContent = stationMeta(s);

      li.appendChild(nm);
      li.appendChild(meta);

      if (s.c) {
        var badge = document.createElement("span");
        badge.className = "s-badge";
        badge.textContent = "有故事";
        li.appendChild(badge);
      }

      li.addEventListener("click", function () {
        chooseStation(s.n);
      });
      li.addEventListener("pointerenter", function () {
        Array.prototype.forEach.call(suggest.children, function (x) { x.classList.remove("is-active"); });
        li.classList.add("is-active");
      });

      suggest.appendChild(li);
      suggestItems.push({ name: s.n });
    });

    suggest.hidden = false;
  }

  function chooseStation(name) {
    search.value = "";
    suggest.hidden = true;
    suggest.innerHTML = "";
    search.blur();
    openStation(name, { fly: true });
  }

  search.addEventListener("input", function () {
    renderSuggest(search.value);
  });

  search.addEventListener("focus", function () {
    if (search.value.trim()) renderSuggest(search.value);
  });

  search.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      suggest.hidden = true;
      search.blur();
      return;
    }
    if (!suggestItems.length) {
      if (ev.key === "Enter" && search.value.trim()) {
        var first = stations.filter(function (s) {
          return s.n.indexOf(search.value.trim()) !== -1;
        })[0];
        if (first) chooseStation(first.n);
      }
      return;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      var dir = ev.key === "ArrowDown" ? 1 : -1;
      suggestActive = (suggestActive + dir + suggestItems.length) % suggestItems.length;
      Array.prototype.forEach.call(suggest.children, function (x, i) {
        x.classList.toggle("is-active", i === suggestActive);
      });
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      var pick = suggestItems[suggestActive >= 0 ? suggestActive : 0];
      if (pick) chooseStation(pick.name);
    }
  });

  document.addEventListener("click", function (ev) {
    if (!ev.target.closest(".searchbox")) suggest.hidden = true;
  });

  /* ---------------- 事件 ---------------- */
  document.getElementById("panelClose").addEventListener("click", closePanel);
  backdrop.addEventListener("click", closePanel);

  document.getElementById("prevBtn").addEventListener("click", function () {
    var i = curatedNames.indexOf(currentName);
    if (i > 0) openStation(curatedNames[i - 1], { fly: true });
  });
  document.getElementById("nextBtn").addEventListener("click", function () {
    var i = curatedNames.indexOf(currentName);
    if (i >= 0 && i < curatedNames.length - 1) openStation(curatedNames[i + 1], { fly: true });
  });

  document.getElementById("zoomIn").addEventListener("click", function () { zoomCenter(1.35); });
  document.getElementById("zoomOut").addEventListener("click", function () { zoomCenter(0.74); });
  document.getElementById("zoomReset").addEventListener("click", resetCamera);

  var onlyBtn = document.getElementById("onlyCurated");
  function setOnlyCurated(on) {
    onlyBtn.setAttribute("aria-pressed", on ? "true" : "false");
    markersLayer.classList.toggle("only-curated", on);
  }
  onlyBtn.addEventListener("click", function () {
    setOnlyCurated(onlyBtn.getAttribute("aria-pressed") !== "true");
  });
  document.getElementById("showCurated").addEventListener("click", function () {
    setOnlyCurated(true);
    closePanel();
    animateCamera({ k: 1, tx: 0, ty: 0 });
  });

  /* 平移 / 缩放 */
  var pointers = new Map();
  var drag = null;
  var pinch = null;
  var dragged = false;

  svg.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var p = clientToView(ev.clientX, ev.clientY);
    var factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0016));
    zoomAt(p.x, p.y, k * factor);
  }, { passive: false });

  svg.addEventListener("pointerdown", function (ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (ev.target.closest(".mk")) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
    hideTip();

    if (pointers.size === 1) {
      drag = { p: clientToView(ev.clientX, ev.clientY), tx: tx, ty: ty };
      dragged = false;
      svg.classList.add("grabbing");
    } else if (pointers.size === 2) {
      drag = null;
      startPinch();
    }
  });

  function startPinch() {
    var pts = Array.from(pointers.values());
    var a = pts[0], b = pts[1];
    var midClient = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: clientToView(midClient.x, midClient.y),
      k: k, tx: tx, ty: ty
    };
  }

  svg.addEventListener("pointermove", function (ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size === 2 && pinch) {
      var pts = Array.from(pointers.values());
      var a = pts[0], b = pts[1];
      var dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      var midClient = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      var mid = clientToView(midClient.x, midClient.y);
      var nextK = clamp(pinch.k * (dist / pinch.dist), 1, 10);
      var wx = (pinch.mid.x - pinch.tx) / pinch.k;
      var wy = (pinch.mid.y - pinch.ty) / pinch.k;
      k = nextK;
      tx = mid.x - wx * k;
      ty = mid.y - wy * k;
      clampCamera();
      scheduleRender();
      interacted();
      return;
    }

    if (drag) {
      var p = clientToView(ev.clientX, ev.clientY);
      var dx = p.x - drag.p.x;
      var dy = p.y - drag.p.y;
      if (Math.hypot(dx, dy) > 3) dragged = true;
      tx = drag.tx + dx;
      ty = drag.ty + dy;
      clampCamera();
      scheduleRender();
      interacted();
    }
  });

  function endPointer(ev) {
    pointers.delete(ev.pointerId);
    try { svg.releasePointerCapture(ev.pointerId); } catch (e) {}
    if (pointers.size === 0) {
      drag = null;
      pinch = null;
      svg.classList.remove("grabbing");
      if (dragged) {
        window.setTimeout(function () { dragged = false; }, 60);
      }
    } else if (pointers.size === 1) {
      pinch = null;
      var only = Array.from(pointers.values())[0];
      drag = { p: clientToView(only.x, only.y), tx: tx, ty: ty };
    }
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  svg.addEventListener("click", function (ev) {
    if (dragged) return;
    if (ev.target.closest(".mk")) return;
    closePanel();
  });

  svg.addEventListener("dblclick", function (ev) {
    if (ev.target.closest(".mk")) return;
    ev.preventDefault();
    var p = clientToView(ev.clientX, ev.clientY);
    zoomAt(p.x, p.y, k * 1.7);
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      if (!suggest.hidden) {
        suggest.hidden = true;
      } else if (!panel.hidden) {
        closePanel();
      }
      return;
    }
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (ev.key === "/" && !typing) {
      ev.preventDefault();
      search.focus();
    }
  });

  /* ---------------- 启动 ---------------- */
  document.getElementById("curatedStat").textContent = curatedNames.length;
  document.getElementById("totalStat").textContent = stations.length;

  function initCamera() {
    if (window.innerWidth <= 900) {
      k = 2.7;
      var cx = VB.w * 0.48;
      var cy = VB.h * 0.55;
      tx = VB.w / 2 - cx * k;
      ty = VB.h / 2 - cy * k;
      clampCamera();
    } else {
      k = 1; tx = 0; ty = 0;
    }
  }

  initCamera();
  buildMarkers();
  renderMap();

  var img = document.getElementById("mapImage");
  img.addEventListener("load", function () {
    img.classList.add("loaded");
    loading.classList.add("done");
  });
  img.addEventListener("error", function () {
    if (img.getAttribute("href") !== MAP.fallback) {
      img.setAttribute("href", MAP.fallback);
    } else {
      loading.innerHTML = "<span>线路图加载失败，请检查 assets 目录</span>";
    }
  });
  img.setAttribute("href", MAP.image);

  var initial = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if (initial && byName[initial]) {
    window.setTimeout(function () {
      openStation(initial, { fly: true });
    }, 320);
  }
})();
