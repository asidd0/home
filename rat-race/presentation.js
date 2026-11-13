const stage = document.getElementById("stage");
const host = document.getElementById("canvas-host");
const status = document.getElementById("status");
const slideText = document.getElementById("slide-text");
const counter = document.getElementById("counter");
const title = document.getElementById("slide-title");
const progress = document.getElementById("progress");
const previous = document.getElementById("previous");
const next = document.getElementById("next");
const fullscreen = document.getElementById("fullscreen");
const blackout = document.getElementById("blackout");
const help = document.getElementById("help");
const helpDialog = document.getElementById("help-dialog");
const closeHelp = document.getElementById("close-help");

let pdf;
let slides = [];
let pageCount = 65;
let slideCount = 29;
let requestedPage = readHash();
let revision = 0;
let rendering = false;
let renderTask;
let resizeFrame;
let layoutSignature = "";
let presentationMode = false;
let nativeFullscreenActive = false;
let fullscreenRevision = 0;
let statusMessage = "";
let presentationNotice = "";
let noticeTimer;
const pages = new Map();

function readHash() {
  const value = new URLSearchParams(location.hash.slice(1)).get("page");
  return value && /^\d+$/.test(value) ? Math.max(1, Number(value)) : 1;
}

function focusStage() {
  stage.focus({ preventScroll: true });
}

function showStatus(message) {
  statusMessage = message;
  status.textContent = statusMessage || presentationNotice;
}

function clearPresentationNotice() {
  clearTimeout(noticeTimer);
  presentationNotice = "";
  showStatus(statusMessage);
}

function showPresentationNotice(message) {
  clearTimeout(noticeTimer);
  presentationNotice = message;
  showStatus(statusMessage);
  noticeTimer = setTimeout(clearPresentationNotice, 4000);
}

function dimensions() {
  const width = host.clientWidth || stage.clientWidth || window.innerWidth;
  const height = host.clientHeight || stage.clientHeight || window.innerHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  return { width, height, ratio, signature: `${width}:${height}:${ratio}` };
}

function requestPage(page, writeHash = true) {
  requestedPage = Math.max(1, Math.min(pageCount, page));
  revision += 1;
  renderTask?.cancel();
  if (writeHash) {
    const url = new URL(location.href);
    url.hash = `page=${requestedPage}`;
    history.replaceState(history.state, "", url);
  }
  previous.disabled = !pdf || requestedPage === 1;
  next.disabled = !pdf || requestedPage === pageCount;
  void renderLatest();
}

function getPage(number) {
  if (!pages.has(number)) {
    pages.set(number, pdf.getPage(number).catch(error => {
      pages.delete(number);
      throw error;
    }));
  }
  return pages.get(number);
}

async function renderLatest() {
  if (!pdf || rendering) return;
  rendering = true;
  stage.setAttribute("aria-busy", "true");
  try {
    while (true) {
      const currentRevision = revision;
      const pageNumber = requestedPage;
      try {
        const page = await getPage(pageNumber);
        if (currentRevision !== revision) continue;
        const size = dimensions();
        layoutSignature = size.signature;
        const natural = page.getViewport({ scale: 1 });
        const scale = Math.min(size.width / natural.width, size.height / natural.height);
        const viewport = page.getViewport({ scale });
        // Each render owns its canvas; cancelled or superseded work stays offscreen.
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width * size.ratio));
        canvas.height = Math.max(1, Math.ceil(viewport.height * size.ratio));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("aria-hidden", "true");
        renderTask = page.render({
          canvasContext: canvas.getContext("2d", { alpha: false }),
          viewport,
          transform: size.ratio === 1 ? null : [size.ratio, 0, 0, size.ratio, 0, 0],
          background: "#ffffff",
        });
        await renderTask.promise;
        renderTask = undefined;
        if (currentRevision !== revision) continue;
        const metadata = slides.find(slide => slide.page === pageNumber);
        const text = metadata?.text ?? (await page.getTextContent()).items
          .map(item => item.str || "").join(" ");
        if (currentRevision !== revision) continue;
        host.replaceChildren(canvas);
        slideText.textContent = text;
        counter.textContent = metadata?.slide
          ? `Slide ${metadata.slide} / ${slideCount} · Step ${pageNumber} / ${pageCount}`
          : `Step ${pageNumber} / ${pageCount}`;
        title.textContent = metadata?.title || "The Rat Race at Work";
        stage.setAttribute("aria-label", metadata?.slide
          ? `Slide ${metadata.slide} of ${slideCount}, step ${pageNumber} of ${pageCount}: ${title.textContent}`
          : `Page ${pageNumber} of ${pageCount}: ${title.textContent}`);
        progress.max = pageCount;
        progress.value = pageNumber;
        showStatus("");
        // Parse neighboring pages ahead of the next key press without rendering them.
        void Promise.allSettled([pageNumber - 1, pageNumber + 1]
          .filter(number => number >= 1 && number <= pageCount).map(getPage));
      } catch (error) {
        if (currentRevision !== revision || error?.name === "RenderingCancelledException") continue;
        console.error("Unable to render the presentation page.", error);
        showStatus(`Page ${pageNumber} could not be displayed. Try another page, reload, or use Download PDF.`);
      } finally {
        renderTask = undefined;
      }
      if (currentRevision === revision) break;
    }
  } finally {
    rendering = false;
    stage.setAttribute("aria-busy", "false");
  }
}

function toggleBlackout(force) {
  const blank = typeof force === "boolean" ? force : !document.body.classList.contains("is-blank");
  document.body.classList.toggle("is-blank", blank);
  blackout.setAttribute("aria-pressed", String(blank));
  focusStage();
}

function dismissHelp() {
  if (helpDialog.open) helpDialog.close();
  help.setAttribute("aria-pressed", "false");
  focusStage();
}

