const DEFAULT_TRACKERS = {
  "1337x": {
    name: "1337x",
    url: "https://1337x.to/search/{query}/1/",
    enabled: true,
    builtIn: true,
    searchType: "title",
  },
  rarbg: {
    name: "The RARBG",
    url: "https://therarbg.to/get-posts/keywords:{query}/",
    enabled: true,
    builtIn: true,
    searchType: "imdb",
  },
  piratebay: {
    name: "The Pirate Bay",
    url: "https://thepiratebay.org/search.php?q={query}&all=on&search=Pirate+Search&page=0&orderby=",
    enabled: true,
    builtIn: true,
    searchType: "title",
  },
};

const DEFAULT_STREAMING_SOURCES = {
  pstream: {
    name: "P-Stream",
    url: "https://pstream.net/browse/{query}",
    enabled: true,
    builtIn: true,
    searchType: "titleOnly",
  },
};

const SOURCE_CONFIGS = {
  trackers: {
    defaults: DEFAULT_TRACKERS,
    listId: "tracker-list",
    nameId: "custom-name",
    urlId: "custom-url",
    addId: "add-tracker",
    errorId: "error-msg",
    radioName: "search-type",
    customIdPrefix: "tracker",
    removeTitle: "Remove tracker",
    updateAction: "updateTrackers",
    messageKey: "trackers",
  },
  streamingSources: {
    defaults: DEFAULT_STREAMING_SOURCES,
    listId: "streaming-list",
    nameId: "custom-streaming-name",
    urlId: "custom-streaming-url",
    addId: "add-streaming-source",
    errorId: "streaming-error-msg",
    radioName: "streaming-search-type",
    customIdPrefix: "streaming",
    removeTitle: "Remove streaming source",
    updateAction: "updateStreamingSources",
    messageKey: "streamingSources",
  },
};

if (typeof browser === "undefined") {
  var browser = chrome;
}

document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  await setupWatchButtonSetting();
  await setupSourceManager("trackers");
  await setupSourceManager("streamingSources");
});

function setupTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      tabButtons.forEach((btn) => btn.classList.remove("active"));
      tabPanels.forEach((panel) => panel.classList.remove("active"));

      button.classList.add("active");
      document.getElementById(`${button.dataset.tab}-panel`)?.classList.add("active");
    });
  });
}

async function setupWatchButtonSetting() {
  const checkbox = document.getElementById("watch-button-enabled");
  const toggle = document.getElementById("watch-button-toggle");

  const result = await new Promise((resolve) => {
    browser.storage.sync.get({ watchButtonEnabled: true }, resolve);
  });

  setWatchButtonToggle(result.watchButtonEnabled);

  checkbox.addEventListener("change", async () => {
    const enabled = checkbox.checked;
    setWatchButtonToggle(enabled);

    await new Promise((resolve) =>
      browser.storage.sync.set({ watchButtonEnabled: enabled }, resolve),
    );

    notifyWatchButtonSetting(enabled);
  });

  function setWatchButtonToggle(enabled) {
    checkbox.checked = enabled;
    toggle.classList.toggle("active", enabled);
  }
}

async function notifyWatchButtonSetting(enabled) {
  const tabs = await browser.tabs.query({ url: "*://letterboxd.com/*" });
  tabs.forEach((tab) => {
    browser.tabs
      .sendMessage(tab.id, {
        action: "updateWatchButton",
        enabled,
      })
      .catch(() => {});
  });
}

async function setupSourceManager(storageKey) {
  const config = SOURCE_CONFIGS[storageKey];
  const list = document.getElementById(config.listId);
  const nameInput = document.getElementById(config.nameId);
  const urlInput = document.getElementById(config.urlId);
  const addBtn = document.getElementById(config.addId);
  const errorMsg = document.getElementById(config.errorId);

  async function loadAllSources() {
    const result = await new Promise((resolve) => {
      browser.storage.sync.get({ [storageKey]: {} }, resolve);
    });

    const sources = { ...config.defaults, ...result[storageKey] };

    Object.keys(config.defaults).forEach((key) => {
      if (!sources[key] || !sources[key].builtIn) {
        sources[key] = { ...config.defaults[key] };
      }
    });

    return sources;
  }

  async function saveAllSources(sources) {
    await new Promise((resolve) =>
      browser.storage.sync.set({ [storageKey]: sources }, resolve),
    );
    notifyContentScripts(sources);
  }

  async function notifyContentScripts(sources) {
    const tabs = await browser.tabs.query({ url: "*://letterboxd.com/*" });
    tabs.forEach((tab) => {
      browser.tabs
        .sendMessage(tab.id, {
          action: config.updateAction,
          [config.messageKey]: sources,
        })
        .catch(() => {});
    });
  }

  function getSearchTypeLabel(searchType) {
    return (
      {
        imdb: "IMDB",
        titleOnly: "Title",
        title: "Title + Year",
      }[searchType] || "Title"
    );
  }

  function createSourceElement(id, data) {
    const div = document.createElement("div");
    div.className = "tracker";
    div.dataset.source = id;

    const mainDiv = document.createElement("div");
    mainDiv.className = "tracker-main";

    const nameSpan = document.createElement("span");
    nameSpan.className = "tracker-name";
    nameSpan.textContent = data.name;
    mainDiv.appendChild(nameSpan);

    const typeSpan = document.createElement("span");
    typeSpan.className = "search-type";
    typeSpan.textContent = getSearchTypeLabel(data.searchType);
    mainDiv.appendChild(typeSpan);

    if (!data.builtIn) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.innerHTML = "X";
      deleteBtn.title = config.removeTitle;
      deleteBtn.onclick = async () => {
        const sources = await loadAllSources();
        delete sources[id];
        await saveAllSources(sources);
        renderSources(sources);
      };
      mainDiv.appendChild(deleteBtn);
    }

    const toggle = document.createElement("div");
    toggle.className = "toggle";
    if (data.enabled) toggle.classList.add("active");

    toggle.addEventListener("click", async () => {
      toggle.classList.toggle("active");
      const isActive = toggle.classList.contains("active");

      const sources = await loadAllSources();
      sources[id].enabled = isActive;
      await saveAllSources(sources);
    });

    div.appendChild(mainDiv);
    div.appendChild(toggle);
    return div;
  }

  function renderSources(sources) {
    list.innerHTML = "";

    Object.entries(sources).forEach(([id, data]) => {
      const el = createSourceElement(id, data);
      list.appendChild(el);
    });
  }

  addBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    const searchType = document.querySelector(
      `input[name="${config.radioName}"]:checked`,
    ).value;

    if (!name || !url) {
      showError("Please fill in both fields");
      return;
    }

    if (!url.includes("{query}")) {
      showError("URL must include {query} placeholder");
      return;
    }

    try {
      new URL(url.replace("{query}", "test"));
    } catch {
      showError("Please enter a valid URL");
      return;
    }

    hideError();

    const sources = await loadAllSources();
    const id = `${config.customIdPrefix}_${Date.now()}`;

    sources[id] = {
      name,
      url,
      enabled: true,
      builtIn: false,
      searchType,
    };

    await saveAllSources(sources);

    nameInput.value = "";
    urlInput.value = "";
    document.querySelector(`input[name="${config.radioName}"]`).checked = true;

    renderSources(sources);
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add("show");
  }

  function hideError() {
    errorMsg.classList.remove("show");
  }

  [nameInput, urlInput].forEach((input) => {
    input.addEventListener("input", hideError);
  });

  renderSources(await loadAllSources());
}
