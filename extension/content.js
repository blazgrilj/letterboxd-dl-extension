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
    searchType: "titleOnly",
  },
};

const NO_RELEASE_DATA_MSG = "No release date information available";

if (typeof browser === "undefined") {
  var browser = chrome;
}

let cachedReleaseDates = null;
let cachedMovieUrl = null;
let trackers = {};
let streamingSources = {};
let watchButtonEnabled = true;

const qs = (selector, parent = document) => parent.querySelector(selector);

const createEl = (tag, options = {}) => {
  const el = document.createElement(tag);
  Object.assign(el, options);
  return el;
};

const encodeUrlTemplate = (template) => (query) =>
  template.replace("{query}", encodeURIComponent(query));

const buildTrackers = (config) =>
  Object.fromEntries(
    Object.entries(config).map(([id, data]) => [
      id,
      { ...data, url: encodeUrlTemplate(data.url) },
    ]),
  );

async function loadSettings() {
  try {
    const result = await new Promise((resolve) =>
      browser.storage.sync.get(
        {
          trackers: DEFAULT_TRACKERS,
          streamingSources: DEFAULT_STREAMING_SOURCES,
          watchButtonEnabled: true,
        },
        resolve,
      ),
    );
    trackers = buildTrackers(result.trackers);
    streamingSources = buildTrackers(result.streamingSources);
    watchButtonEnabled = result.watchButtonEnabled;
  } catch (err) {
    console.error("Error loading settings:", err);
    trackers = buildTrackers(DEFAULT_TRACKERS);
    streamingSources = buildTrackers(DEFAULT_STREAMING_SOURCES);
    watchButtonEnabled = true;
  }
}

browser.runtime.onMessage.addListener((request) => {
  if (request.action === "updateTrackers") {
    trackers = buildTrackers(request.trackers);
    refreshDropdown();
  }

  if (request.action === "updateStreamingSources") {
    streamingSources = buildTrackers(request.streamingSources);
    closeDropdowns();
  }

  if (request.action === "updateWatchButton") {
    watchButtonEnabled = request.enabled;
    syncWatchButton();
  }
});

function getImdbId() {
  const link = qs('a[href*="imdb.com/title/tt"]');
  const match = link?.href.match(/tt\d+/);
  return match?.[0] ?? null;
}

function refreshDropdown() {
  const dropdown = qs(".download-dropdown");
  if (!dropdown) return;

  dropdown.remove();

  const { title, titleQuery, imdbId } = getMovieSearchContext();
  const nextDropdown = createDropdown(
    trackers,
    { title: titleQuery, titleOnly: title, titleQuery },
    imdbId,
    "No sources enabled",
    "download-dropdown",
  );
  const btn = qs(".download-movie-button");
  if (!btn) return;

  const rect = btn.getBoundingClientRect();
  Object.assign(nextDropdown.style, {
    position: "fixed",
    top: `${rect.bottom + 2}px`,
    left: `${rect.left}px`,
  });
  document.body.appendChild(nextDropdown);

  document.addEventListener("click", function close(e) {
    if (!nextDropdown.contains(e.target) && e.target !== btn) {
      nextDropdown.remove();
      document.removeEventListener("click", close);
    }
  });
}

function closeDropdowns() {
  document.querySelectorAll(".source-dropdown").forEach((el) => el.remove());
}

function syncWatchButton() {
  const watchBtn = qs(".watch-movie-button");
  if (!watchBtn) return;

  closeDropdowns();
  watchBtn.hidden = !watchButtonEnabled;
}

function getMovieSearchContext() {
  const title =
    qs("h1.headline-1.primaryname span.name")?.textContent.trim() ?? "";
  const year = qs(".releasedate a")?.textContent.trim() ?? "";
  const titleQuery = `${title} ${year}`.trim().replace(/\u00A0/g, " ");

  return {
    imdbId: getImdbId(),
    title: title.replace(/\u00A0/g, " "),
    titleQuery,
  };
}

