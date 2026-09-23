import "./style.css";
import { assessOcrQuality, detectSensitive, isSupportedImageType } from "./detect";
import { recognize } from "./ocr";
import { burnRedactions, canvasToPngBlob, sha256Hex } from "./redact";
import { APP_VERSION, buildAuditReport, reportSummaryHtml, reportToJson } from "./report";
import type { AuditReport, BBox, OcrWord, RedactionBox, VerificationHit } from "./types";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};

const els = {
  dropzone: $<HTMLDivElement>("#dropzone"),
  fileInput: $<HTMLInputElement>("#file-input"),
  demoBtn: $<HTMLButtonElement>("#demo-btn"),
  uploadSection: $<HTMLElement>("#upload-section"),
  reviewSection: $<HTMLElement>("#review-section"),
  exportSection: $<HTMLElement>("#export-section"),
  stage: $<HTMLDivElement>("#stage"),
  beforeImg: $<HTMLImageElement>("#before-img"),
  boxesLayer: $<HTMLDivElement>("#boxes-layer"),
  detList: $<HTMLUListElement>("#det-list"),
  detCount: $<HTMLSpanElement>("#det-count"),
  detEmpty: $<HTMLParagraphElement>("#det-empty"),
  qualityWarn: $<HTMLDivElement>("#quality-warn"),
  redactBtn: $<HTMLButtonElement>("#redact-btn"),
  downloadBtn: $<HTMLButtonElement>("#download-btn"),
  cmpBefore: $<HTMLImageElement>("#cmp-before"),
  afterImg: $<HTMLImageElement>("#after-img"),
  hitsLayer: $<HTMLDivElement>("#hits-layer"),
  verifyBanner: $<HTMLDivElement>("#verify-banner"),
  reportCard: $<HTMLDivElement>("#report-card"),
  reportBody: $<HTMLDivElement>("#report-body"),
  reportJsonBtn: $<HTMLButtonElement>("#report-json-btn"),
  reportPrintBtn: $<HTMLButtonElement>("#report-print-btn"),
  status: $<HTMLDivElement>("#status"),
  spinner: $<HTMLDivElement>("#spinner"),
  spinnerText: $<HTMLParagraphElement>("#spinner-text"),
};

interface AppState {
  fileName: string;
  objectUrl: string | null;
  words: OcrWord[];
  boxes: RedactionBox[];
  selectedId: string | null;
  exportCanvas: HTMLCanvasElement | null;
  exportPng: Uint8Array | null;
  exportSha: string | null;
  report: AuditReport | null;
  hits: VerificationHit[];
}

const state: AppState = {
  fileName: "image",
  objectUrl: null,
  words: [],
  boxes: [],
  selectedId: null,
  exportCanvas: null,
  exportPng: null,
  exportSha: null,
  report: null,
  hits: [],
};

const CATEGORY_LABEL: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  "payment-card": "Payment card",
  "postal-code": "Postal code",
  ssn: "SSN",
  ipv4: "IP address",
  jwt: "Token (JWT)",
  manual: "Manual",
};

function status(msg: string) {
  els.status.textContent = msg;
}

function showSpinner(text: string) {
  els.spinnerText.textContent = text;
  els.spinner.hidden = false;
}
function updateSpinner(text: string) {
  els.spinnerText.textContent = text;
}
function hideSpinner() {
  els.spinner.hidden = true;
}

function setStep(step: "upload" | "review" | "export" | "verify") {
  const order = ["upload", "review", "export", "verify"];
  const idx = order.indexOf(step);
  document.querySelectorAll<HTMLElement>(".step").forEach((el) => {
    const i = order.indexOf(el.dataset.step ?? "");
    el.classList.toggle("is-active", i === idx);
    el.classList.toggle("is-done", i < idx);
  });
}

let boxSeq = 0;
function newBoxId() {
  return `box-${++boxSeq}`;
}

