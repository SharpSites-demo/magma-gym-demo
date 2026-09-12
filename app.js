/* MAGMA GYM — interactions (Canvas UI Grid hero + reveal-on-scroll) */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Canvas UI Grid: 3D tile waves over the hero ---- */
  var host = document.getElementById("fxHost");
  var content = document.getElementById("fxContent");
  if (host && content && window.CanvasUIGrid) {
    try {
      window.CanvasUIGrid.initCanvasUIGrid(host, content, {
        tileSize: 110,
        gap: 2,
        cornerRadius: 10,
        amplitude: 2.2,
        waveSpeed: 0.55,
        frequency: 10,
        waveWidth: 0.06,
        fadeTime: 0.35,
        maxLift: 0.9,
        jitter: 0.25,
        liftHeight: 46,
        perspective: 1400,
        tilt: 0.85,
        shading: 0.12,
        tint: [1.0, 0.42, 0.17],
        tintStrength: 0.28,
        idleRipples: 4.5,
      });
    } catch (e) {
      /* graceful fallback: hero backdrop stays as normal DOM */
    }
  }

  /* ---- Reveal on scroll (CSS transitions, IO-triggered) ---- */
  var revealEls = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  }
})();
