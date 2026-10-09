// ---------- Config ----------
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB cap

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
