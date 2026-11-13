// CoSign customizer — swap parts & toggle layers (vanilla JS)
(function () {
  const compose = document.getElementById("compose");
  if (!compose) return;

  const layers = {
    kepala: compose.querySelector('[data-layer="kepala"]'),
    badan: compose.querySelector('[data-layer="badan"]'),
    background: compose.querySelector('[data-layer="background"]'),
  };

  // Pick a part for a category → swap the layer image
  document.querySelectorAll(".part-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kat = btn.getAttribute("data-kategori");
      const src = btn.getAttribute("data-src");
      const layer = layers[kat];
      if (!layer || !src) return;
      layer.src = src;
      layer.classList.remove("hidden");
      document.querySelectorAll(`.part-thumb[data-kategori="${kat}"]`).forEach((b) => {
        b.classList.toggle("ring-2", b === btn);
        b.classList.toggle("ring-indigo-500", b === btn);
      });
      // ensure toggle reflects visibility
      const cb = document.querySelector(`.layer-toggle[data-kategori="${kat}"]`);
      if (cb) cb.checked = true;
    });
  });

  // Toggle layer visibility
  document.querySelectorAll(".layer-toggle").forEach((cb) => {
    cb.addEventListener("change", () => {
      const kat = cb.getAttribute("data-kategori");
      const layer = layers[kat];
      if (!layer) return;
      layer.classList.toggle("hidden", !cb.checked);
    });
  });

  // Export the current composition as a PNG (client-side canvas)
  const exportBtn = document.getElementById("export-png");
  if (exportBtn) {
    exportBtn.addEventListener("click", async () => {
      const W = 900;
      const H = 1200;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(0, 0, W, H);

      const load = (img) =>
        new Promise((resolve) => {
          const src = img && img.getAttribute("src");
          if (!src) return resolve(null);
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => resolve(null);
          i.src = src;
        });

      const [bg, body, head] = await Promise.all([
        load(layers.background),
        load(layers.badan),
        load(layers.kepala),
      ]);

      // background: object-cover over the whole canvas
      if (bg && !layers.background.classList.contains("hidden")) {
        const scale = Math.max(W / bg.width, H / bg.height);
        const dw = bg.width * scale;
        const dh = bg.height * scale;
        ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      // body: 60% width, centered, bottom aligned
      if (body && !layers.badan.classList.contains("hidden")) {
        const dw = W * 0.6;
        const dh = dw * (body.height / body.width);
        ctx.drawImage(body, (W - dw) / 2, H - dh, dw, dh);
      }
      // head: 40% width, centered, top offset (matches top-4 on the preview)
      if (head && !layers.kepala.classList.contains("hidden")) {
        const dw = W * 0.4;
        const dh = dw * (head.height / head.width);
        ctx.drawImage(head, (W - dw) / 2, W * (16 / 448), dw, dh);
      }

      const a = document.createElement("a");
      a.download = "cosign-composition.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    });
  }
})();