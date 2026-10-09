// ---------- Config ----------
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB cap

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

// ---------- Convert tab ----------
const convertDrop = document.getElementById("convert-drop");
const convertInput = document.getElementById("convert-input");
const convertEmpty = convertDrop.querySelector(".dropzone-empty");
const convertFormatWrap = document.getElementById("convert-format-wrap");
const convertFormat = document.getElementById("convert-format");
const convertStatus = document.getElementById("convert-status");
const convertBtn = document.getElementById("convert-btn");

// View shown inside the dropzone once a file is chosen
const convertFileView = document.createElement("div");
convertFileView.className = "dropzone-file";
convertFileView.hidden = true;
convertDrop.appendChild(convertFileView);

let convertFile = null;

function updateConvertButton() {
  convertBtn.disabled = !(convertFile && convertFormat.value);
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
    resetConvert();
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
  setStatus(convertStatus, "");
  renderConvertFile();
  updateConvertButton();
}

function handleConvertFiles(files) {
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
convertFormat.addEventListener("change", updateConvertButton);

// Placeholder: real upload is wired in a later step
convertBtn.addEventListener("click", () => {
  setStatus(
    convertStatus,
    `Ready: ${convertFile.name} to ${FORMAT_LABELS[convertFormat.value]}. Upload is not connected yet.`,
    "success"
  );
});