function createDropdown(
  sources,
  searchQuery,
  imdbId,
  emptyMessage,
  dropdownClass,
) {
  const dropdown = createEl("div", {
    className: `source-dropdown ${dropdownClass}`,
  });

  Object.assign(dropdown.style, {
    position: "absolute",
    background: "#141414",
    border: "1px solid #2a2a2a",
    borderRadius: "6px",
    marginTop: "4px",
    zIndex: "9999",
    minWidth: "160px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
    overflow: "hidden",
  });

  const enabled = getEnabledSources(sources);

  if (!enabled.length) {
    const empty = createEl("div", { textContent: emptyMessage });
    Object.assign(empty.style, {
      color: "#555",
      fontSize: "12px",
      padding: "10px 12px",
    });
    dropdown.appendChild(empty);
    return dropdown;
  }

  enabled.forEach((source, i) => {
    const item = createEl("a", {
      textContent: source.name,
      href: "#",
    });

    Object.assign(item.style, {
      display: "block",
      padding: "8px 12px",
      color: "#9ab",
      textDecoration: "none",
      fontSize: "12px",
      cursor: "pointer",
      borderTop: i === 0 ? "none" : "1px solid #1e1e1e",
      transition: "background 0.1s, color 0.1s",
    });

    item.addEventListener("click", (e) => {
      e.preventDefault();
      openSource(source, searchQuery, imdbId);
    });

    item.addEventListener("mouseover", () => {
      item.style.background = "#1e1e1e";
      item.style.color = "#fff";
    });
    item.addEventListener("mouseout", () => {
      item.style.background = "transparent";
      item.style.color = "#9ab";
    });

    dropdown.appendChild(item);
  });

  return dropdown;
}

function getEnabledSources(sources) {
  return Object.values(sources).filter((source) => source.enabled);
}

function getSourceQuery(source, searchQuery, imdbId) {
  return source.searchType === "imdb" && imdbId
    ? imdbId
    : searchQuery[source.searchType] ?? searchQuery.titleQuery;
}

function openSource(source, searchQuery, imdbId) {
  window.open(
    source.url(getSourceQuery(source, searchQuery, imdbId)),
    "_blank",
    "noopener,noreferrer",
  );
}

function attachDropdown(btn, getSources, emptyMessage, dropdownClass) {
  btn.addEventListener("click", async (e) => {
    e.preventDefault();

    const existing = qs(`.${dropdownClass}`);
    if (existing) return existing.remove();

    closeDropdowns();

    const sources = await getSources();
    const { title, titleQuery, imdbId } = getMovieSearchContext();
    const searchQuery = { title: titleQuery, titleOnly: title, titleQuery };
    const enabledSources = getEnabledSources(sources);

    if (enabledSources.length === 1) {
      openSource(enabledSources[0], searchQuery, imdbId);
      return;
    }

    const dropdown = createDropdown(
      sources,
      searchQuery,
      imdbId,
      emptyMessage,
      dropdownClass,
    );

    const rect = btn.getBoundingClientRect();
    Object.assign(dropdown.style, {
      position: "fixed",
      top: `${rect.bottom + 2}px`,
      left: `${rect.left}px`,
    });

    document.body.appendChild(dropdown);

    document.addEventListener("click", function close(e) {
      if (!dropdown.contains(e.target) && e.target !== btn) {
        dropdown.remove();
        document.removeEventListener("click", close);
      }
    });
  });
}

function injectStyles() {
  if (qs("#download-extension-styles")) return;

  const reference = qs(".micro-button");
  if (!reference) return;

  const computed = window.getComputedStyle(reference);
  const props = [
    "border",
    "border-radius",
    "font-size",
    "font-weight",
    "line-height",
    "text-decoration",
    "cursor",
    "display",
    "align-items",
    "padding",
    "font-family",
    "letter-spacing",
    "text-transform",
  ];

  const rules = props
    .map((p) => `${p}: ${computed.getPropertyValue(p)};`)
    .join("\n");

  const style = document.createElement("style");
  style.id = "download-extension-styles";
  style.textContent = `
    .download-movie-button,
    .watch-movie-button {
      ${rules}
      color: rgba(0, 192, 48, 1);
    }
    .download-movie-button:hover,
    .download-movie-button:active,
    .watch-movie-button:hover,
    .watch-movie-button:active {
      color: rgba(0, 255, 64, 1);
      border-color: #9ab;
    }
  `;
  document.head.appendChild(style);
}

