/* =====================================================
   CITRA · Image Studio
   Frontend Logic
   ===================================================== */

// ---------- STATE ----------
const state = {
  image1: null,
  image2: null,
  binary:    { method: "manual", threshold: 127 },
  arith:     { mode: "constant", op: "add", value: 50 },
  logic:     { mode: "constant", op: "and", value: 128 },
  conv:      { filter: "mean" },
  morph:     { op: "erosion", se: "square", threshold: 127, iterations: 1 },
};

// ---------- PERSISTENCE ----------
const STORAGE_KEY = "citra_state_v1";

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      image1: state.image1 ? {
        image_id: state.image1.image_id,
        filename: state.image1.filename,
        width: state.image1.width,
        height: state.image1.height,
        channels: state.image1.channels,
      } : null,
      image2: state.image2 ? {
        image_id: state.image2.image_id,
        filename: state.image2.filename,
        width: state.image2.width,
        height: state.image2.height,
        channels: state.image2.channels,
      } : null,
      binary: { ...state.binary },
      arith:  { ...state.arith },
      logic:  { ...state.logic },
      conv:   { ...state.conv },
      morph:  { ...state.morph },
      activeTab: document.querySelector(".tool-btn.active")?.dataset.tab || "upload",
    }));
  } catch (e) { /* storage penuh / tidak tersedia */ }
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

// Muat state tersimpan sebelum UI dibangun
const _saved = loadSavedState();
if (_saved) {
  if (_saved.image1) state.image1 = { ..._saved.image1, preview: `/uploads/${_saved.image1.image_id}` };
  if (_saved.image2) state.image2 = { ..._saved.image2, preview: `/uploads/${_saved.image2.image_id}` };
  if (_saved.binary) Object.assign(state.binary, _saved.binary);
  if (_saved.arith)  Object.assign(state.arith,  _saved.arith);
  if (_saved.logic)  Object.assign(state.logic,  _saved.logic);
  if (_saved.conv)   Object.assign(state.conv,   _saved.conv);
  if (_saved.morph)  Object.assign(state.morph,  _saved.morph);
}

// histogram cache: key -> result data
const histCache = new Map();
let histCounter = 0;

// ---------- UTIL ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showToast(msg, type = "info") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (type === "error" ? " error" : "");
  setTimeout(() => t.classList.remove("show"), 2800);
}

function showLoading(show) {
  $("#loading").classList.toggle("hidden", !show);
}

async function apiCall(endpoint, body) {
  showLoading(true);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    showToast(err.message, "error");
    throw err;
  } finally {
    showLoading(false);
  }
}