function toggleHelp() {
  if (helpDialog.open) return dismissHelp();
  helpDialog.showModal();
  help.setAttribute("aria-pressed", "true");
  closeHelp.focus();
}

function setPresentationMode(active) {
  presentationMode = active;
  document.body.classList.toggle("is-presenting", active);
  fullscreen.setAttribute("aria-pressed", String(active));
  fullscreen.setAttribute("aria-label", active ? "Exit presentation" : "Start presentation");
  fullscreen.textContent = active ? "Exit presentation" : "Present";
  if (!active) clearPresentationNotice();
  queueResize();
  focusStage();
}

async function exitPresentation() {
  fullscreenRevision += 1;
  setPresentationMode(false);
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      showPresentationNotice("Use your browser’s fullscreen command to leave fullscreen.");
    }
  }
  focusStage();
}

async function toggleFullscreen() {
  if (presentationMode || document.fullscreenElement) return exitPresentation();
  const currentRevision = ++fullscreenRevision;
  setPresentationMode(true);
  try {
    if (!document.documentElement.requestFullscreen) throw new Error("Fullscreen unavailable");
    await document.documentElement.requestFullscreen();
    // An exit may arrive while the browser is still granting fullscreen.
    if (!presentationMode && document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {
    if (currentRevision === fullscreenRevision && presentationMode) {
      showPresentationNotice("Presentation mode is on. Use your browser’s fullscreen command to hide browser controls.");
    }
  }
  focusStage();
}

function queueResize() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if (dimensions().signature !== layoutSignature) requestPage(requestedPage, false);
  });
}

previous.addEventListener("click", () => { requestPage(requestedPage - 1); focusStage(); });
next.addEventListener("click", () => { requestPage(requestedPage + 1); focusStage(); });
fullscreen.addEventListener("click", toggleFullscreen);
document.getElementById("exit-presentation")?.addEventListener("click", exitPresentation);
blackout.addEventListener("click", () => toggleBlackout());
help.addEventListener("click", toggleHelp);
closeHelp.addEventListener("click", dismissHelp);
helpDialog.addEventListener("cancel", event => { event.preventDefault(); dismissHelp(); });
helpDialog.addEventListener("close", () => help.setAttribute("aria-pressed", "false"));
window.addEventListener("hashchange", () => requestPage(readHash(), false));
window.addEventListener("resize", queueResize);
new ResizeObserver(queueResize).observe(host);
document.addEventListener("fullscreenchange", () => {
  const active = Boolean(document.fullscreenElement);
  if (active) {
    nativeFullscreenActive = true;
    if (!presentationMode) void exitPresentation();
    else setPresentationMode(true);
  } else if (nativeFullscreenActive) {
    nativeFullscreenActive = false;
    fullscreenRevision += 1;
    setPresentationMode(false);
  }
});

const interactive = "button, a[href], input, textarea, select, summary, [role=button], [role=link]";
stage.addEventListener("pointerdown", event => {
  if (!(event.target instanceof Element) || !event.target.closest(interactive)) focusStage();
});
document.addEventListener("keydown", event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
  const key = event.key.toLowerCase();
  if (event.shiftKey && key !== " " && key !== "?") return;
  if ((key === " " || key === "enter") && target?.closest(interactive)) return;
  let action;
  if (key === "escape") action = () => {
    toggleBlackout(false);
    if (helpDialog.open) dismissHelp();
    if (presentationMode || document.fullscreenElement) void exitPresentation();
  };
  else if (key === "h" || key === "?") action = toggleHelp;
  else if (key === "f" || key === "f5") action = toggleFullscreen;
  else if (helpDialog.open) return;
  else if (["arrowright", "arrowdown", "pagedown", "enter"].includes(key)) action = () => requestPage(requestedPage + 1);
  else if (["arrowleft", "arrowup", "pageup", "backspace"].includes(key)) action = () => requestPage(requestedPage - 1);
  else if (key === " ") action = () => requestPage(requestedPage + (event.shiftKey ? -1 : 1));
  else if (key === "home") action = () => requestPage(1);
  else if (key === "end") action = () => requestPage(pageCount);
  else if (key === "b" || key === ".") action = () => toggleBlackout();
  if (!action) return;
  event.preventDefault();
  if (!event.repeat) action();
});

async function start() {
  previous.disabled = true;
  next.disabled = true;
  stage.setAttribute("aria-busy", "true");
  showStatus("Loading presentation…");
  try {
    const pdfjs = await import("./vendor/pdfjs/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;
    const manifest = fetch(new URL("./slides.json", import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error(`Slide index: HTTP ${response.status}`);
        return response.json();
      })
      .then(data => Array.isArray(data) ? data : [])
      .catch(error => { console.warn("Using PDF text without the slide index.", error); return []; });
    [pdf, slides] = await Promise.all([
      pdfjs.getDocument({
        url: new URL("./rat-race-talk.pdf", import.meta.url).href,
        cMapUrl: new URL("./vendor/pdfjs/cmaps/", import.meta.url).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("./vendor/pdfjs/standard_fonts/", import.meta.url).href,
        wasmUrl: new URL("./vendor/pdfjs/wasm/", import.meta.url).href,
        isEvalSupported: false,
      }).promise,
      manifest,
    ]);
    pageCount = pdf.numPages;
    slideCount = slides.reduce((maximum, slide) => Math.max(maximum, Number(slide.slide) || 0), 0) || 29;
    requestPage(requestedPage);
  } catch (error) {
    console.error("Unable to load the presentation.", error);
    stage.setAttribute("aria-busy", "false");
    showStatus("The presentation could not load. Check your connection and reload, or use Download PDF.");
  }
}

void start();