function addDownloadButton() {
  const footer = qs("p.text-link.text-footer");
  if (!footer || qs(".download-movie-button")) return false;

  injectStyles();

  const btn = createEl("a", {
    textContent: "Download",
    href: "#",
    className: "download-movie-button",
  });

  attachDropdown(btn, async () => {
    await loadSettings();
    return trackers;
  }, "No sources enabled", "download-dropdown");

  const watchBtn = createEl("a", {
    textContent: "Watch",
    href: "#",
    className: "watch-movie-button",
    hidden: !watchButtonEnabled,
  });

  attachDropdown(
    watchBtn,
    async () => {
      await loadSettings();
      return streamingSources;
    },
    "No streaming services enabled",
    "watch-dropdown",
  );

  const wrapper = createEl("div", {
    className: "download-wrapper",
  });

  Object.assign(wrapper.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "8px",
  });

  wrapper.appendChild(btn);
  wrapper.appendChild(watchBtn);
  wrapper.appendChild(createReleaseInfo());
  wrapper.appendChild(createInfoButton());

  footer.parentNode.insertBefore(wrapper, footer.nextSibling);

  return true;
}

function createInfoButton() {
  const btn = createEl("a", {
    textContent: "🛈",
    href: cachedMovieUrl ?? "https://www.dvdsreleasedates.com",
    target: "_blank",
    rel: "noopener noreferrer",
    title: "Source: dvdsreleasedates.com",
    className: "release-info-btn",
  });

  Object.assign(btn.style, {
    fontSize: "14px",
    color: "#8f8f8f",
    textDecoration: "none",
    cursor: "pointer",
    lineHeight: "1",
  });

  btn.addEventListener("mouseover", () => (btn.style.color = "#fff"));
  btn.addEventListener("mouseout", () => (btn.style.color = "#8f8f8f"));

  return btn;
}

function parseReleaseDates(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const section = [...doc.querySelectorAll("h2")].find((h) =>
    /release date/i.test(h.textContent),
  );

  if (!section) return { hasData: false };

  const spans = [...section.querySelectorAll("span")];

  const dvdBluray = spans[0] ? normalizeDate(spans[0]) : null;
  const digital = spans[1] ? normalizeDate(spans[1]) : null;

  return {
    dvdBluray,
    digital,
    hasData: Boolean(dvdBluray || digital),
  };
}

function normalizeDate(span) {
  const value = span.textContent.trim();

  const status = span.classList.contains("past")
    ? "released"
    : span.classList.contains("future")
      ? value.toLowerCase().includes("not announced")
        ? "unknown"
        : "upcoming"
      : "unknown";

  return { value, status };
}

function getStatusColor(status) {
  return (
    {
      upcoming: "#e5533d",
      released: "#4caf50",
      unknown: "#8f8f8f",
    }[status] || "#8f8f8f"
  );
}

function formatReleaseInfo(dates) {
  if (!dates?.hasData) return NO_RELEASE_DATA_MSG;

  const parts = [];

  if (dates.dvdBluray?.value) {
    parts.push(
      `DVD/Blu-ray: <span style="color:${getStatusColor(
        dates.dvdBluray.status,
      )}">${dates.dvdBluray.value}</span>`,
    );
  }

  if (dates.digital?.value) {
    parts.push(
      `Digital: <span style="color:${getStatusColor(
        dates.digital.status,
      )}">${dates.digital.value}</span>`,
    );
  }

  return parts.join(" • ");
}

function createReleaseInfo() {
  const el = createEl("span", {
    className: "release-dates-info",
    textContent: "Loading release dates…",
  });

  Object.assign(el.style, {
    fontSize: "12px",
    color: "#8f8f8f",
    whiteSpace: "nowrap",
  });

  if (cachedReleaseDates) {
    el.innerHTML = formatReleaseInfo(cachedReleaseDates);
  }

  return el;
}

(async function init() {
  await loadSettings();

  const observer = new MutationObserver(addDownloadButton);
  observer.observe(document.body, { childList: true, subtree: true });

  addDownloadButton();

  const title = qs("h1.headline-1.primaryname span.name")?.textContent.trim();
  const year = qs(".releasedate a")?.textContent.trim();

  browser.runtime.sendMessage(
    { action: "getReleaseDates", movieTitle: title, movieYear: year },
    (response) => {
      if (!response?.success) {
        const infoEl = qs(".release-dates-info");
        if (infoEl) {
          infoEl.textContent = "No release date information available";
        }
        return;
      }

      cachedReleaseDates = parseReleaseDates(response.html);
      cachedMovieUrl = response.url;

      const infoEl = qs(".release-dates-info");
      if (infoEl) {
        infoEl.innerHTML = formatReleaseInfo(cachedReleaseDates);
      }

      const infoBtn = qs(".release-info-btn");
      if (infoBtn) {
        infoBtn.href = cachedMovieUrl;
      }
    },
  );
})();