function requireImage1() {
  if (!state.image1) {
    showToast("Unggah gambar utama dulu pada tab Galeri", "error");
    switchTab("upload");
    return false;
  }
  return true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------- TAB NAVIGATION ----------
function switchTab(name) {
  $$(".tool-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
  saveState();
}
$$(".tool-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ====================================================================
// UPLOAD (with fix for double-click bug)
// ====================================================================
function setupUpload(zoneId, inputId, cardId, imgId, metaId, removeId, slot, histBtnSelector, histPanelId) {
  const dz = $(`#${zoneId}`);
  const inp = $(`#${inputId}`);
  const card = $(`#${cardId}`);
  const img = $(`#${imgId}`);
  const meta = $(`#${metaId}`);
  const removeBtn = $(`#${removeId}`);
  const histBtn = document.querySelector(`[data-hist-btn="${histBtnSelector}"]`);
  const histPanel = $(`#${histPanelId}`);

  const MAX_UPLOAD_MB = 16;
  const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/bmp", "image/webp", "image/tiff", "image/gif"];
  const ALLOWED_EXT_HINT = "PNG · JPG · BMP · WEBP · TIFF · GIF";

  const handleFile = async (file) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      showToast(`Format tidak didukung. Gunakan: ${ALLOWED_EXT_HINT}`, "error");
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      showToast(`Ukuran file terlalu besar (${(file.size / 1024 / 1024).toFixed(1)} MB). Maksimal ${MAX_UPLOAD_MB} MB.`, "error");
      return;
    }
    const fd = new FormData();
    fd.append("image", file);
    showLoading(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      let data;
      try { data = await res.json(); } catch { throw new Error("Upload gagal: respons server tidak valid"); }
      if (!res.ok || data.error) throw new Error(data.error || "Upload gagal");

      state[slot] = data;
      img.src = data.preview;
      meta.innerHTML = `<strong>${escapeHtml(data.filename)}</strong> · ${data.width}×${data.height}px · ${data.channels} channel`;
      dz.classList.add("hidden");
      card.classList.remove("hidden");

      // Reset histogram state untuk gambar baru
      histPanel.classList.add("hidden");
      histPanel.innerHTML = "";
      histBtn.classList.remove("active");
      histBtn.textContent = "▼ Histogram";

      updateImageInfo();
      saveState();
      showToast(slot === "image1" ? "Gambar utama berhasil dimuat" : "Gambar kedua berhasil dimuat");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      showLoading(false);
      // Reset input value supaya re-pilih file yang sama tetap memicu change event
      inp.value = "";
    }
  };

  // FIX BUG: dropzone now uses <div>, only one click handler triggers file picker
  dz.addEventListener("click", () => inp.click());
  inp.addEventListener("change", (e) => handleFile(e.target.files[0]));

  // Drag & drop
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); })
  );
  ["dragleave"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); })
  );
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    const f = e.dataTransfer.files[0];
    handleFile(f);
  });

  removeBtn.addEventListener("click", () => {
    state[slot] = null;
    inp.value = "";
    dz.classList.remove("hidden");
    card.classList.add("hidden");
    histPanel.classList.add("hidden");
    histPanel.innerHTML = "";
    histBtn.classList.remove("active");
    histBtn.textContent = "▼ Histogram";
    updateImageInfo();
    saveState();
  });

  // Histogram toggle untuk preview
  histBtn.addEventListener("click", async () => {
    if (!state[slot]) return;
    if (!histPanel.classList.contains("hidden")) {
      histPanel.classList.add("hidden");
      histBtn.classList.remove("active");
      histBtn.textContent = "▼ Histogram";
      return;
    }
    histBtn.classList.add("active");
    histBtn.textContent = "▲ Sembunyikan";
    histPanel.classList.remove("hidden");
    await renderHistogramInto(histPanel, { image_id: state[slot].image_id });
  });
}

function updateImageInfo() {
  const info = $("#image-info");
  if (state.image1 && state.image2) {
    info.textContent = `2 gambar · ${state.image1.width}×${state.image1.height}`;
  } else if (state.image1) {
    info.textContent = `${state.image1.width}×${state.image1.height} · ${state.image1.channels}ch`;
  } else {
    info.textContent = "Belum ada gambar";
  }
}

setupUpload("dropzone1", "file-input-1", "preview-card-1", "preview-img-1", "preview-meta-1", "remove-1", "image1", "preview-1", "hist-preview-1");
setupUpload("dropzone2", "file-input-2", "preview-card-2", "preview-img-2", "preview-meta-2", "remove-2", "image2", "preview-2", "hist-preview-2");

// ====================================================================
// HISTOGRAM (inline, on-demand)
// ====================================================================
async function renderHistogramInto(panelEl, payload) {
  // Gunakan cache jika ada
  const cacheKey = JSON.stringify(payload);
  if (histCache.has(cacheKey)) {
    panelEl.innerHTML = histCache.get(cacheKey);
    return;
  }

  panelEl.innerHTML = `
    <div class="hist-loading">
      <div class="mini-spin"></div>
      Menghitung histogram...
    </div>
  `;

  try {
    const res = await fetch("/api/histogram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Histogram gagal");

    const html = `
      <img src="${data.result}" alt="Histogram">
      <div class="hist-stats">
        <div class="stat-item"><div class="stat-label">Min</div><div class="stat-value">${data.stats.min}</div></div>
        <div class="stat-item"><div class="stat-label">Max</div><div class="stat-value">${data.stats.max}</div></div>
        <div class="stat-item"><div class="stat-label">Mean</div><div class="stat-value">${data.stats.mean}</div></div>
        <div class="stat-item"><div class="stat-label">Std</div><div class="stat-value">${data.stats.std}</div></div>
      </div>
    `;
    panelEl.innerHTML = html;
    histCache.set(cacheKey, html);
  } catch (err) {
    panelEl.innerHTML = `<div class="hist-loading" style="color:var(--accent)">Gagal: ${escapeHtml(err.message)}</div>`;
  }
}

