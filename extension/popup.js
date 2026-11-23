// Depends on defaults.js (loaded first), which provides `LBDL` and `browser`.

const {
  CATEGORIES,
  CATEGORY_ORDER,
  SEARCH_TYPES,
  DEFAULT_SETTINGS,
  QUALITY_OPTIONS,
} = LBDL;

const TAB_STORAGE_KEY = "lbdl-popup-tab";

let state = null;

document.addEventListener("DOMContentLoaded", async () => {
  state = await LBDL.loadAll();
  CATEGORY_ORDER.forEach(createSourcePanel);
  setupSettingsPanel();
  setupTabs();
});

/* ---------------------------------------------------------------- helpers */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function iconButton(symbol, title, onClick, extraClass = "") {
  const btn = el("button", `icon-btn ${extraClass}`.trim(), symbol);
  btn.type = "button";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.addEventListener("click", onClick);
  return btn;
}

function setupToggle(toggle, value, onChange) {
  const set = (on) => {
    toggle.classList.toggle("active", on);
    toggle.setAttribute("aria-checked", String(on));
  };
  set(value);
  toggle.addEventListener("click", () => {
    const next = toggle.getAttribute("aria-checked") !== "true";
    set(next);
    onChange(next);
  });
}

let toastTimer = null;
function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

async function saveSources(category) {
  try {
    await browser.storage.sync.set({ [category]: state.sources[category] });
  } catch (err) {
    showToast(`Could not save: ${err.message}`, true);
  }
}

async function saveSetting(key, value) {
  state.settings[key] = value;
  try {
    await browser.storage.sync.set({ [key]: value });
  } catch (err) {
    showToast(`Could not save: ${err.message}`, true);
  }
}

function getSourceBadge(source) {
  const keys = LBDL.placeholdersIn(source.url);
  if (keys.includes("query")) return SEARCH_TYPES[source.searchType] ?? "Title";
  if (keys.includes("tmdb")) return "TMDB ID";
  if (keys.includes("imdb") || keys.includes("imdbNum")) return "IMDb ID";
  return "Title";
}

/* ------------------------------------------------------------------- tabs */

function setupTabs() {
  const buttons = [...document.querySelectorAll(".tab-btn")];

  const activate = (name) => {
    buttons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
    document
      .querySelectorAll(".tab-panel")
      .forEach((panel) => panel.classList.toggle("active", panel.id === `${name}-panel`));
    try {
      localStorage.setItem(TAB_STORAGE_KEY, name);
    } catch {
      // Not important if this fails.
    }
  };

  buttons.forEach((btn) => btn.addEventListener("click", () => activate(btn.dataset.tab)));

  let saved = null;
  try {
    saved = localStorage.getItem(TAB_STORAGE_KEY);
  } catch {
    // Ignore.
  }
  activate(buttons.some((btn) => btn.dataset.tab === saved) ? saved : buttons[0].dataset.tab);
}

/* ---------------------------------------------------------- source panels */

