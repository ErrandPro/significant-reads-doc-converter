// ---------- Config ----------
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB cap

const API_BASE = "https://significant-reads-epub-api.onrender.com";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const CONVERT_EXTENSIONS = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"];

const FORMAT_LABELS = {
  docx: "Word document (.docx)",
  jpg: "JPG image (.jpg)",
  epub: "EPUB (.epub)",
  pdf: "PDF (.pdf)",
};

// Which results each input type can become (matches the backend)
const FORMATS_BY_EXT = {
  ".pdf": ["docx", "jpg"],
  ".doc": ["epub", "pdf"],
  ".docx": ["epub", "pdf"],
  ".jpg": ["pdf"],
  ".jpeg": ["pdf"],
  ".png": ["pdf"],
};

const FILE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>';

// ---------- Helpers ----------
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function getExt(filename) {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

function baseName(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

function setStatus(el, message, type) {
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    el.className = "status";
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.className = "status" + (type ? " is-" + type : "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|]+/g, "").trim() || "converted";
}

// Shared dropzone behaviour: click, keyboard, drag and drop
function setupDropzone({ zone, input, onFiles }) {
  zone.addEventListener("click", (e) => {
    if (e.target === input) return;
    input.click();
  });

  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });

  ["dragenter", "dragover"].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add("is-dragover");
    })
  );

  ["dragleave", "drop"].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove("is-dragover");
    })
  );

  zone.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  });

  input.addEventListener("change", () => {
    const files = Array.from(input.files);
    input.value = ""; // allows picking the same file again
    if (files.length) onFiles(files);
  });
}

// Shows a chosen file (name, size, remove button) inside a dropzone
function createFileView(zone) {
  const empty = zone.querySelector(".dropzone-empty");
  const view = document.createElement("div");
  view.className = "dropzone-file";
  view.hidden = true;
  zone.appendChild(view);

  return {
    show(file, onRemove) {
      view.innerHTML = `
        <div class="dropzone-file-info">
          ${FILE_ICON}
          <div>
            <p class="dropzone-file-name"></p>
            <p class="dropzone-file-size"></p>
          </div>
        </div>
        <button type="button" class="dropzone-remove" aria-label="Remove file">&times;</button>
      `;
      view.querySelector(".dropzone-file-name").textContent = file.name;
      view.querySelector(".dropzone-file-size").textContent = formatBytes(file.size);
      view.querySelector(".dropzone-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        onRemove();
      });
      empty.hidden = true;
      view.hidden = false;
      zone.classList.add("has-file");
    },
    clear() {
      empty.hidden = false;
      view.hidden = true;
      view.innerHTML = "";
      zone.classList.remove("has-file");
    },
  };
}

// Stop the browser from opening a file dropped outside a dropzone
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

// ---------- Tabs ----------
const tabs = document.querySelectorAll(".tab");
const panels = {
  convert: document.getElementById("panel-convert"),
  split: document.getElementById("panel-split"),
  merge: document.getElementById("panel-merge"),
};

function showTab(name) {
  tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  Object.entries(panels).forEach(([key, panel]) => {
    panel.hidden = key !== name;
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
});

// ---------- Backend connection ----------

// Turns a failed response into a readable message
async function readError(res) {
  if (res.status === 429) {
    return "Too many requests. Please wait a minute and try again.";
  }
  try {
    const data = await res.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg).join(" ");
  } catch (_) {}
  return `Something went wrong (error ${res.status}).`;
}

// 1) Upload and start a job. Returns the job id.
async function startJob(endpoint, formData) {
  let res;
  try {
    res = await fetch(API_BASE + endpoint, { method: "POST", body: formData });
  } catch (_) {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.job_id;
}

// 2) Poll until the job is done
async function waitForJob(jobId) {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    let res;
    try {
      res = await fetch(`${API_BASE}/status/${jobId}`);
    } catch (_) {
      continue; // brief network blip, try again
    }
    if (!res.ok) throw new Error(await readError(res));
    const job = await res.json();
    const status = String(job.status || "").toLowerCase();
    if (status === "done") return job;
    if (status.includes("fail") || status.includes("error")) {
      throw new Error(job.error || job.detail || job.message || "The conversion failed. Please try another file.");
    }
  }
  throw new Error("This is taking too long. Please try again.");
}