// ====================================================================
// RENDER RESULT CARDS (with histogram toggle per card)
// ====================================================================
function downloadBase64(src, filename) {
  const a = document.createElement("a");
  a.href = src;
  a.download = filename || "hasil.png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function renderCompare(containerId, items) {
  const c = $(`#${containerId}`);
  c.innerHTML = "";
  items.forEach((it) => {
    const histId = `hist-${++histCounter}`;
    const card = document.createElement("div");
    card.className = "img-card";

    // Histogram payload: result images use image_data (base64), uploaded images use image_id
    let histPayload = null;
    if (it.imageId) histPayload = { image_id: it.imageId };
    else if (it.src && it.src.startsWith("data:image/")) histPayload = { image_data: it.src };

    const isResult = it.src && it.src.startsWith("data:image/") && !it.imageId;

    card.innerHTML = `
      <div class="img-card-head">
        <span class="img-card-title">${escapeHtml(it.title)}</span>
        ${it.tag ? `<span class="img-card-tag">${escapeHtml(it.tag)}</span>` : ""}
      </div>
      <img src="${it.src}" alt="${escapeHtml(it.title)}">
      ${it.info ? `<div class="img-card-info">${escapeHtml(it.info)}</div>` : ""}
      <div class="img-actions">
        ${histPayload ? `<button class="btn-mini" data-toggle-hist="${histId}">▼ Histogram</button>` : ""}
        ${isResult ? `<button class="btn-mini btn-download">↓ Unduh</button>` : ""}
      </div>
      <div class="hist-panel hidden" id="${histId}"></div>
    `;
    c.appendChild(card);

    if (histPayload) {
      const btn = card.querySelector(`[data-toggle-hist="${histId}"]`);
      const panel = card.querySelector(`#${histId}`);
      btn.addEventListener("click", async () => {
        if (!panel.classList.contains("hidden")) {
          panel.classList.add("hidden");
          btn.classList.remove("active");
          btn.textContent = "▼ Histogram";
          return;
        }
        btn.classList.add("active");
        btn.textContent = "▲ Sembunyikan";
        panel.classList.remove("hidden");
        await renderHistogramInto(panel, histPayload);
      });
    }

    if (isResult) {
      const dlBtn = card.querySelector(".btn-download");
      if (dlBtn) {
        dlBtn.addEventListener("click", () => {
          downloadBase64(it.src, `${it.savePrefix || containerId}.png`);
        });
      }
    }
  });
}

// ====================================================================
// FITUR: GRAYSCALE
// ====================================================================
$('[data-action="grayscale"]').addEventListener("click", async () => {
  if (!requireImage1()) return;
  const r = await apiCall("/api/grayscale", { image_id: state.image1.image_id });
  renderCompare("compare-grayscale", [
    { title: "Gambar Asli", src: state.image1.preview, tag: "INPUT", imageId: state.image1.image_id },
    { title: "Hasil Grayscale", src: r.result, tag: "OUTPUT", info: r.info, savePrefix: "grayscale" },
  ]);
  showToast("Konversi grayscale selesai");
});