function createSourcePanel(category) {
  const config = CATEGORIES[category];
  const panel = document
    .getElementById("source-panel-template")
    .content.firstElementChild.cloneNode(true);
  const part = (role) => panel.querySelector(`[data-role="${role}"]`);

  panel.id = `${category}-panel`;
  part("heading").textContent = `${config.label} Sources`;

  if (config.visibilitySetting) {
    part("visibility-row").hidden = false;
    part("visibility-title").textContent = `${config.buttonText} button`;
    part("visibility-desc").textContent = `Show the ${config.buttonText} button on film pages.`;
    const toggle = part("visibility-toggle");
    toggle.setAttribute("aria-label", `${config.buttonText} button`);
    setupToggle(toggle, state.settings[config.visibilitySetting], (on) =>
      saveSetting(config.visibilitySetting, on),
    );
  }

  const list = part("list");
  const form = part("form");
  const formTitle = part("form-title");
  const nameInput = part("name");
  const urlInput = part("url");
  const errorEl = part("error");
  const submitBtn = part("submit");
  const cancelBtn = part("cancel");
  const radioName = `${category}-search-type`;

  part("types").replaceChildren(
    ...Object.entries(SEARCH_TYPES).map(([value, label]) => {
      const wrap = el("label", "radio-label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = radioName;
      input.value = value;
      wrap.append(input, label);
      return wrap;
    }),
  );

  const radios = () => [...panel.querySelectorAll(`input[name="${radioName}"]`)];
  const getSearchType = () =>
    radios().find((r) => r.checked)?.value ?? config.defaultSearchType;
  const setSearchType = (value) => radios().forEach((r) => (r.checked = r.value === value));

  const sources = () => state.sources[category];

  const defaultSelect = part("default-select");
  part("default-desc").textContent =
    `The ${config.buttonText} button opens this source in one click. The small arrow next to it shows the full list.`;

  function renderDefaultSelect() {
    const current = state.settings.defaultSources[category] ?? "";
    defaultSelect.replaceChildren(
      new Option("None (show list)", ""),
      ...LBDL.sortedSources(sources()).map(
        (s) => new Option(s.enabled ? s.name : `${s.name} (disabled)`, s.id),
      ),
    );
    defaultSelect.value = sources()[current] ? current : "";
  }

  async function setDefaultSource(id) {
    const next = { ...state.settings.defaultSources };
    if (id) {
      next[category] = id;
    } else {
      delete next[category];
    }
    await saveSetting("defaultSources", next);
    renderList();
  }

  defaultSelect.addEventListener("change", () => setDefaultSource(defaultSelect.value));

  let editingId = null;
  let draggedId = null;

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.add("show");
  }

  function hideError() {
    errorEl.classList.remove("show");
  }

  function resetForm() {
    editingId = null;
    nameInput.value = "";
    urlInput.value = "";
    setSearchType(config.defaultSearchType);
    formTitle.textContent = "Add Custom Source";
    submitBtn.textContent = "Add Source";
    cancelBtn.hidden = true;
    hideError();
  }

  function startEdit(id) {
    const source = sources()[id];
    if (!source) return;
    editingId = id;
    nameInput.value = source.name;
    urlInput.value = source.url;
    setSearchType(source.searchType);
    formTitle.textContent = `Edit ${source.name}`;
    submitBtn.textContent = "Save Changes";
    cancelBtn.hidden = false;
    hideError();
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    nameInput.focus();
  }

  async function commit() {
    await saveSources(category);
    renderList();
  }

  async function removeSource(id) {
    delete sources()[id];
    if (editingId === id) resetForm();
    if (state.settings.defaultSources[category] === id) await setDefaultSource("");
    await commit();
  }

  async function restoreBuiltIn(id) {
    const current = sources()[id];
    sources()[id] = {
      ...config.defaults[id],
      builtIn: true,
      customized: false,
      enabled: current.enabled,
      order: current.order,
    };
    if (editingId === id) resetForm();
    await commit();
  }

  async function moveSource(fromId, toId, placeAfter) {
    const ids = LBDL.sortedSources(sources())
      .map((s) => s.id)
      .filter((id) => id !== fromId);
    ids.splice(ids.indexOf(toId) + (placeAfter ? 1 : 0), 0, fromId);
    ids.forEach((id, order) => (sources()[id].order = order));
    await commit();
  }

  function clearDropMarkers() {
    list
      .querySelectorAll(".drop-before, .drop-after")
      .forEach((row) => row.classList.remove("drop-before", "drop-after"));
  }

  const isLowerHalf = (e, row) => {
    const rect = row.getBoundingClientRect();
    return e.clientY > rect.top + rect.height / 2;
  };

  function createRow(source) {
    const row = el("div", "tracker");
    row.draggable = true;
    row.dataset.id = source.id;

    const handle = el("span", "drag-handle", "⋮⋮");
    handle.title = "Drag to reorder";

    const main = el("div", "tracker-main");
    const name = el("span", "tracker-name", source.name);
    name.title = source.url;
    main.append(name, el("span", "search-type", getSourceBadge(source)));
    if (state.settings.defaultSources[category] === source.id) {
      main.append(el("span", "search-type is-default", "default"));
    }
    if (source.customized) main.append(el("span", "search-type edited", "edited"));

    const actions = el("div", "row-actions");
    actions.append(iconButton("✎", `Edit ${source.name}`, () => startEdit(source.id)));
    if (source.builtIn && source.customized) {
      actions.append(iconButton("↺", "Restore default", () => restoreBuiltIn(source.id)));
    }
    if (!source.builtIn) {
      actions.append(
        iconButton("✕", `Remove ${source.name}`, () => removeSource(source.id), "danger"),
      );
    }

    const toggle = el("button", "toggle");
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", `Enable ${source.name}`);
    setupToggle(toggle, source.enabled, async (on) => {
      sources()[source.id].enabled = on;
      renderDefaultSelect();
      await saveSources(category);
    });

    row.append(handle, main, actions, toggle);

    row.addEventListener("dragstart", (e) => {
      draggedId = source.id;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", source.id);
    });
    row.addEventListener("dragend", () => {
      draggedId = null;
      row.classList.remove("dragging");
      clearDropMarkers();
    });
    row.addEventListener("dragover", (e) => {
      if (!draggedId || draggedId === source.id) return;
      e.preventDefault();
      clearDropMarkers();
      row.classList.add(isLowerHalf(e, row) ? "drop-after" : "drop-before");
    });
    row.addEventListener("drop", (e) => {
      if (!draggedId || draggedId === source.id) return;
      e.preventDefault();
      moveSource(draggedId, source.id, isLowerHalf(e, row));
    });

    return row;
  }

  function renderList() {
    list.replaceChildren(...LBDL.sortedSources(sources()).map(createRow));
    renderDefaultSelect();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    const searchType = getSearchType();

    if (!name || !url) {
      showError("Please fill in both fields");
      return;
    }

    const problem = LBDL.validateTemplate(url);
    if (problem) {
      showError(problem);
      return;
    }

    hideError();

    if (editingId && sources()[editingId]) {
      const current = sources()[editingId];
      const updated = { ...current, name, url, searchType };
      if (current.builtIn) {
        const def = config.defaults[editingId];
        updated.customized =
          name !== def.name || url !== def.url || searchType !== def.searchType;
      }
      sources()[editingId] = updated;
    } else {
      const maxOrder = Math.max(-1, ...Object.values(sources()).map((s) => s.order ?? 0));
      sources()[`${config.idPrefix}_${Date.now()}`] = {
        name,
        url,
        searchType,
        enabled: true,
        builtIn: false,
        order: maxOrder + 1,
      };
    }

    resetForm();
    await commit();
  });

  cancelBtn.addEventListener("click", resetForm);
  [nameInput, urlInput].forEach((input) => input.addEventListener("input", hideError));

  resetForm();
  renderList();
  document.getElementById("panels").appendChild(panel);
}