// 3) Fetch the result. The backend deletes it after one download,
//    so call this once per job and keep the blob.
async function fetchJobBlob(jobId) {
  let res;
  try {
    res = await fetch(`${API_BASE}/download/${jobId}`);
  } catch (_) {
    throw new Error("Could not download the result. Please try again.");
  }
  if (!res.ok) throw new Error(await readError(res));
  return res.blob();
}

// Saves a blob to the user's computer
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Upload + wait, with friendly status messages. Returns the job id.
async function processJob(endpoint, formData, statusEl) {
  // The free server sleeps when idle, so the first request can be slow
  const wakeTimer = setTimeout(() => {
    setStatus(statusEl, "Waking up the server, this can take up to a minute...", "");
  }, 8000);

  try {
    setStatus(statusEl, "Uploading...", "");
    const jobId = await startJob(endpoint, formData);
    clearTimeout(wakeTimer);

    setStatus(statusEl, "Processing... longer documents can take a minute.", "");
    await waitForJob(jobId);
    return jobId;
  } finally {
    clearTimeout(wakeTimer);
  }
}

// =====================================================================
// CONVERT TAB
// =====================================================================
const convertDrop = document.getElementById("convert-drop");
const convertInput = document.getElementById("convert-input");
const convertFormatWrap = document.getElementById("convert-format-wrap");
const convertFormat = document.getElementById("convert-format");
const convertStatus = document.getElementById("convert-status");
const convertBtn = document.getElementById("convert-btn");

const convertEpubFields = document.getElementById("epub-fields");
const epubTitle = document.getElementById("epub-title");
const epubAuthor = document.getElementById("epub-author");
const epubSubtitle = document.getElementById("epub-subtitle");
const epubCopyright = document.getElementById("epub-copyright");
const epubDedication = document.getElementById("epub-dedication");
const epubAcknowledgements = document.getElementById("epub-acknowledgements");
const epubForeword = document.getElementById("epub-foreword");
const epubInputs = [
  epubTitle, epubAuthor, epubSubtitle, epubCopyright,
  epubDedication, epubAcknowledgements, epubForeword,
];

const convertBtnHTML = convertBtn.innerHTML;
const convertView = createFileView(convertDrop);

let convertFile = null;
let convertBusy = false;

function updateConvertButton() {
  const isEpub = convertFormat.value === "epub";
  convertEpubFields.hidden = !isEpub;

  const epubReady = !isEpub || (epubTitle.value.trim() && epubAuthor.value.trim());
  convertBtn.disabled = convertBusy || !(convertFile && convertFormat.value && epubReady);
}

function populateFormats(ext) {
  const options = FORMATS_BY_EXT[ext] || [];
  convertFormat.innerHTML = '<option value="">Choose the result</option>';
  options.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = FORMAT_LABELS[value];
    convertFormat.appendChild(opt);
  });
  // Only one possible result? Select it for the user.
  if (options.length === 1) convertFormat.value = options[0];
  convertFormatWrap.hidden = false;
}

function resetConvert() {
  if (convertBusy) return;
  convertFile = null;
  convertFormat.innerHTML = '<option value="">Choose the result</option>';
  convertFormatWrap.hidden = true;
  epubInputs.forEach((el) => (el.value = ""));
  setStatus(convertStatus, "");
  convertView.clear();
  updateConvertButton();
}

function handleConvertFiles(files) {
  if (convertBusy) return;

  const file = files[0];
  const ext = getExt(file.name);

  if (!CONVERT_EXTENSIONS.includes(ext)) {
    setStatus(convertStatus, "Unsupported file type. Please choose a PDF, DOC, DOCX, JPG or PNG file.", "error");
    return;
  }
  if (file.size === 0) {
    setStatus(convertStatus, "That file is empty.", "error");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus(convertStatus, `That file is ${formatBytes(file.size)}. The limit is 15 MB.`, "error");
    return;
  }

  convertFile = file;
  setStatus(convertStatus, "");
  convertView.show(file, resetConvert);
  populateFormats(ext);
  updateConvertButton();
}

