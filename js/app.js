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

// 3) Download the result (the backend deletes it after one download)
async function downloadJob(jobId, filename) {
  let res;
  try {
    res = await fetch(`${API_BASE}/download/${jobId}`);
  } catch (_) {
    throw new Error("Could not download the result. Please try again.");
  }
  if (!res.ok) throw new Error(await readError(res));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Convert tab ----------
const convertDrop = document.getElementById("convert-drop");
const convertInput = document.getElementById("convert-input");
const convertEmpty = convertDrop.querySelector(".dropzone-empty");
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

// View shown inside the dropzone once a file is chosen
const convertFileView = document.createElement("div");
convertFileView.className = "dropzone-file";
convertFileView.hidden = true;
convertDrop.appendChild(convertFileView);

let convertFile = null;
let convertBusy = false;

function updateConvertButton() {
  const isEpub = convertFormat.value === "epub";
  convertEpubFields.hidden = !isEpub;

  const epubReady = !isEpub || (epubTitle.value.trim() && epubAuthor.value.trim());
  convertBtn.disabled = convertBusy || !(convertFile && convertFormat.value && epubReady);
}

function renderConvertFile() {
  if (!convertFile) {
    convertEmpty.hidden = false;
    convertFileView.hidden = true;
    convertDrop.classList.remove("has-file");
    return;
  }

  convertFileView.innerHTML = `
    <div class="dropzone-file-info">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>
      <div>
        <p class="dropzone-file-name"></p>
        <p class="dropzone-file-size"></p>
      </div>
    </div>
    <button type="button" class="dropzone-remove" aria-label="Remove file">&times;</button>
  `;
  convertFileView.querySelector(".dropzone-file-name").textContent = convertFile.name;
  convertFileView.querySelector(".dropzone-file-size").textContent = formatBytes(convertFile.size);
  convertFileView.querySelector(".dropzone-remove").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!convertBusy) resetConvert();
  });

  convertEmpty.hidden = true;
  convertFileView.hidden = false;
  convertDrop.classList.add("has-file");
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
  convertFile = null;
  convertFormat.innerHTML = '<option value="">Choose the result</option>';
  convertFormatWrap.hidden = true;
  epubInputs.forEach((el) => (el.value = ""));
  setStatus(convertStatus, "");
  renderConvertFile();
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
  renderConvertFile();
  populateFormats(ext);
  updateConvertButton();
}

setupDropzone({ zone: convertDrop, input: convertInput, onFiles: handleConvertFiles });

// Choosing a result: pre-fill the EPUB title from the file name, then refresh the button
convertFormat.addEventListener("change", () => {
  if (convertFormat.value === "epub" && convertFile && !epubTitle.value.trim()) {
    epubTitle.value = convertFile.name.replace(/\.[^.]+$/, "").replace(/_+/g, " ");
  }
  updateConvertButton();
});

[epubTitle, epubAuthor].forEach((el) => el.addEventListener("input", updateConvertButton));

// Submit: upload, wait for the job, download
convertBtn.addEventListener("click", async () => {
  if (convertBusy || !convertFile) return;

  const target = convertFormat.value;
  const baseName = convertFile.name.replace(/\.[^.]+$/, "");

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

  // The free server sleeps when idle, so the first request can be slow
  const wakeTimer = setTimeout(() => {
    setStatus(convertStatus, "Waking up the server, this can take up to a minute...", "");
  }, 8000);

  try {
    setStatus(convertStatus, "Uploading your file...", "");
    const jobId = await startJob("/convert", fd);
    clearTimeout(wakeTimer);

    setStatus(convertStatus, "Converting... longer documents can take a minute.", "");
    await waitForJob(jobId);

    setStatus(convertStatus, "Preparing your download...", "");
    const outName = safeFilename(target === "epub" ? epubTitle.value : baseName);
    await downloadJob(jobId, `${outName}.${target}`);

    setStatus(convertStatus, "Done! Your file has been downloaded.", "success");
  } catch (err) {
    setStatus(convertStatus, err.message || "Something went wrong. Please try again.", "error");
  } finally {
    clearTimeout(wakeTimer);
    convertBusy = false;
    convertBtn.innerHTML = convertBtnHTML;
    updateConvertButton();
  }
});