/* --------------------------------------------------------- settings panel */

function setupSettingsPanel() {
  setupToggle(
    document.getElementById("clean-titles-toggle"),
    state.settings.cleanTitles,
    (on) => saveSetting("cleanTitles", on),
  );

  const select = document.getElementById("quality-select");
  select.replaceChildren(...QUALITY_OPTIONS.map((q) => new Option(q || "None", q)));
  select.value = state.settings.qualitySuffix;
  select.addEventListener("change", () => saveSetting("qualitySuffix", select.value));

  renderShortcuts();
  setupBackup();
}

async function renderShortcuts() {
  const list = document.getElementById("shortcut-list");
  const hint = document.getElementById("shortcut-hint");

  let commands = [];
  try {
    commands = await browser.commands.getAll();
  } catch {
    // Commands API unavailable.
  }

  list.replaceChildren(
    ...commands
      .filter((command) => command.description)
      .map((command) => {
        const row = el("div", "shortcut-row");
        const key = el("kbd", command.shortcut ? "" : "unset", command.shortcut || "Not set");
        row.append(el("span", "", command.description), key);
        return row;
      }),
  );

  const isFirefox = typeof browser.runtime.getBrowserInfo === "function";
  const isSafari = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(
    navigator.userAgent,
  );
  if (isSafari) {
    hint.textContent = `${
      commands.length
        ? "Safari uses the default shortcuts listed above."
        : "Default shortcuts: Alt+Shift+D (Download), Alt+Shift+W (Watch)."
    } You can also right-click any film poster on Letterboxd.`;
  } else if (isFirefox) {
    hint.textContent =
      "Change them in about:addons → ⚙ → Manage Extension Shortcuts. You can also right-click any film poster on Letterboxd.";
  } else {
    hint.replaceChildren(
      (() => {
        const btn = el("button", "link-btn", "Change shortcuts");
        btn.type = "button";
        btn.addEventListener("click", () =>
          browser.tabs.create({ url: "chrome://extensions/shortcuts" }),
        );
        return btn;
      })(),
      document.createTextNode(". You can also right-click any film poster on Letterboxd."),
    );
  }
}