setupDropzone({ zone: convertDrop, input: convertInput, onFiles: handleConvertFiles });

// Choosing a result: pre-fill the EPUB title from the file name, then refresh the button
convertFormat.addEventListener("change", () => {
  if (convertFormat.value === "epub" && convertFile && !epubTitle.value.trim()) {
    epubTitle.value = baseName(convertFile.name).replace(/_+/g, " ");
  }
  updateConvertButton();
});

[epubTitle, epubAuthor].forEach((el) => el.addEventListener("input", updateConvertButton));

convertBtn.addEventListener("click", async () => {
  if (convertBusy || !convertFile) return;

  const target = convertFormat.value;

  const fd = new FormData();
  fd.append("pdf", convertFile); // the backend field is named "pdf" for every file type
  fd.append("target", target);

  if (target === "epub") {
    fd.append("title", epubTitle.value.trim());
    fd.append("author", epubAuthor.value.trim());
    fd.append("subtitle", epubSubtitle.value.trim());
    fd.append("copyright", epubCopyright.value.trim());
    fd.append("dedication", epubDedication.value.trim());
    fd.append("acknowledgements", epubAcknowledgements.value.trim());
    fd.append("foreword", epubForeword.value.trim());
  }

  convertBusy = true;
  convertBtn.textContent = "Converting...";
  updateConvertButton();

  try {
    const jobId = await processJob("/convert", fd, convertStatus);

    setStatus(convertStatus, "Preparing your download...", "");
    const blob = await fetchJobBlob(jobId);
    const outName = safeFilename(target === "epub" ? epubTitle.value : baseName(convertFile.name));
    saveBlob(blob, `${outName}.${target}`);

    setStatus(convertStatus, "Done! Your file has been downloaded.", "success");
  } catch (err) {
    setStatus(convertStatus, err.message || "Something went wrong. Please try again.", "error");
  } finally {
    convertBusy = false;
    convertBtn.innerHTML = convertBtnHTML;
    updateConvertButton();
  }
});

// =====================================================================
// SPLIT TAB
// =====================================================================
const splitDrop = document.getElementById("split-drop");
const splitInput = document.getElementById("split-input");
const splitStatus = document.getElementById("split-status");
const splitBtn = document.getElementById("split-btn");
const splitResult = document.getElementById("split-result");
const splitZipBtn = document.getElementById("split-zip-btn");
const splitFilesBtn = document.getElementById("split-files-btn");

const splitView = createFileView(splitDrop);

let splitFile = null;
let splitBusy = false;
let splitZipBlob = null; // kept in memory: the backend only allows one download

function updateSplitButton() {
  splitBtn.disabled = splitBusy || !splitFile;
}

function clearSplitResult() {
  splitZipBlob = null;
  splitResult.hidden = true;
}

function resetSplit() {
  if (splitBusy) return;
  splitFile = null;
  clearSplitResult();
  setStatus(splitStatus, "");
  splitView.clear();
  updateSplitButton();
}

function handleSplitFiles(files) {
  if (splitBusy) return;

  const file = files[0];

  if (getExt(file.name) !== ".pdf") {
    setStatus(splitStatus, "Please choose a PDF file.", "error");
    return;
  }
  if (file.size === 0) {
    setStatus(splitStatus, "That file is empty.", "error");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus(splitStatus, `That file is ${formatBytes(file.size)}. The limit is 15 MB.`, "error");
    return;
  }

  splitFile = file;
  clearSplitResult();
  setStatus(splitStatus, "");
  splitView.show(file, resetSplit);
  updateSplitButton();
}

setupDropzone({ zone: splitDrop, input: splitInput, onFiles: handleSplitFiles });