// ====================================================================
// FITUR: CITRA BINER
// ====================================================================
$$('[data-bin-method]').forEach((b) =>
  b.addEventListener("click", () => {
    $$('[data-bin-method]').forEach((x) => x.classList.toggle("active", x === b));
    state.binary.method = b.dataset.binMethod;
    $("#threshold-group").style.display = state.binary.method === "otsu" ? "none" : "block";
    saveState();
  })
);
$("#threshold-slider").addEventListener("input", (e) => {
  state.binary.threshold = parseInt(e.target.value);
  $("#threshold-val").textContent = e.target.value;
  saveState();
});

$('[data-action="binary"]').addEventListener("click", async () => {
  if (!requireImage1()) return;
  const r = await apiCall("/api/binary", {
    image_id: state.image1.image_id,
    threshold: state.binary.threshold,
    method: state.binary.method,
  });
  renderCompare("compare-binary", [
    { title: "Gambar Asli", src: state.image1.preview, tag: "INPUT", imageId: state.image1.image_id },
    { title: "Hasil Citra Biner", src: r.result, tag: "OUTPUT", info: r.info, savePrefix: "binary" },
  ]);
  showToast("Thresholding selesai");
});

// ====================================================================
// FITUR: ARITMATIKA
// ====================================================================
$$('[data-arith-mode]').forEach((b) =>
  b.addEventListener("click", () => {
    $$('[data-arith-mode]').forEach((x) => x.classList.toggle("active", x === b));
    state.arith.mode = b.dataset.arithMode;
    $("#arith-value-group").style.display = state.arith.mode === "constant" ? "block" : "none";
    saveState();
  })
);
$$('[data-arith-op]').forEach((b) =>
  b.addEventListener("click", () => {
    $$('[data-arith-op]').forEach((x) => x.classList.toggle("active", x === b));
    state.arith.op = b.dataset.arithOp;
    saveState();
  })
);
$("#arith-value").addEventListener("input", (e) => {
  state.arith.value = parseFloat(e.target.value);
  $("#arith-value-display").textContent = e.target.value;
  saveState();
});

$('[data-action="arithmetic"]').addEventListener("click", async () => {
  if (!requireImage1()) return;
  if (state.arith.mode === "dual" && !state.image2) {
    showToast("Mode 2-gambar butuh gambar kedua. Unggah pada tab Galeri.", "error");
    switchTab("upload");
    return;
  }
  const body = {
    image_id: state.image1.image_id,
    operation: state.arith.op,
    mode: state.arith.mode,
  };
  if (state.arith.mode === "constant") body.value = state.arith.value;
  else body.image_id2 = state.image2.image_id;

  const r = await apiCall("/api/arithmetic", body);
  const inputs = [{ title: "Gambar 1", src: state.image1.preview, tag: "INPUT 1", imageId: state.image1.image_id }];
  if (state.arith.mode === "dual") {
    inputs.push({ title: "Gambar 2", src: state.image2.preview, tag: "INPUT 2", imageId: state.image2.image_id });
  }
  inputs.push({ title: "Hasil", src: r.result, tag: "OUTPUT", info: r.info, savePrefix: `arith_${state.arith.op}` });
  $("#compare-arithmetic").style.gridTemplateColumns = inputs.length === 3 ? "repeat(3, 1fr)" : "1fr 1fr";
  renderCompare("compare-arithmetic", inputs);
  showToast("Operasi aritmatika selesai");
});

// ====================================================================
// FITUR: LOGIKA
// ====================================================================
$$('[data-logic-mode]').forEach((b) =>
  b.addEventListener("click", () => {
    $$('[data-logic-mode]').forEach((x) => x.classList.toggle("active", x === b));
    state.logic.mode = b.dataset.logicMode;
    updateLogicValueVisibility();
    saveState();
  })
);
$$('[data-logic-op]').forEach((b) =>
  b.addEventListener("click", () => {
    $$('[data-logic-op]').forEach((x) => x.classList.toggle("active", x === b));
    state.logic.op = b.dataset.logicOp;
    updateLogicValueVisibility();
    saveState();
  })
);
$("#logic-value").addEventListener("input", (e) => {
  state.logic.value = parseInt(e.target.value);
  $("#logic-value-display").textContent = e.target.value;
  saveState();
});

