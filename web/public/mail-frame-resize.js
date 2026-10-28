/* Trusted sizing bridge. Email HTML cannot run scripts or access the parent origin. */
(() => {
  const script = document.currentScript;
  const parentOrigin = new URL(script.src).origin;
  let previous = 0;
  let pending = false;
  const measure = () => {
    pending = false;
    const body = document.body;
    if (!body) return;
    const height = Math.min(
      1000000,
      Math.max(
        1,
        Math.ceil(
          Math.max(body.scrollHeight, body.getBoundingClientRect().height)
        )
      )
    );
    if (height !== previous) {
      previous = height;
      parent.postMessage({ type: "omnix-email-height", height }, parentOrigin);
    }
  };
  const schedule = () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(measure);
    }
  };
  const setup = () => {
    for (const node of [document.documentElement, document.body]) {
      node.style.setProperty("height", "auto", "important");
      node.style.setProperty("min-height", "0", "important");
      node.style.setProperty("overflow", "hidden", "important");
    }
    new ResizeObserver(schedule).observe(document.body);
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });
    addEventListener("load", schedule, true);
    addEventListener("resize", schedule);
    schedule();
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