splitBtn.addEventListener("click", async () => {
  if (splitBusy || !splitFile) return;

  const fd = new FormData();
  fd.append("pdf", splitFile);

  splitBusy = true;
  clearSplitResult();
  const originalLabel = splitBtn.textContent;
  splitBtn.textContent = "Splitting...";
  updateSplitButton();

  try {
    const jobId = await processJob("/split", fd, splitStatus);

    setStatus(splitStatus, "Preparing your pages...", "");
    splitZipBlob = await fetchJobBlob(jobId);

    // Count the pages if the ZIP library is available
    let message = "Done! Choose how you'd like your pages.";
    if (window.JSZip) {
      try {
        const zip = await JSZip.loadAsync(splitZipBlob);
        const count = Object.values(zip.files).filter((f) => !f.dir).length;
        message = `Done! Your PDF was split into ${count} page${count === 1 ? "" : "s"}. Choose how you'd like them.`;
      } catch (_) {}
    }
    setStatus(splitStatus, message, "success");
    splitResult.hidden = false;
  } catch (err) {
    setStatus(splitStatus, err.message || "Something went wrong. Please try again.", "error");
  } finally {
    splitBusy = false;
    splitBtn.textContent = originalLabel;
    updateSplitButton();
  }
});

splitZipBtn.addEventListener("click", () => {
  if (!splitZipBlob || !splitFile) return;
  saveBlob(splitZipBlob, `${safeFilename(baseName(splitFile.name))}_pages.zip`);
});

splitFilesBtn.addEventListener("click", async () => {
  if (!splitZipBlob) return;
  if (!window.JSZip) {
    setStatus(splitStatus, "The ZIP tool could not load. Please download the ZIP instead.", "error");
    return;
  }

  splitFilesBtn.disabled = true;
  try {
    const zip = await JSZip.loadAsync(splitZipBlob);
    const entries = Object.values(zip.files)
      .filter((f) => !f.dir)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (let i = 0; i < entries.length; i++) {
      setStatus(splitStatus, `Downloading file ${i + 1} of ${entries.length}...`, "");
      const raw = await entries[i].async("blob");
      const pdf = new Blob([raw], { type: "application/pdf" });
      saveBlob(pdf, entries[i].name.split("/").pop());
      await sleep(400); // browsers can block downloads fired too quickly
    }

    setStatus(
      splitStatus,
      `Downloaded ${entries.length} file${entries.length === 1 ? "" : "s"}. If some are missing, allow multiple downloads for this site in your browser.`,
      "success"
    );
  } catch (_) {
    setStatus(splitStatus, "Could not unpack the pages. Please download the ZIP instead.", "error");
  } finally {
    splitFilesBtn.disabled = false;
  }
});

// =====================================================================
// MERGE TAB
// =====================================================================
const mergeDrop = document.getElementById("merge-drop");
const mergeInput = document.getElementById("merge-input");
const mergeList = document.getElementById("merge-list");
const mergeTotal = document.getElementById("merge-total");
const mergeStatus = document.getElementById("merge-status");
const mergeBtn = document.getElementById("merge-btn");

let mergeFiles = [];
let mergeBusy = false;
let mergeDragIndex = null;

function mergeTotalBytes() {
  return mergeFiles.reduce((sum, f) => sum + f.size, 0);
}

function updateMergeButton() {
  mergeBtn.disabled = mergeBusy || mergeFiles.length < 2;
}

function moveMergeItem(from, to) {
  if (to < 0 || to >= mergeFiles.length || from === to) return;
  const [item] = mergeFiles.splice(from, 1);
  mergeFiles.splice(to, 0, item);
  renderMergeList();
}

function renderMergeList() {
  mergeList.innerHTML = "";

  if (!mergeFiles.length) {
    mergeList.hidden = true;
    mergeTotal.hidden = true;
    updateMergeButton();
    return;
  }

  mergeFiles.forEach((file, i) => {
    const li = document.createElement("li");
    li.className = "file-item";
    li.draggable = !mergeBusy;
    li.dataset.index = String(i);
    li.innerHTML = `
      <span class="file-item-grip" aria-hidden="true">&#8942;&#8942;</span>
      <span class="file-item-index">${i + 1}</span>
      <div class="file-item-main">
        <p class="file-item-name"></p>
        <p class="file-item-size"></p>
      </div>
      <div class="file-item-actions">
        <button type="button" class="icon-btn" data-action="up" aria-label="Move up" ${i === 0 || mergeBusy ? "disabled" : ""}>&uarr;</button>
        <button type="button" class="icon-btn" data-action="down" aria-label="Move down" ${i === mergeFiles.length - 1 || mergeBusy ? "disabled" : ""}>&darr;</button>
        <button type="button" class="icon-btn" data-action="remove" aria-label="Remove file" ${mergeBusy ? "disabled" : ""}>&times;</button>
      </div>
    `;
    li.querySelector(".file-item-name").textContent = file.name;
    li.querySelector(".file-item-name").title = file.name;
    li.querySelector(".file-item-size").textContent = formatBytes(file.size);
    mergeList.appendChild(li);
  });

  mergeList.hidden = false;
  mergeTotal.hidden = false;
  mergeTotal.textContent = `${mergeFiles.length} file${mergeFiles.length === 1 ? "" : "s"} · ${formatBytes(mergeTotalBytes())} of 15 MB`;
  updateMergeButton();
}