function updateLogicValueVisibility() {
  const hide = state.logic.op === "not" || state.logic.mode === "dual";
  $("#logic-value-group").style.display = hide ? "none" : "block";
}

$('[data-action="logical"]').addEventListener("click", async () => {
  if (!requireImage1()) return;
  if (state.logic.op !== "not" && state.logic.mode === "dual" && !state.image2) {
    showToast("Mode 2-gambar butuh gambar kedua. Unggah pada tab Galeri.", "error");
    switchTab("upload");
    return;
  }
  const body = {
    image_id: state.image1.image_id,
    operation: state.logic.op,
    mode: state.logic.mode,
  };
  if (state.logic.op !== "not") {
    if (state.logic.mode === "constant") body.value = state.logic.value;
    else body.image_id2 = state.image2.image_id;
  }
  const r = await apiCall("/api/logical", body);

  const inputs = [{ title: "Gambar 1", src: state.image1.preview, tag: "INPUT 1", imageId: state.image1.image_id }];
  if (state.logic.op !== "not" && state.logic.mode === "dual") {
    inputs.push({ title: "Gambar 2", src: state.image2.preview, tag: "INPUT 2", imageId: state.image2.image_id });
  }
  inputs.push({ title: "Hasil", src: r.result, tag: "OUTPUT", info: r.info, savePrefix: `logic_${state.logic.op}` });
  $("#compare-logical").style.gridTemplateColumns = inputs.length === 3 ? "repeat(3, 1fr)" : "1fr 1fr";
  renderCompare("compare-logical", inputs);
  showToast("Operasi logika selesai");
});

// ====================================================================
// FITUR: KONVOLUSI (with split Sobel)
// ====================================================================
$$('[data-filter]').forEach((b) =>
  b.addEventListener("click", () => {
    $$('[data-filter]').forEach((x) => x.classList.toggle("active", x === b));
    state.conv.filter = b.dataset.filter;
    saveState();
  })
);

$('[data-action="convolution"]').addEventListener("click", async () => {
  if (!requireImage1()) return;
  const r = await apiCall("/api/convolution", {
    image_id: state.image1.image_id,
    filter: state.conv.filter,
  });
  renderCompare("compare-convolution", [
    { title: "Gambar Asli", src: state.image1.preview, tag: "INPUT", imageId: state.image1.image_id },
    { title: "Hasil Konvolusi", src: r.result, tag: "OUTPUT", info: r.info, savePrefix: `conv_${state.conv.filter}` },
  ]);
  renderKernel(r.kernel);
  showToast("Konvolusi selesai");
});

function renderKernel(kernel) {
  const box = $("#kernel-display");
  if (!kernel) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");

  const buildMatrix = (matrix) => {
    let html = '<div class="kernel-matrix">';
    const cy = Math.floor(matrix.length / 2);
    const cx = Math.floor(matrix[0].length / 2);
    matrix.forEach((row, y) => {
      html += '<div class="kernel-row">';
      row.forEach((v, x) => {
        const isCenter = y === cy && x === cx;
        const display = (typeof v === "number" && v % 1 !== 0) ? v.toFixed(2) : v;
        html += `<div class="kernel-cell ${isCenter ? "center" : ""}">${display}</div>`;
      });
      html += "</div>";
    });
    html += "</div>";
    return html;
  };

  if (Array.isArray(kernel)) {
    box.innerHTML = `<h4>Kernel yang digunakan</h4>${buildMatrix(kernel)}`;
  } else {
    let html = `<h4>Kernel yang digunakan</h4>`;
    for (const [name, mat] of Object.entries(kernel)) {
      html += `<div style="display:inline-block;margin-right:24px;vertical-align:top">
        <p class="mono" style="margin-bottom:6px;color:var(--ink-soft)">${escapeHtml(name)}</p>
        ${buildMatrix(mat)}
      </div>`;
    }
    box.innerHTML = html;
  }
}

