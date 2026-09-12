/*!
 * Canvas UI — Grid component, WebGL vanilla build (ported for static hosting).
 * Upstream: https://github.com/DavidHDev/canvas-ui — https://canvasui.dev
 * Ported from src/components/live/Grid.tsx + src/lib/rect-cache.ts.
 * Engine, shaders and behavior unchanged; React wrapper replaced by a small
 * DOM helper (initCanvasUIGrid) with graceful no-op fallback.
 *
 * License (MIT + Commons Clause v1.0), Copyright (c) 2026 David Haz:
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, and distribute the Software as part of
 * an application, website, or product, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * Commons Clause Restriction: You may use this Software, including for any
 * commercial purpose, so long as you do not sell, sublicense, or redistribute
 * the components themselves - whether alone, in a bundle, or as a ported version.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
 */
(function () {
  "use strict";

  var DEFAULTS = {
    tileSize: 150,
    gap: 0,
    cornerRadius: 0,
    amplitude: 2.5,
    waveSpeed: 0.5,
    frequency: 12,
    waveWidth: 0.05,
    fadeTime: 0.2,
    maxLift: 1,
    jitter: 0,
    liftHeight: 60,
    perspective: 1200,
    tilt: 1,
    shading: 0.05,
    tint: [0, 0.33, 1],
    tintStrength: 0.1,
    idleRipples: 0,
  };

  var MAX_TRAIL = 64;
  var TRAIL_SPACING = 0.03;
  var IDLE_DELAY = 3;

  var VERT = "#version 300 es\nprecision highp float;\nlayout(location = 0) in vec2 aPos;\nout vec2 vUv;\nvoid main () {\n  vUv = aPos * 0.5 + 0.5;\n  gl_Position = vec4(aPos, 0.0, 1.0);\n}";

  var TILE_FRAG = "#version 300 es\nprecision highp float;\nout vec4 outColor;\nuniform sampler2D uTrail;\nuniform int uTrailCount;\nuniform float uWorldPerTile;\nuniform float uWaveSpeed;\nuniform float uFrequency;\nuniform float uWaveWidth;\nuniform float uFadeTime;\nuniform float uAmplitude;\nuniform float uJitter;\nuniform float uMaxLift;\n\nvec2 hash2 (vec2 p) {\n  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));\n  return fract(sin(p) * 43758.5453123) - 0.5;\n}\n\nvoid main () {\n  vec2 tile = floor(gl_FragCoord.xy);\n  vec2 world = (tile + 0.5) * uWorldPerTile + hash2(tile) * uJitter * 0.12;\n\n  float waveHeight = 0.0;\n  float totalWeight = 0.0;\n\n  for (int i = 0; i < 64; i++) {\n    if (i >= uTrailCount) break;\n\n    vec4 td = texelFetch(uTrail, ivec2(i, 0), 0);\n    vec2 delta = world - td.xy;\n    float dist = length(delta);\n    float relDist = dist - uWaveSpeed * td.z;\n\n    float window = exp(-(relDist * relDist) / (uWaveWidth * uWaveWidth));\n\n    float fade = exp(-td.z / uFadeTime);\n    float atten = 1.0 / (1.0 + dist * 3.0);\n    float weight = fade * window * atten * td.w;\n    waveHeight += weight * cos(uFrequency * relDist);\n    totalWeight += weight;\n  }\n\n  float lift = clamp(\n    waveHeight / max(totalWeight, 1.0) * uAmplitude, -uMaxLift, uMaxLift\n  );\n\n  outColor = vec4(lift * 0.5 + 0.5, 0.0, 0.0, 1.0);\n}";

  var FRAG = "#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 outColor;\nuniform sampler2D uContent;\nuniform sampler2D uTiles;\nuniform vec2 uResolution;\nuniform ivec2 uGridTiles;\nuniform float uTilePx;\nuniform float uGapPx;\nuniform float uCornerPx;\nuniform float uLiftPx;\nuniform float uPersp;\nuniform vec2 uVanish;\nuniform float uShading;\nuniform vec3 uTint;\nuniform float uTintStrength;\nuniform float uMaxX;\nuniform float uHasContent;\n\nfloat tileLift (ivec2 idx) {\n  idx = clamp(idx, ivec2(0), uGridTiles - 1);\n  return texelFetch(uTiles, idx, 0).r * 2.0 - 1.0;\n}\n\nfloat roundedBox (vec2 p, vec2 b, float r) {\n  vec2 q = abs(p) - b + r;\n  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;\n}\n\nfloat tileSd (vec2 w, ivec2 idx, float halfSize) {\n  vec2 center = (vec2(idx) + 0.5) * uTilePx;\n  return roundedBox(w - center, vec2(halfSize), min(uCornerPx, halfSize));\n}\n\nvec2 unproject (vec2 p, float z) {\n  return uVanish + (p - uVanish) * (uPersp - z) / uPersp;\n}\n\nvoid main () {\n  if (vUv.x > uMaxX) {\n    outColor = vec4(0.0);\n    return;\n  }\n\n  vec2 pos = vUv * uResolution;\n  float halfSize = uTilePx * 0.5 - uGapPx * 0.5;\n\n  float bestZ = -1e6;\n  float edgeSd = 1.0;\n  ivec2 bestIdx = ivec2(-1);\n  vec2 bestW = pos;\n  float bestLift = 0.0;\n  bool bestIsWall = false;\n  vec2 wallN = vec2(0.0);\n  ivec2 lastIdx = ivec2(-9999);\n\n  for (int k = 0; k < 8; k++) {\n    float probeZ = (float(k) / 3.5 - 1.0) * uLiftPx;\n    ivec2 idx = clamp(\n      ivec2(floor(unproject(pos, probeZ) / uTilePx)),\n      ivec2(0), uGridTiles - 1\n    );\n    if (all(equal(idx, lastIdx))) continue;\n    lastIdx = idx;\n\n    float lift = tileLift(idx);\n    float h = lift * uLiftPx;\n\n    if (h <= bestZ) continue;\n\n    vec2 wh = unproject(pos, h);\n    float sdTop = tileSd(wh, idx, halfSize);\n\n    if (sdTop < 0.75) {\n      bestZ = h;\n      edgeSd = sdTop;\n      bestIdx = idx;\n      bestW = wh;\n      bestLift = lift;\n      bestIsWall = false;\n    } else if (h > 0.0) {\n      float sd0 = tileSd(pos, idx, halfSize);\n      if (sd0 < 0.75) {\n        float za = 0.0;\n        float zb = h;\n        for (int r = 0; r < 3; r++) {\n          float zm = (za + zb) * 0.5;\n          float sm = tileSd(unproject(pos, zm), idx, halfSize);\n          if (sm < 0.0) { za = zm; } else { zb = zm; }\n        }\n        float zStar = (za + zb) * 0.5;\n        if (zStar > bestZ) {\n          vec2 wz = unproject(pos, zStar);\n          vec2 e = vec2(0.75, 0.0);\n          wallN = normalize(vec2(\n            tileSd(wz + e.xy, idx, halfSize) - tileSd(wz - e.xy, idx, halfSize),\n            tileSd(wz + e.yx, idx, halfSize) - tileSd(wz - e.yx, idx, halfSize)\n          ) + 1e-5);\n          bestZ = zStar;\n          edgeSd = sd0;\n          bestIdx = idx;\n          bestW = wz;\n          bestLift = lift;\n          bestIsWall = true;\n        }\n      }\n    }\n  }\n\n  if (bestIdx.x < 0) {\n    outColor = vec4(0.0);\n    return;\n  }\n  float mask = 1.0 - smoothstep(-0.75, 0.75, edgeSd);\n  if (mask <= 0.0) {\n    outColor = vec4(0.0);\n    return;\n  }\n\n  vec2 tileOrigin = vec2(bestIdx) * uTilePx;\n  vec2 samplePos = clamp(bestW, tileOrigin + 0.5, tileOrigin + uTilePx - 0.5);\n  vec2 sampleUv = samplePos / uResolution;\n  sampleUv.x = min(sampleUv.x, uMaxX - 0.002);\n  vec4 content;\n  if (uHasContent > 0.5) {\n    content = texture(uContent, vec2(sampleUv.x, 1.0 - sampleUv.y));\n  } else {\n    float liftAmt = clamp(abs(bestLift), 0.0, 1.0);\n    content = vec4(\n      mix(vec3(0.62), uTint, clamp(uTintStrength, 0.0, 1.0)),\n      liftAmt * 0.55);\n  }\n\n  float t = clamp(bestLift, 0.0, 1.0) * uTintStrength;\n  vec3 col;\n  float alpha;\n\n  if (bestIsWall) {\n    vec2 lightDir = normalize(vec2(-0.55, 0.8));\n    float facing = dot(wallN, lightDir);\n    float shade = 1.0 - (0.5 - 0.32 * facing) * uShading;\n    col = content.rgb * shade;\n\n    alpha = uHasContent > 0.5 ? max(content.a, 0.85) : min(content.a * 1.5, 0.85);\n  } else {\n    float gx = tileLift(bestIdx + ivec2(1, 0)) - tileLift(bestIdx - ivec2(1, 0));\n    float gy = tileLift(bestIdx + ivec2(0, 1)) - tileLift(bestIdx - ivec2(0, 1));\n    float shade = (gy - gx) * 0.25 * uShading;\n    shade += clamp(bestLift, -1.0, 1.0) * 0.1 * uShading;\n    col = content.rgb * (1.0 + shade * 0.85) + shade * 0.12;\n    alpha = clamp(content.a + t + abs(shade) * 0.5, 0.0, 1.0);\n  }\n\n  col = mix(col, uTint, t);\n  float aOut = alpha * mask;\n  outColor = vec4(col * aOut, aOut);\n}";

  function createRectCache(element) {
    var current = element.getBoundingClientRect();
    function refresh() {
      current = element.getBoundingClientRect();
    }
    var observer = new ResizeObserver(refresh);
    observer.observe(element);
    window.addEventListener("resize", refresh, { passive: true });
    window.addEventListener("scroll", refresh, { capture: true, passive: true });
    return {
      get current() {
        return current;
      },
      destroy: function () {
        observer.disconnect();
        window.removeEventListener("resize", refresh);
        window.removeEventListener("scroll", refresh, true);
      },
    };
  }

  function supportsHtmlInCanvas() {
    try {
      var probe = document.createElement("canvas");
      var ctx = probe.getContext("2d");
      return Boolean(
        ctx &&
          typeof ctx.drawElementImage === "function" &&
          typeof probe.requestPaint === "function"
      );
    } catch (e) {
      return false;
    }
  }

  function createGrid(elements, options) {
    var config = Object.assign({}, DEFAULTS, options || {});
    var source = elements.source;
    var content = elements.content;
    var output = elements.output;

    var gl = output.getContext("webgl2", {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: true,
    });
    if (!gl || gl.isContextLost()) return null;

    var sourceCtx = source.getContext("2d");
    var paintable = source;
    var htmlInCanvas = Boolean(
      sourceCtx &&
        typeof sourceCtx.drawElementImage === "function" &&
        typeof paintable.requestPaint === "function"
    );

    var contentDirty = false;
    var wake = function () {};

    if (htmlInCanvas) {
      paintable.onpaint = function () {
        try {
          sourceCtx.reset();
          sourceCtx.drawElementImage(content, 0, 0);
          contentDirty = true;
          wake();
        } catch (e) {}
      };
    }

    function compile(type, text) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Grid shader error:", gl.getShaderInfoLog(shader));
      }
      return shader;
    }

    function link(fragText) {
      var vertexShader = compile(gl.VERTEX_SHADER, VERT);
      var fragmentShader = compile(gl.FRAGMENT_SHADER, fragText);
      var program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      var uniforms = {};
      var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < count; i++) {
        var info = gl.getActiveUniform(program, i);
        uniforms[info.name] = gl.getUniformLocation(program, info.name);
      }
      return { program: program, uniforms: uniforms, vertexShader: vertexShader, fragmentShader: fragmentShader };
    }

    var mainPass = link(FRAG);
    var tilePass = link(TILE_FRAG);

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var contentTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

    var trailData = new Float32Array(MAX_TRAIL * 4);
    var trailTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, trailTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_TRAIL, 1, 0, gl.RGBA, gl.FLOAT, trailData);

    function dpr() {
      return Math.min(window.devicePixelRatio || 1, 2);
    }

    var tileTexture = null;
    var tileFbo = null;
    var tilesX = 0;
    var tilesY = 0;

    function ensureTileTarget() {
      var tilePx = Math.max(config.tileSize, 8) * dpr();
      var nx = Math.max(1, Math.ceil(output.width / tilePx));
      var ny = Math.max(1, Math.ceil(output.height / tilePx));
      if (tileTexture && nx === tilesX && ny === tilesY) return;
      tilesX = nx;
      tilesY = ny;
      if (tileTexture) gl.deleteTexture(tileTexture);
      if (tileFbo) gl.deleteFramebuffer(tileFbo);
      tileTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tileTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tilesX, tilesY, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      tileFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, tileFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tileTexture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    var contentMaxX = 1;

    function syncCanvasSize() {
      var scale = dpr();
      var width = Math.max(1, Math.round(output.clientWidth * scale));
      var height = Math.max(1, Math.round(output.clientHeight * scale));
      if (output.width !== width || output.height !== height) {
        output.width = width;
        output.height = height;
      }
      contentMaxX = Math.min(1, Math.max(0.05, content.clientWidth / Math.max(output.clientWidth, 1)));
      if (htmlInCanvas) {
        var cssWidth = Math.max(1, Math.round(source.clientWidth));
        var cssHeight = Math.max(1, Math.round(source.clientHeight));
        if (source.width !== cssWidth * scale || source.height !== cssHeight * scale) {
          source.width = cssWidth * scale;
          source.height = cssHeight * scale;
        }
        paintable.requestPaint();
      }
    }

    syncCanvasSize();

    function uploadContent() {
      if (!htmlInCanvas || !contentDirty) return;
      contentDirty = false;
      gl.bindTexture(gl.TEXTURE_2D, contentTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }

    var trail = [];
    var lastPoint = null;
    var timeSinceMove = IDLE_DELAY;
    var idleTimer = 0;

    function addTrailPoint(point) {
      if (trail.length >= MAX_TRAIL) trail.shift();
      trail.push(point);
    }

    function updateTrail(delta) {
      var expiry = Math.max(config.fadeTime, 0.1) * 4;
      for (var i = trail.length - 1; i >= 0; i--) {
        trail[i].age += delta;
        if (trail[i].age > expiry) trail.splice(i, 1);
      }

      timeSinceMove += delta;
      if (config.idleRipples > 0 && timeSinceMove >= IDLE_DELAY) {
        idleTimer += delta;
        if (idleTimer >= config.idleRipples) {
          idleTimer = 0;
          var aspect = Math.max(output.clientWidth, 1) / Math.max(output.clientHeight, 1);
          addTrailPoint({
            x: (0.2 + Math.random() * 0.6) * aspect,
            y: 0.2 + Math.random() * 0.6,
            age: 0,
            strength: 0.8 + Math.random() * 0.3,
          });
        }
      }

      var count = Math.min(trail.length, MAX_TRAIL);
      for (var j = 0; j < count; j++) {
        var ti = j * 4;
        trailData[ti] = trail[j].x;
        trailData[ti + 1] = trail[j].y;
        trailData[ti + 2] = trail[j].age;
        trailData[ti + 3] = trail[j].strength;
      }
      gl.bindTexture(gl.TEXTURE_2D, trailTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_TRAIL, 1, gl.RGBA, gl.FLOAT, trailData);
      return count;
    }

    var vanishX = 0.5;
    var vanishY = 0.5;
    var vanishTargetX = 0.5;
    var vanishTargetY = 0.5;

    function render(trailCount, delta) {
      uploadContent();
      ensureTileTarget();
      var scale = output.width / Math.max(output.clientWidth, 1);
      var tilePx = Math.max(config.tileSize, 8) * scale;

      var ease = 1 - Math.exp(-delta * 4);
      vanishX += (vanishTargetX - vanishX) * ease;
      vanishY += (vanishTargetY - vanishY) * ease;

      gl.useProgram(tilePass.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, trailTexture);
      gl.uniform1i(tilePass.uniforms.uTrail, 0);
      gl.uniform1i(tilePass.uniforms.uTrailCount, trailCount);
      gl.uniform1f(tilePass.uniforms.uWorldPerTile, tilePx / output.height);
      gl.uniform1f(tilePass.uniforms.uWaveSpeed, Math.max(config.waveSpeed, 0.01));
      gl.uniform1f(tilePass.uniforms.uFrequency, config.frequency);
      gl.uniform1f(tilePass.uniforms.uWaveWidth, Math.max(config.waveWidth, 0.01));
      gl.uniform1f(tilePass.uniforms.uFadeTime, Math.max(config.fadeTime, 0.1));
      gl.uniform1f(tilePass.uniforms.uAmplitude, config.amplitude);
      gl.uniform1f(tilePass.uniforms.uJitter, config.jitter);
      gl.uniform1f(tilePass.uniforms.uMaxLift, Math.max(config.maxLift, 0.01));
      gl.bindFramebuffer(gl.FRAMEBUFFER, tileFbo);
      gl.viewport(0, 0, tilesX, tilesY);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(mainPass.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, contentTexture);
      gl.uniform1i(mainPass.uniforms.uContent, 0);
      gl.uniform1f(mainPass.uniforms.uHasContent, htmlInCanvas ? 1 : 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tileTexture);
      gl.uniform1i(mainPass.uniforms.uTiles, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(mainPass.uniforms.uResolution, output.width, output.height);
      gl.uniform2i(mainPass.uniforms.uGridTiles, tilesX, tilesY);
      gl.uniform1f(mainPass.uniforms.uTilePx, tilePx);
      gl.uniform1f(mainPass.uniforms.uGapPx, Math.max(config.gap, 0) * scale);
      gl.uniform1f(mainPass.uniforms.uCornerPx, Math.max(config.cornerRadius, 0) * scale);
      gl.uniform1f(mainPass.uniforms.uLiftPx, Math.max(config.liftHeight, 0) * scale);
      gl.uniform1f(mainPass.uniforms.uPersp, Math.max(config.perspective, 100) * scale);
      gl.uniform2f(
        mainPass.uniforms.uVanish,
        (0.5 + (vanishX - 0.5) * config.tilt) * output.width,
        (0.5 + (0.5 - vanishY) * config.tilt) * output.height
      );
      gl.uniform1f(mainPass.uniforms.uShading, config.shading);
      gl.uniform3f(mainPass.uniforms.uTint, config.tint[0], config.tint[1], config.tint[2]);
      gl.uniform1f(mainPass.uniforms.uTintStrength, config.tintStrength);
      gl.uniform1f(mainPass.uniforms.uMaxX, contentMaxX);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, output.width, output.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    var raf = 0;
    var lastTime = performance.now();
    var destroyed = false;
    var running = false;
    var visible = true;

    var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    var reducedMotion = motionQuery.matches;

    function frame(now) {
      if (destroyed) return;
      if (!visible) {
        running = false;
        return;
      }
      var delta = Math.min((now - lastTime) / 1000, 1 / 30);
      lastTime = now;
      var trailCount = reducedMotion ? 0 : updateTrail(delta);
      render(trailCount, delta);
      var settling =
        Math.abs(vanishX - vanishTargetX) + Math.abs(vanishY - vanishTargetY) > 0.001;
      var animating =
        !reducedMotion && (trailCount > 0 || config.idleRipples > 0 || settling);
      if (!animating && !contentDirty) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (destroyed || running || !visible) return;
      running = true;
      lastTime = performance.now();
      raf = requestAnimationFrame(frame);
    }

    wake = start;
    start();

    function onMotionChange() {
      reducedMotion = motionQuery.matches;
      if (reducedMotion) trail.length = 0;
      start();
    }
    motionQuery.addEventListener("change", onMotionChange);

    var observer = new ResizeObserver(function () {
      syncCanvasSize();
      start();
    });
    observer.observe(output);
    observer.observe(content);

    var intersection = new IntersectionObserver(function (entries) {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) start();
    });
    intersection.observe(output);

    var listenTarget = output.parentElement || output;

    var rectCache = createRectCache(output);

    function onPointerMove(event) {
      if (reducedMotion) return;
      var rect = rectCache.current;
      var aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
      var fx = (event.clientX - rect.left) / Math.max(rect.width, 1);
      var fy = (event.clientY - rect.top) / Math.max(rect.height, 1);
      vanishTargetX = fx;
      vanishTargetY = fy;
      var x = fx * aspect;
      var y = 1 - fy;

      var distDelta = 0.2;
      if (lastPoint) {
        var dx = x - lastPoint.x;
        var dy = y - lastPoint.y;
        distDelta = Math.hypot(dx, dy);
        if (distDelta < TRAIL_SPACING) {
          start();
          return;
        }
      }

      addTrailPoint({
        x: x,
        y: y,
        age: 0,
        strength: Math.min(Math.max(distDelta * 6, 0.25), 1.2),
      });
      lastPoint = { x: x, y: y };
      timeSinceMove = 0;
      idleTimer = 0;
      start();
    }

    function onPointerLeave() {
      vanishTargetX = 0.5;
      vanishTargetY = 0.5;
      start();
    }

    listenTarget.addEventListener("pointermove", onPointerMove, { passive: true });
    listenTarget.addEventListener("pointerleave", onPointerLeave, { passive: true });

    return {
      setOptions: function (next) {
        var changed = false;
        for (var key in next) {
          if (Object.prototype.hasOwnProperty.call(next, key) && config[key] !== next[key]) {
            changed = true;
            break;
          }
        }
        if (!changed) return;
        Object.assign(config, next);
        start();
      },
      resize: function () {
        syncCanvasSize();
        start();
      },
      destroy: function () {
        destroyed = true;
        rectCache.destroy();
        cancelAnimationFrame(raf);
        observer.disconnect();
        intersection.disconnect();
        motionQuery.removeEventListener("change", onMotionChange);
        listenTarget.removeEventListener("pointermove", onPointerMove);
        listenTarget.removeEventListener("pointerleave", onPointerLeave);
        gl.deleteTexture(contentTexture);
        gl.deleteTexture(trailTexture);
        if (tileTexture) gl.deleteTexture(tileTexture);
        if (tileFbo) gl.deleteFramebuffer(tileFbo);
        [mainPass, tilePass].forEach(function (pass) {
          gl.deleteProgram(pass.program);
          gl.deleteShader(pass.vertexShader);
          gl.deleteShader(pass.fragmentShader);
        });
        gl.deleteBuffer(quad);
        if (htmlInCanvas) paintable.onpaint = null;
      },
    };
  }

  /**
   * Vanilla DOM helper: upgrades a wrapper + content pair into a live
   * html-in-canvas Grid. Returns the instance, or null when the effect
   * cannot run (content is left untouched in normal flow — graceful
   * fallback). Skips entirely for prefers-reduced-motion users.
   */
  function initCanvasUIGrid(wrap, content, options) {
    if (!wrap || !content || wrap.dataset.fxGridBound) return null;
    wrap.dataset.fxGridBound = "1";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    if (!supportsHtmlInCanvas()) return null;

    function lockHeight() {
      wrap.style.minHeight = content.offsetHeight + "px";
    }
    lockHeight();

    var source = document.createElement("canvas");
    source.setAttribute("layoutsubtree", "true");
    source.className = "fx-source";

    var output = document.createElement("canvas");
    output.className = "fx-output";
    output.setAttribute("aria-hidden", "true");

    wrap.insertBefore(source, wrap.firstChild);
    content.classList.add("fx-live");
    source.appendChild(content);
    wrap.appendChild(output);
    lockHeight();

    var ro = new ResizeObserver(lockHeight);
    ro.observe(content);

    var instance = createGrid({ source: source, content: content, output: output }, options);
    if (!instance) {
      ro.disconnect();
      wrap.insertBefore(content, source);
      content.classList.remove("fx-live");
      source.remove();
      output.remove();
      wrap.style.minHeight = "";
      delete wrap.dataset.fxGridBound;
      return null;
    }
    return instance;
  }

  window.CanvasUIGrid = {
    createGrid: createGrid,
    supportsHtmlInCanvas: supportsHtmlInCanvas,
    initCanvasUIGrid: initCanvasUIGrid,
  };
})();