function handleMergeFiles(files) {
  if (mergeBusy) return;

  let error = "";
  let total = mergeTotalBytes();

  for (const file of files) {
    if (getExt(file.name) !== ".pdf") {
      error = `"${file.name}" is not a PDF and was skipped.`;
      continue;
    }
    if (file.size === 0) {
      error = `"${file.name}" is empty and was skipped.`;
      continue;
    }
    if (total + file.size > MAX_FILE_BYTES) {
      error = `Adding "${file.name}" would go over the 15 MB combined limit.`;
      continue;
    }
    mergeFiles.push(file);
    total += file.size;
  }

  setStatus(mergeStatus, error, error ? "error" : "");
  renderMergeList();
}

setupDropzone({ zone: mergeDrop, input: mergeInput, onFiles: handleMergeFiles });

// Buttons inside the list (move up, move down, remove)
mergeList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || mergeBusy) return;
  const li = btn.closest(".file-item");
  const index = Number(li.dataset.index);
  const action = btn.dataset.action;

  if (action === "up") moveMergeItem(index, index - 1);
  if (action === "down") moveMergeItem(index, index + 1);
  if (action === "remove") {
    mergeFiles.splice(index, 1);
    setStatus(mergeStatus, "");
    renderMergeList();
  }
});

// Drag to reorder
mergeList.addEventListener("dragstart", (e) => {
  const li = e.target.closest(".file-item");
  if (!li || mergeBusy) return;
  mergeDragIndex = Number(li.dataset.index);
  li.classList.add("is-dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(mergeDragIndex)); // required by Firefox
});

mergeList.addEventListener("dragover", (e) => {
  if (mergeDragIndex === null) return;
  e.preventDefault();
  const li = e.target.closest(".file-item");
  mergeList.querySelectorAll(".is-over").forEach((el) => el.classList.remove("is-over"));
  if (li) li.classList.add("is-over");
});

mergeList.addEventListener("drop", (e) => {
  if (mergeDragIndex === null) return;
  e.preventDefault();
  const li = e.target.closest(".file-item");
  if (li) moveMergeItem(mergeDragIndex, Number(li.dataset.index));
  mergeDragIndex = null;
});

mergeList.addEventListener("dragend", () => {
  mergeDragIndex = null;
  mergeList.querySelectorAll(".is-dragging, .is-over").forEach((el) => {
    el.classList.remove("is-dragging", "is-over");
  });
});

mergeBtn.addEventListener("click", async () => {
  if (mergeBusy || mergeFiles.length < 2) return;

  const fd = new FormData();
  mergeFiles.forEach((file) => fd.append("files", file)); // order here is the merge order

  mergeBusy = true;
  const originalLabel = mergeBtn.textContent;
  mergeBtn.textContent = "Merging...";
  renderMergeList(); // disables the list controls while busy

  try {
    const jobId = await processJob("/merge", fd, mergeStatus);

    setStatus(mergeStatus, "Preparing your download...", "");
    const blob = await fetchJobBlob(jobId);
    saveBlob(blob, "merged.pdf");

    setStatus(mergeStatus, "Done! Your merged PDF has been downloaded.", "success");
  } catch (err) {
    setStatus(mergeStatus, err.message || "Something went wrong. Please try again.", "error");
  } finally {
    mergeBusy = false;
    mergeBtn.textContent = originalLabel;
    renderMergeList();
  }
});