function scaleFactor(): number {
  const w = els.beforeImg.getBoundingClientRect().width;
  const natural = els.beforeImg.naturalWidth || 1;
  return w / natural;
}

function renderBoxes() {
  const scale = scaleFactor();
  els.boxesLayer.innerHTML = "";
  for (const b of state.boxes) {
    const div = document.createElement("div");
    div.className = "box" + (b.enabled ? "" : " disabled") + (b.id === state.selectedId ? " selected" : "");
    div.style.setProperty("--box-color", `var(--cat-${b.category}, var(--accent-2))`);
    div.style.left = `${b.bbox.x0 * scale}px`;
    div.style.top = `${b.bbox.y0 * scale}px`;
    div.style.width = `${(b.bbox.x1 - b.bbox.x0) * scale}px`;
    div.style.height = `${(b.bbox.y1 - b.bbox.y0) * scale}px`;
    div.tabIndex = 0;
    div.dataset.id = b.id;
    const conf = b.confidence !== null ? `, confidence ${Math.round(b.confidence * 100)}%` : "";
    div.setAttribute("role", "button");
    div.setAttribute(
      "aria-label",
      `${CATEGORY_LABEL[b.category]} redaction box${conf}${b.enabled ? "" : ", disabled"}`,
    );
    const tag = document.createElement("span");
    tag.className = "box-tag";
    tag.textContent =
      CATEGORY_LABEL[b.category] + (b.confidence !== null ? ` ${Math.round(b.confidence * 100)}%` : "");
    div.appendChild(tag);
    els.boxesLayer.appendChild(div);
  }
}

function renderList() {
  els.detList.innerHTML = "";
  els.detEmpty.hidden = state.boxes.length !== 0;
  els.detCount.textContent = String(state.boxes.filter((b) => b.enabled).length);
  for (const b of state.boxes) {
    const li = document.createElement("li");
    li.className = "det-item";
    li.tabIndex = 0;
    li.dataset.id = b.id;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = b.enabled;
    cb.setAttribute("aria-label", `Include ${CATEGORY_LABEL[b.category]} box`);
    cb.addEventListener("change", () => {
      b.enabled = cb.checked;
      refreshAfterBoxChange();
    });
    cb.addEventListener("click", (e) => e.stopPropagation());

    const dot = document.createElement("span");
    dot.className = "det-dot";
    dot.style.background = `var(--cat-${b.category}, var(--accent-2))`;

    const meta = document.createElement("span");
    meta.className = "det-meta";
    const cat = document.createElement("div");
    cat.className = "cat";
    cat.textContent = CATEGORY_LABEL[b.category];
    const rule = document.createElement("div");
    rule.className = "rule";
    rule.textContent = b.source === "manual" ? "manual" : b.rule;
    meta.append(cat, rule);

    const conf = document.createElement("span");
    conf.className = "det-conf";
    conf.textContent = b.confidence !== null ? `${Math.round(b.confidence * 100)}%` : "—";

    const del = document.createElement("button");
    del.className = "det-del";
    del.type = "button";
    del.textContent = "✕";
    del.setAttribute("aria-label", `Remove ${CATEGORY_LABEL[b.category]} box`);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeBox(b.id);
    });

    li.append(cb, dot, meta, conf, del);
    li.addEventListener("click", () => selectBox(b.id));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectBox(b.id);
      }
    });
    els.detList.appendChild(li);
  }
}

function refreshAfterBoxChange() {
  renderBoxes();
  renderList();
  els.redactBtn.disabled = state.boxes.filter((b) => b.enabled).length === 0;
  const n = state.boxes.filter((b) => b.enabled).length;
  status(`${n} redaction box${n === 1 ? "" : "es"} will be applied.`);
}

function selectBox(id: string | null) {
  state.selectedId = id;
  renderBoxes();
  const el = id ? els.boxesLayer.querySelector(`[data-id="${id}"]`) : null;
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
}

