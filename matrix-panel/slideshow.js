document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".slideshow").forEach(initSlideshow);

  function initSlideshow(container) {
    const slides = container.querySelectorAll(".slide");
    const dotsWrap = container.querySelector(".slide-dots");
    const prevBtn = container.querySelector(".slide-btn.prev");
    const nextBtn = container.querySelector(".slide-btn.next");

    let current = 0;
    let timer = null;
    const DELAY = 6000;

    // build dots
    slides.forEach((_, i) => {
      const d = document.createElement("button");
      d.classList.add("dot");
      if (i === 0) d.classList.add("active");
      d.setAttribute("aria-label", "Slide " + (i + 1));
      d.addEventListener("click", () => goTo(i));
      dotsWrap.appendChild(d);
    });

    const dots = dotsWrap.querySelectorAll(".dot");

    function goTo(index) {
      // pause current video
      const curVid = slides[current].querySelector("video");
      if (curVid) curVid.pause();

      slides[current].classList.remove("active");
      dots[current].classList.remove("active");

      current = (index + slides.length) % slides.length;

      slides[current].classList.add("active");
      dots[current].classList.add("active");

      // play new video if present
      const newVid = slides[current].querySelector("video");
      if (newVid) {
        newVid.currentTime = 0;
        newVid.play().catch(() => {});
      }

      resetTimer();
    }

    function next() {
      goTo(current + 1);
    }
    function prev() {
      goTo(current - 1);
    }

    prevBtn.addEventListener("click", prev);
    nextBtn.addEventListener("click", next);

    // keyboard
    container.setAttribute("tabindex", "0");
    container.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    });

    // swipe
    let startX = 0;
    container.addEventListener(
      "touchstart",
      (e) => {
        startX = e.changedTouches[0].screenX;
      },
      { passive: true }
    );
    container.addEventListener(
      "touchend",
      (e) => {
        const diff = startX - e.changedTouches[0].screenX;
        if (Math.abs(diff) > 50) diff > 0 ? next() : prev();
      },
      { passive: true }
    );

    // autoplay timer
    function resetTimer() {
      clearInterval(timer);
      const vid = slides[current].querySelector("video");
      if (vid && !vid.loop) {
        // for non-looping videos, advance when video ends
        vid.onended = () => next();
      } else {
        timer = setInterval(next, DELAY);
      }
    }

    // pause on hover
    container.addEventListener("mouseenter", () => clearInterval(timer));
    container.addEventListener("mouseleave", () => resetTimer());

    // pause/play based on visibility
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const vid = slides[current].querySelector("video");
          if (entry.isIntersecting) {
            resetTimer();
            if (vid) vid.play().catch(() => {});
          } else {
            clearInterval(timer);
            if (vid) vid.pause();
          }
        });
      },
      { threshold: 0.3 }
    );
    obs.observe(container);

    // start first slide video if present
    const firstVid = slides[0].querySelector("video");
    if (firstVid) firstVid.play().catch(() => {});

    resetTimer();
  }
});