// ====================================================================
// FITUR: MORFOLOGI
// ====================================================================
const SE_INFO = {
  square: { label: "Square 3×3", matrix: [[1,1,1],[1,1,1],[1,1,1]] },
  cross:  { label: "Cross / Plus", matrix: [[0,1,0],[1,1,1],[0,1,0]] },
  diamond_x: { label: "Diamond X", matrix: [[1,0,1],[0,1,0],[1,0,1]] },
  vertical: { label: "Vertical", matrix: [[0,1,0],[0,1,0],[0,1,0]] },
  horizontal: { label: "Horizontal", matrix: [[0,0,0],[1,1,1],[0,0,0]] },
  diag_pos: { label: "Diagonal +", matrix: [[0,0,1],[0,1,0],[1,0,0]] },
  diag_neg: { label: "Diagonal -", matrix: [[1,0,0],[0,1,0],[0,0,1]] },
};

function buildSEGrid() {
  const grid = $("#se-grid");
  grid.innerHTML = "";
  for (const [key, info] of Object.entries(SE_INFO)) {
    const card = document.createElement("div");
    card.className = "se-card" + (key === state.morph.se ? " active" : "");
    card.dataset.se = key;
    let cells = "";
    info.matrix.forEach((row) => {
      row.forEach((v) => {
        cells += `<div class="se-cell ${v ? "on" : ""}">${v}</div>`;
      });
    });
    card.innerHTML = `
      <div class="se-matrix">${cells}</div>
      <div class="se-label">${info.label}</div>
    `;
    card.addEventListener("click", () => {
      $$(".se-card").forEach((c) => c.classList.toggle("active", c === card));
      state.morph.se = key;
      saveState();
    });
    grid.appendChild(card);
  }
}
buildSEGrid();

$$('[data-morph-op]').forEach((b) =>
  b.addEventListener("click", () => {
    $$('[data-morph-op]').forEach((x) => x.classList.toggle("active", x === b));
    state.morph.op = b.dataset.morphOp;
    saveState();
  })
);
$("#morph-threshold").addEventListener("input", (e) => {
  state.morph.threshold = parseInt(e.target.value);
  $("#morph-thresh-val").textContent = e.target.value;
  saveState();
});
$("#morph-iter").addEventListener("input", (e) => {
  state.morph.iterations = parseInt(e.target.value);
  $("#morph-iter-val").textContent = e.target.value;
  saveState();
});

$('[data-action="morphology"]').addEventListener("click", async () => {
  if (!requireImage1()) return;
  const r = await apiCall("/api/morphology", {
    image_id: state.image1.image_id,
    operation: state.morph.op,
    se: state.morph.se,
    threshold: state.morph.threshold,
    iterations: state.morph.iterations,
  });
  renderCompare("compare-morphology", [
    { title: "Gambar Asli", src: state.image1.preview, tag: "INPUT", imageId: state.image1.image_id },
    { title: "Citra Biner", src: r.binary_input, tag: "BINER" },
    { title: "Hasil Morfologi", src: r.result, tag: "OUTPUT", info: r.info, savePrefix: `morph_${state.morph.op}_${state.morph.se}` },
  ]);
  showToast("Operasi morfologi selesai");
});

// ====================================================================
// LIGHTBOX
// ====================================================================
(function initLightbox() {
  const lb      = $("#lightbox");
  const lbImg   = $("#lightbox-img");
  const lbClose = $("#lightbox-close");

  function open(src, alt) {
    lbImg.src = src;
    lbImg.alt = alt || "";
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function close() {
    lb.classList.remove("open");
    document.body.style.overflow = "";
    // Bersihkan src setelah animasi selesai
    setTimeout(() => { lbImg.src = ""; }, 240);
  }

  // Klik tombol tutup
  lbClose.addEventListener("click", close);

  // Klik overlay (bukan gambar) menutup
  lb.addEventListener("click", (e) => {
    if (e.target !== lbImg) close();
  });

  // Tekan Escape untuk menutup
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lb.classList.contains("open")) close();
  });

  // Delegasi klik pada semua gambar di img-card, upload-preview, dan hist-panel
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".img-card img, .upload-preview img, .hist-panel img");
    if (!img) return;
    // Jangan buka lightbox jika gambar belum dimuat atau src kosong
    if (!img.src || img.src === window.location.href) return;
    open(img.src, img.alt);
  });
})();

