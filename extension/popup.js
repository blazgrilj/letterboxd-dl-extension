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

if (typeof browser === "undefined") {
  var browser = chrome;
}

document.addEventListener("DOMContentLoaded", async () => {
  const trackerList = document.getElementById("tracker-list");
  const customNameInput = document.getElementById("custom-name");
  const customUrlInput = document.getElementById("custom-url");
  const addBtn = document.getElementById("add-tracker");
  const errorMsg = document.getElementById("error-msg");

  async function loadAllTrackers() {
    const result = await new Promise((resolve) => {
      browser.storage.sync.get({ trackers: {} }, resolve);
    });

    const trackers = { ...DEFAULT_TRACKERS, ...result.trackers };

    Object.keys(DEFAULT_TRACKERS).forEach((key) => {
      if (!trackers[key] || !trackers[key].builtIn) {
        trackers[key] = { ...DEFAULT_TRACKERS[key] };
      }
    });

    return trackers;
  }

  // Save all trackers
  async function saveAllTrackers(trackers) {
    await new Promise((resolve) =>
      browser.storage.sync.set({ trackers }, resolve),
    );
    notifyContentScripts(trackers);
  }

  // Notify content scripts
  async function notifyContentScripts(trackers) {
    const tabs = await browser.tabs.query({ url: "*://letterboxd.com/*" });
    tabs.forEach((tab) => {
      browser.tabs
        .sendMessage(tab.id, {
          action: "updateTrackers",
          trackers: trackers,
        })
        .catch(() => {});
    });
  }

  // Create tracker element
  function createTrackerElement(id, data) {
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
    typeSpan.textContent = data.searchType === "imdb" ? "IMDB" : "Title";
    mainDiv.appendChild(typeSpan);

    // Delete button ONLY for custom trackers (not built-in)
    if (!data.builtIn) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.innerHTML = "X";
      deleteBtn.title = "Remove tracker";
      deleteBtn.onclick = async () => {
        const trackers = await loadAllTrackers();
        delete trackers[id];
        await saveAllTrackers(trackers);
        renderTrackers(trackers);
      };
      mainDiv.appendChild(deleteBtn);
    }

    const toggle = document.createElement("div");
    toggle.className = "toggle";
    if (data.enabled) toggle.classList.add("active");

    toggle.addEventListener("click", async () => {
      toggle.classList.toggle("active");
      const isActive = toggle.classList.contains("active");

      const trackers = await loadAllTrackers();
      trackers[id].enabled = isActive;
      await saveAllTrackers(trackers);
    });

    div.appendChild(mainDiv);
    div.appendChild(toggle);
    return div;
  }

  // Render all trackers
  function renderTrackers(trackers) {
    // Clear list completely
    trackerList.innerHTML = "";

    // Render all trackers
    Object.entries(trackers).forEach(([id, data]) => {
      const el = createTrackerElement(id, data);
      trackerList.appendChild(el);
    });
  }

  // Add custom tracker
  addBtn.addEventListener("click", async () => {
    const name = customNameInput.value.trim();
    const url = customUrlInput.value.trim();
    const searchType = document.querySelector(
      'input[name="search-type"]:checked',
    ).value;

    // Validation
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

    const trackers = await loadAllTrackers();
    const id = "tracker_" + Date.now();

    trackers[id] = {
      name: name,
      url: url,
      enabled: true,
      builtIn: false,
      searchType: searchType,
    };

    await saveAllTrackers(trackers);

    // Clear inputs
    customNameInput.value = "";
    customUrlInput.value = "";
    document.querySelector('input[value="title"]').checked = true;

    // Re-render immediately to show all trackers including new one
    renderTrackers(trackers);
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add("show");
  }

  function hideError() {
    errorMsg.classList.remove("show");
  }

  // Clear error on input
  [customNameInput, customUrlInput].forEach((input) => {
    input.addEventListener("input", hideError);
  });

  // Initial render
  const trackers = await loadAllTrackers();
  renderTrackers(trackers);
});