/* ----------------------------------------------------------------- backup */

function sanitizeImport(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Expected a JSON object");
  }

  const settings = {};
  const inSettings = data.settings && typeof data.settings === "object" ? data.settings : {};
  Object.entries(DEFAULT_SETTINGS).forEach(([key, def]) => {
    const value = inSettings[key];
    if (key === "qualitySuffix") {
      if (QUALITY_OPTIONS.includes(value)) settings[key] = value;
    } else if (key === "defaultSources") {
      if (value !== undefined) settings[key] = LBDL.sanitizeDefaultSources(value);
    } else if (typeof value === typeof def) {
      settings[key] = value;
    }
  });

  const sources = {};
  let skipped = 0;
  const inSources = data.sources && typeof data.sources === "object" ? data.sources : {};

  CATEGORY_ORDER.forEach((category) => {
    const entries = inSources[category];
    if (!entries || typeof entries !== "object") return;

    const clean = {};
    Object.entries(entries).forEach(([id, source]) => {
      if (!source || typeof source !== "object" || !/^[\w-]{1,64}$/.test(id)) {
        skipped++;
        return;
      }

      const builtIn = Object.hasOwn(CATEGORIES[category].defaults, id);
      const customized = builtIn && Boolean(source.customized);

      if (
        (!builtIn || customized) &&
        (typeof source.name !== "string" ||
          !source.name.trim() ||
          typeof source.url !== "string" ||
          LBDL.validateTemplate(source.url))
      ) {
        skipped++;
        return;
      }

      clean[id] = {
        name: source.name,
        url: source.url,
        searchType: source.searchType,
        enabled: source.enabled !== false,
        builtIn,
        customized,
        order: Number.isFinite(source.order) ? source.order : undefined,
      };
    });

    sources[category] = LBDL.mergeSources(category, clean);
  });

  return { settings, sources, skipped };
}

function setupBackup() {
  const text = document.getElementById("backup-text");

  document.getElementById("export-btn").addEventListener("click", async () => {
    text.value = JSON.stringify(
      { version: 1, settings: state.settings, sources: state.sources },
      null,
      2,
    );
    text.select();
    try {
      await navigator.clipboard.writeText(text.value);
      showToast("Settings copied to clipboard");
    } catch {
      showToast("Exported. Copy the text above to save it.");
    }
  });

  document.getElementById("import-btn").addEventListener("click", async () => {
    if (!text.value.trim()) {
      showToast("Paste exported JSON first", true);
      return;
    }

    try {
      const { settings, sources, skipped } = sanitizeImport(JSON.parse(text.value));
      await browser.storage.sync.set({ ...settings, ...sources });
      showToast(
        skipped ? `Imported (${skipped} invalid source(s) skipped)` : "Settings imported",
      );
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      showToast(
        err instanceof SyntaxError ? "Invalid JSON" : `Import failed: ${err.message}`,
        true,
      );
    }
  });
}