// ---------- INIT ----------
function restoreImageUI(slot, zoneId, cardId, imgId, metaId, histBtnSel, histPanelId) {
  const data = state[slot];
  if (!data) return;
  const dz = $(`#${zoneId}`);
  const card = $(`#${cardId}`);
  const imgEl = $(`#${imgId}`);
  const metaEl = $(`#${metaId}`);
  const histBtn = document.querySelector(`[data-hist-btn="${histBtnSel}"]`);
  const histPanel = $(`#${histPanelId}`);

  imgEl.src = data.preview;
  // Jika server tidak menemukan file, bersihkan state
  imgEl.onerror = () => {
    state[slot] = null;
    saveState();
    dz.classList.remove("hidden");
    card.classList.add("hidden");
    updateImageInfo();
  };
  metaEl.innerHTML = `<strong>${escapeHtml(data.filename)}</strong> · ${data.width}×${data.height}px · ${data.channels} channel`;
  dz.classList.add("hidden");
  card.classList.remove("hidden");
  histPanel.classList.add("hidden");
  histPanel.innerHTML = "";
  histBtn.classList.remove("active");
  histBtn.textContent = "▼ Histogram";
}

function restoreControlsUI() {
  if (!_saved) return;

  // Binary
  $("#threshold-slider").value = state.binary.threshold;
  $("#threshold-val").textContent = state.binary.threshold;
  $$('[data-bin-method]').forEach((b) =>
    b.classList.toggle("active", b.dataset.binMethod === state.binary.method)
  );
  $("#threshold-group").style.display = state.binary.method === "otsu" ? "none" : "block";

  // Arith
  $("#arith-value").value = state.arith.value;
  $("#arith-value-display").textContent = state.arith.value;
  $$('[data-arith-mode]').forEach((b) =>
    b.classList.toggle("active", b.dataset.arithMode === state.arith.mode)
  );
  $$('[data-arith-op]').forEach((b) =>
    b.classList.toggle("active", b.dataset.arithOp === state.arith.op)
  );
  $("#arith-value-group").style.display = state.arith.mode === "constant" ? "block" : "none";

  // Logic
  $("#logic-value").value = state.logic.value;
  $("#logic-value-display").textContent = state.logic.value;
  $$('[data-logic-mode]').forEach((b) =>
    b.classList.toggle("active", b.dataset.logicMode === state.logic.mode)
  );
  $$('[data-logic-op]').forEach((b) =>
    b.classList.toggle("active", b.dataset.logicOp === state.logic.op)
  );
  updateLogicValueVisibility();

  // Conv
  $$('[data-filter]').forEach((b) =>
    b.classList.toggle("active", b.dataset.filter === state.conv.filter)
  );

  // Morph
  $$('[data-morph-op]').forEach((b) =>
    b.classList.toggle("active", b.dataset.morphOp === state.morph.op)
  );
  $("#morph-threshold").value = state.morph.threshold;
  $("#morph-thresh-val").textContent = state.morph.threshold;
  $("#morph-iter").value = state.morph.iterations;
  $("#morph-iter-val").textContent = state.morph.iterations;

  // Tab aktif
  if (_saved.activeTab) switchTab(_saved.activeTab);
}

updateImageInfo();
restoreImageUI("image1", "dropzone1", "preview-card-1", "preview-img-1", "preview-meta-1", "preview-1", "hist-preview-1");
restoreImageUI("image2", "dropzone2", "preview-card-2", "preview-img-2", "preview-meta-2", "preview-2", "hist-preview-2");
restoreControlsUI();
