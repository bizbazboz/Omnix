/* Trusted sizing bridge. Email HTML cannot run scripts or access the parent origin. */
(() => {
  const script = document.currentScript;
  const parentOrigin = new URL(script.src).origin;
  let previous = 0;
  let pending = false;
  const measure = () => {
    pending = false;
    const body = document.body;
    const root = document.getElementById("omnix-email-root");
    if (!body || !root) return;
    root.style.setProperty("width", "auto", "important");
    root.style.setProperty("transform", "none", "important");
    let scale = 1;
    if (script.dataset.fit !== "false") {
      const available = document.documentElement.clientWidth;
      const natural = Math.max(
        root.scrollWidth,
        root.getBoundingClientRect().width
      );
      if (available > 0 && natural > available + 1) {
        root.style.setProperty("width", natural + "px", "important");
        scale =
          available /
          Math.max(root.scrollWidth, root.getBoundingClientRect().width);
        root.style.setProperty("transform", `scale(${scale})`, "important");
      }
    }
    const height = Math.min(
      1000000,
      Math.max(
        1,
        Math.ceil(
          Math.max(
            root.getBoundingClientRect().height,
            root.scrollHeight * scale
          ) +
            (script.dataset.fit === "false"
              ? window.innerHeight - document.documentElement.clientHeight
              : 0)
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
      node.style.setProperty("width", "100%", "important");
      node.style.setProperty("min-width", "0", "important");
      node.style.setProperty("margin", "0", "important");
      node.style.setProperty("padding", "0", "important");
      node.style.setProperty("height", "auto", "important");
      node.style.setProperty("min-height", "0", "important");
      node.style.setProperty("overflow", "hidden", "important");
    }
    if (script.dataset.fit === "false") {
      document.body.style.setProperty("overflow", "visible", "important");
      document.documentElement.style.setProperty(
        "overflow-x",
        "auto",
        "important"
      );
    }
    new ResizeObserver(schedule).observe(document.body);
    const root = document.getElementById("omnix-email-root");
    if (root) new ResizeObserver(schedule).observe(root);
    new MutationObserver((records) => {
      // Ignore the bridge's own layout writes to avoid a resize feedback loop.
      if (
        records.some(
          (record) =>
            record.type !== "attributes" ||
            record.attributeName !== "style" ||
            ![document.documentElement, document.body, root].includes(
              record.target
            )
        )
      )
        schedule();
    }).observe(document.body, {
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
