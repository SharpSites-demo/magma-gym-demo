/* MAGMA GYM — reveal-on-scroll (CSS transitions, IO-triggered) */
(function () {
  "use strict";
  var els = document.querySelectorAll(".row, .stat, .split-copy, .visit-panel, .final-inner");
  if (!els.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  var style = document.createElement("style");
  style.textContent = ".rv{opacity:0;transform:translateY(18px);transition:opacity .6s ease,transform .6s ease}.rv.in{opacity:1;transform:none}";
  document.head.appendChild(style);
  els.forEach(function (el) { el.classList.add("rv"); });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -30px 0px" });
  els.forEach(function (el) { io.observe(el); });
})();