function removeBox(id: string) {
  state.boxes = state.boxes.filter((b) => b.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  refreshAfterBoxChange();
}

async function loadImage(file: Blob, name: string) {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(file);
  state.fileName = name;
  const img = els.beforeImg;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = state.objectUrl!;
  });
  await scanImage();
}

async function scanImage() {
  showSpinner("Running OCR locally…");
  status("Scanning image with local OCR");
  try {
    const res = await recognize(els.beforeImg, (_s, p) =>
      updateSpinner(`Running OCR locally… ${Math.round(p * 100)}%`),
    );
    state.words = res.words;
    const quality = assessOcrQuality(res.words);
    if (quality.suspicious) {
      els.qualityWarn.hidden = false;
      els.qualityWarn.textContent =
        `Low OCR confidence on this image (${quality.wordCount} words, ` +
        `${Math.round(quality.meanConfidence * 100)}% avg). Dark or low-resolution ` +
        `images can silently look clean — treat \u201cno detections\u201d as unreliable ` +
        `and add boxes manually.`;
    } else {
      els.qualityWarn.hidden = true;
    }
    const detections = detectSensitive(res.words);
    state.boxes = detections.map((d) => ({
      id: newBoxId(),
      bbox: d.bbox,
      category: d.category,
      rule: d.rule,
      confidence: d.confidence,
      enabled: true,
      source: "detector" as const,
    }));
    state.selectedId = null;
    els.uploadSection.hidden = true;
    els.reviewSection.hidden = false;
    setStep("review");
    refreshAfterBoxChange();
    status(
      detections.length
        ? `Found ${detections.length} item${detections.length === 1 ? "" : "s"} to review.`
        : "No sensitive items detected. Add boxes manually if needed.",
    );
  } catch (err) {
    status(`OCR failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hideSpinner();
  }
}

async function redactAndExport() {
  const img = els.beforeImg;
  const enabled = state.boxes.filter((b) => b.enabled).map((b) => b.bbox);
  if (enabled.length === 0) return;
  showSpinner("Burning redactions & hashing export…");
  status("Applying redactions");
  try {
    const canvas = burnRedactions(img, img.naturalWidth, img.naturalHeight, enabled);
    state.exportCanvas = canvas;
    const blob = await canvasToPngBlob(canvas);
    state.exportPng = new Uint8Array(await blob.arrayBuffer());
    state.exportSha = await sha256Hex(state.exportPng);

    els.afterImg.onload = () => renderHits();
    els.afterImg.src = canvas.toDataURL("image/png");
    els.cmpBefore.src = state.objectUrl!;
    els.exportSection.hidden = false;
    setStep("export");
    els.exportSection.scrollIntoView({ behavior: "smooth", block: "start" });
    status("Export ready. Verifying pixels…");
    await verifyExport();
  } catch (err) {
    status(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hideSpinner();
  }
}

async function verifyExport() {
  if (!state.exportCanvas || !state.exportSha) return;
  showSpinner("Re-scanning exported pixels…");
  status("Verification pass: re-running OCR on the exported image");
  try {
    const res = await recognize(state.exportCanvas, (_s, p) =>
      updateSpinner(`Re-scanning export… ${Math.round(p * 100)}%`),
    );
    const hits: VerificationHit[] = detectSensitive(res.words).map((d) => ({
      category: d.category,
      rule: d.rule,
      confidence: d.confidence,
      bbox: d.bbox,
    }));
    state.hits = hits;
    renderHits();

    state.report = buildAuditReport({
      inputFileName: state.fileName,
      inputWidth: els.beforeImg.naturalWidth,
      inputHeight: els.beforeImg.naturalHeight,
      outputSha256: state.exportSha,
      outputWidth: state.exportCanvas.width,
      outputHeight: state.exportCanvas.height,
      boxes: state.boxes,
      hits,
    });
    els.reportBody.innerHTML = reportSummaryHtml(state.report);
    els.reportCard.hidden = false;

    const banner = els.verifyBanner;
    banner.hidden = false;
    if (hits.length === 0) {
      banner.classList.remove("warn");
      banner.innerHTML =
        `<strong>Verification clean:</strong> no detectors fired on the exported pixels.` +
        `<p class="sub">This only means the detectors found nothing — it is a check, ` +
        `not proof all PII is gone. Detectors don't cover names, addresses, DOBs, ` +
        `account/SIN/IBAN numbers, OTPs or non-NA phones, and OCR can miss handwriting ` +
        `or low-resolution text. Eyeball the export before sharing.</p>`;
      status("Verification complete: no residual detections.");
    } else {
      banner.classList.add("warn");
      banner.innerHTML =
        `<strong>${hits.length} residual hit${hits.length === 1 ? "" : "s"}</strong> — ` +
        `the exported pixels still trigger detectors (see outlined regions). ` +
        `Go back, widen those boxes, and export again.` +
        `<p class="sub">Even a clean scan isn't a guarantee; always review visually.</p>`;
      status(`Verification complete: ${hits.length} residual detections found.`);
    }
    setStep("verify");
  } catch (err) {
    status(`Verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function renderHits() {
  els.hitsLayer.innerHTML = "";
  const img = els.afterImg;
  const natural = state.exportCanvas?.width ?? 1;
  const scale = img.getBoundingClientRect().width / natural;
  for (const h of state.hits) {
    const div = document.createElement("div");
    div.className = "hit";
    div.title = `${CATEGORY_LABEL[h.category]} (${h.rule})`;
    div.style.left = `${h.bbox.x0 * scale}px`;
    div.style.top = `${h.bbox.y0 * scale}px`;
    div.style.width = `${(h.bbox.x1 - h.bbox.x0) * scale}px`;
    div.style.height = `${(h.bbox.y1 - h.bbox.y0) * scale}px`;
    els.hitsLayer.appendChild(div);
  }
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function downloadPng() {
  if (!state.exportPng) return;
  const base = state.fileName.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_") || "image";
  download(
    new Blob([state.exportPng], { type: "image/png" }),
    `redacted-${base}.png`,
  );
}

function downloadJson() {
  if (!state.report) return;
  download(
    new Blob([reportToJson(state.report)], { type: "application/json" }),
    `redactproof-audit-${state.exportSha?.slice(0, 8) ?? "report"}.json`,
  );
}

function reset() {
  state.words = [];
  state.boxes = [];
  state.selectedId = null;
  state.exportCanvas = null;
  state.exportPng = null;
  state.exportSha = null;
  state.report = null;
  state.hits = [];
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  els.reviewSection.hidden = true;
  els.exportSection.hidden = true;
  els.uploadSection.hidden = false;
  els.verifyBanner.hidden = true;
  els.reportCard.hidden = true;
  els.hitsLayer.innerHTML = "";
  els.fileInput.value = "";
  setStep("upload");
  status("Ready. Upload a screenshot to begin.");
}

// --- manual box drawing ---
let dragStart: { x: number; y: number } | null = null;
let pendingEl: HTMLDivElement | null = null;

function stagePoint(e: PointerEvent): { x: number; y: number } {
  const rect = els.stage.getBoundingClientRect();
  const scale = scaleFactor();
  return {
    x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)) / scale,
    y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)) / scale,
  };
}

els.stage.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest(".box")) return; // boxes handle their own clicks
  dragStart = stagePoint(e);
  pendingEl = document.createElement("div");
  pendingEl.className = "box pending";
  pendingEl.style.setProperty("--box-color", "var(--cat-manual)");
  els.boxesLayer.appendChild(pendingEl);
  els.stage.classList.add("dragging");
  els.stage.setPointerCapture(e.pointerId);
});

els.stage.addEventListener("pointermove", (e) => {
  if (!dragStart || !pendingEl) return;
  const cur = stagePoint(e);
  const scale = scaleFactor();
  const x0 = Math.min(dragStart.x, cur.x);
  const y0 = Math.min(dragStart.y, cur.y);
  const x1 = Math.max(dragStart.x, cur.x);
  const y1 = Math.max(dragStart.y, cur.y);
  pendingEl.style.left = `${x0 * scale}px`;
  pendingEl.style.top = `${y0 * scale}px`;
  pendingEl.style.width = `${(x1 - x0) * scale}px`;
  pendingEl.style.height = `${(y1 - y0) * scale}px`;
});

els.stage.addEventListener("pointercancel", () => {
  dragStart = null;
  pendingEl?.remove();
  pendingEl = null;
  els.stage.classList.remove("dragging");
});

els.stage.addEventListener("pointerup", (e) => {
  if (!dragStart) return;
  const cur = stagePoint(e);
  const bbox: BBox = {
    x0: Math.min(dragStart.x, cur.x),
    y0: Math.min(dragStart.y, cur.y),
    x1: Math.max(dragStart.x, cur.x),
    y1: Math.max(dragStart.y, cur.y),
  };
  dragStart = null;
  pendingEl?.remove();
  pendingEl = null;
  els.stage.classList.remove("dragging");
  els.stage.releasePointerCapture(e.pointerId);
  if (bbox.x1 - bbox.x0 < 6 || bbox.y1 - bbox.y0 < 6) return;
  const box: RedactionBox = {
    id: newBoxId(),
    bbox,
    category: "manual",
    rule: "manual",
    confidence: null,
    enabled: true,
    source: "manual",
  };
  state.boxes.push(box);
  refreshAfterBoxChange();
  selectBox(box.id);
  status("Manual redaction box added.");
});

// box interactions (delegated)
els.boxesLayer.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest(".box");
  if (el instanceof HTMLElement && el.dataset.id) selectBox(el.dataset.id);
});
els.boxesLayer.addEventListener("keydown", (e) => {
  const el = (e.target as HTMLElement).closest(".box");
  if (!(el instanceof HTMLElement) || !el.dataset.id) return;
  const id = el.dataset.id;
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    removeBox(id);
  } else if (e.key.toLowerCase() === "d") {
    const b = state.boxes.find((x) => x.id === id);
    if (b) {
      b.enabled = !b.enabled;
      refreshAfterBoxChange();
    }
  }
});

// upload wiring
els.dropzone.addEventListener("click", () => els.fileInput.click());
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});
function tryLoad(file: Blob, name: string, mime: string) {
  if (!isSupportedImageType(mime, name)) {
    status(
      `Unsupported file type (${mime || "unknown"}). Please upload a PNG or JPG — ` +
        `PDFs aren't supported in this version; export the page to PNG first.`,
    );
    return;
  }
  loadImage(file, name).catch((err) =>
    status(`Couldn't read that image: ${err instanceof Error ? err.message : String(err)}`),
  );
}

els.fileInput.addEventListener("change", () => {
  const f = els.fileInput.files?.[0];
  if (f) tryLoad(f, f.name, f.type);
});
["dragover", "dragenter"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragover");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
  }),
);
els.dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) tryLoad(f, f.name, f.type);
});

els.demoBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("demo.png");
    if (!res.ok) throw new Error("demo.png missing");
    const blob = await res.blob();
    await loadImage(blob, "demo.png").catch((err) => status(String(err)));
  } catch (err) {
    status(`Demo load failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

els.redactBtn.addEventListener("click", () => void redactAndExport());
els.downloadBtn.addEventListener("click", downloadPng);
els.reportJsonBtn.addEventListener("click", downloadJson);
els.reportPrintBtn.addEventListener("click", () => window.print());
$<HTMLButtonElement>("#reset-btn-1").addEventListener("click", reset);
$<HTMLButtonElement>("#reset-btn-2").addEventListener("click", reset);

new ResizeObserver(() => {
  renderBoxes();
  renderHits();
}).observe(els.stage);

status(`RedactProof ${APP_VERSION} ready. Upload a screenshot to begin.`);
