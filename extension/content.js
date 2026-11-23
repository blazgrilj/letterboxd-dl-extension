// Depends on defaults.js (loaded first via the manifest), which provides `LBDL` and `browser`.

const NO_RELEASE_DATA_MSG = "No release date information available";
const DAY_MS = 24 * 60 * 60 * 1000;
const RELEASE_CACHE_TTL = {
  complete: 30 * DAY_MS, // every known date is in the past
  pending: DAY_MS, // upcoming / not announced yet
  notFound: 3 * DAY_MS,
};
const STATUS_COLORS = {
  upcoming: "#e5533d",
  released: "#4caf50",
  unknown: "#8f8f8f",
};

let state = { settings: { ...LBDL.DEFAULT_SETTINGS }, sources: {} };
let releaseInfo = null; // null while loading, then { dates, url }
let openMenu = null; // { el, category, button }
let injected = false;

const qs = (selector, parent = document) => parent.querySelector(selector);

const createEl = (tag, options = {}) => {
  const el = document.createElement(tag);
  Object.assign(el, options);
  return el;
};

async function refreshState() {
  state = await LBDL.loadAll();
}

/* ------------------------------------------------------------------ movie */

function getMovie() {
  const og = LBDL.splitTitleYear(
    qs('meta[property="og:title"]')?.content ?? "",
  );
  const title = (
    qs("h1.headline-1.primaryname span.name")?.textContent ?? og.title
  )
    .replace(/ /g, " ")
    .trim();
  const year = (qs(".releasedate a")?.textContent ?? og.year).trim();

  const imdbId =
    qs('a[href*="imdb.com/title/tt"]')?.href.match(/tt\d+/)?.[0] ?? null;
  const tmdbId =
    qs('a[href*="themoviedb.org/movie/"]')?.href.match(/movie\/(\d+)/)?.[1] ??
    document.body?.dataset.tmdbId ??
    null;
  const slug = location.pathname.match(/\/film\/([^/]+)/)?.[1] ?? null;

  return { title, year, imdbId, tmdbId, slug };
}

/* ----------------------------------------------------------------- styles */

function injectStyles() {
  if (qs("#lbdl-styles")) return;

  const reference = qs(".micro-button");
  const copied = reference
    ? (() => {
        const computed = window.getComputedStyle(reference);
        return [
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
        ]
          .map((p) => `${p}: ${computed.getPropertyValue(p)};`)
          .join("\n");
      })()
    : "";

  const style = createEl("style", { id: "lbdl-styles" });
  style.textContent = `
    .lbdl-wrapper {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }
    a.lbdl-btn {
      ${copied}
      color: rgba(0, 192, 48, 1);
    }
    a.lbdl-btn:hover,
    a.lbdl-btn:active,
    a.lbdl-btn:focus-visible,
    a.lbdl-btn[aria-expanded="true"] {
      color: rgba(0, 255, 64, 1);
      border-color: #9ab;
    }
    a.lbdl-btn[hidden],
    .lbdl-group[hidden] {
      display: none !important;
    }
    .lbdl-group {
      display: inline-flex;
      align-items: stretch;
    }
    .lbdl-group.has-default a.lbdl-btn-main {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    .lbdl-group.has-default a.lbdl-btn-arrow {
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      border-left-width: 0;
      padding-left: 4px;
      padding-right: 4px;
    }
    .lbdl-release {
      font-size: 12px;
      color: #8f8f8f;
      white-space: nowrap;
    }
    a.lbdl-info {
      font-size: 14px;
      color: #8f8f8f;
      text-decoration: none;
      line-height: 1;
    }
    a.lbdl-info:hover {
      color: #fff;
    }
    .lbdl-dropdown {
      position: absolute;
      z-index: 9999;
      min-width: 180px;
      background: #141414;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      overflow: hidden;
      font-size: 12px;
    }
    .lbdl-dropdown .lbdl-item {
      display: block;
      padding: 8px 12px;
      color: #9ab;
      text-decoration: none;
      cursor: pointer;
      border-top: 1px solid #1e1e1e;
      transition: background 0.1s, color 0.1s;
    }
    .lbdl-dropdown .lbdl-item:first-child {
      border-top: none;
    }
    .lbdl-dropdown a.lbdl-item:hover,
    .lbdl-dropdown a.lbdl-item:focus {
      background: #1e1e1e;
      color: #fff;
      outline: none;
    }
    .lbdl-dropdown .lbdl-item.is-disabled {
      color: #555;
      cursor: not-allowed;
    }
    .lbdl-dropdown .lbdl-empty {
      padding: 10px 12px;
      color: #555;
    }
  `;
  document.head.appendChild(style);
}

/* ---------------------------------------------------------------- buttons */

/**
 * A button group per category: the main button, plus a ▾ button that is only
 * shown when a default source is set. Then the main button opens the default
 * source directly and ▾ opens the full list.
 */
function createMenuButton(category) {
  const config = LBDL.CATEGORIES[category];
  const group = createEl("span", { className: `lbdl-group lbdl-group-${category}` });

  const main = createEl("a", {
    textContent: config.buttonText,
    href: "#",
    className: `lbdl-btn lbdl-btn-main lbdl-btn-${category}`,
  });
  main.setAttribute("role", "button");
  main.setAttribute("aria-expanded", "false");

  const arrow = createEl("a", {
    textContent: "▾",
    href: "#",
    className: `lbdl-btn lbdl-btn-arrow lbdl-arrow-${category}`,
    title: `All ${config.label.toLowerCase()} sources`,
    hidden: true,
  });
  arrow.setAttribute("role", "button");
  arrow.setAttribute("aria-haspopup", "menu");
  arrow.setAttribute("aria-expanded", "false");
  arrow.setAttribute("aria-label", `All ${config.label.toLowerCase()} sources`);

  main.addEventListener("click", (e) => {
    e.preventDefault();
    if (openDefaultSource(category)) return;
    // detail === 0 means the click came from the keyboard (Enter).
    toggleMenu(category, { focusFirst: e.detail === 0 });
  });

  arrow.addEventListener("click", (e) => {
    e.preventDefault();
    toggleMenu(category, { focusFirst: e.detail === 0 });
  });

  group.append(main, arrow);
  return group;
}

/** Opens the category's default source. Returns false if there is none or it can't be built. */
function openDefaultSource(category) {
  const source = LBDL.getDefaultSource(category, state.settings, state.sources);
  if (!source) return false;

  const { url } = LBDL.buildSourceUrl(source, getMovie(), state.settings, category);
  if (!url) return false; // e.g. IMDb ID missing: fall back to the list

  closeMenus();
  openUrls([url], true);
  return true;
}

function createInfoButton() {
  return createEl("a", {
    textContent: "🛈",
    href: releaseInfo?.url ?? "https://www.dvdsreleasedates.com",
    target: "_blank",
    rel: "noopener noreferrer",
    title: "Source: dvdsreleasedates.com",
    className: "lbdl-info",
  });
}

function createReleaseInfo() {
  return createEl("span", {
    className: "lbdl-release",
    textContent: "Loading release dates…",
  });
}

function syncButtons() {
  LBDL.CATEGORY_ORDER.forEach((category) => {
    const group = qs(`.lbdl-group-${category}`);
    if (!group) return;

    group.hidden = !LBDL.isCategoryVisible(category, state.settings);

    const source = LBDL.getDefaultSource(category, state.settings, state.sources);
    const main = qs(".lbdl-btn-main", group);
    const arrow = qs(".lbdl-btn-arrow", group);

    group.classList.toggle("has-default", Boolean(source));
    arrow.hidden = !source;
    main.title = source ? `Open ${source.name}` : "";
    if (source) {
      main.removeAttribute("aria-haspopup");
    } else {
      main.setAttribute("aria-haspopup", "menu");
    }
  });
  closeMenus();
}

/** The button the menu belongs to: ▾ when a default is set, otherwise the main button. */
function getMenuAnchor(category) {
  const group = qs(`.lbdl-group-${category}`);
  if (!group || group.hidden) return null;
  const arrow = qs(".lbdl-btn-arrow", group);
  return { group, button: arrow.hidden ? qs(".lbdl-btn-main", group) : arrow };
}

function tryInject() {
  if (injected) return true;

  const footer = qs("p.text-link.text-footer");
  if (!footer) return false;

  injectStyles();

  const wrapper = createEl("div", { className: "lbdl-wrapper" });
  LBDL.CATEGORY_ORDER.forEach((category) =>
    wrapper.appendChild(createMenuButton(category)),
  );
  wrapper.append(createReleaseInfo(), createInfoButton());
  footer.after(wrapper);

  injected = true;
  syncButtons();
  loadReleaseDates(getMovie());
  return true;
}

/* --------------------------------------------------------------- dropdown */

function closeMenus() {
  document.querySelectorAll(".lbdl-dropdown").forEach((el) => el.remove());
  openMenu?.button.setAttribute("aria-expanded", "false");
  openMenu = null;
}

function openUrls(urls, active) {
  browser.runtime
    .sendMessage({ action: "openTabs", urls, active })
    .catch(() => {
      urls.forEach((url) => window.open(url, "_blank", "noopener,noreferrer"));
    });
}

function toggleMenu(category, { focusFirst = false } = {}) {
  const wasOpen = openMenu?.category === category;
  closeMenus();
  if (wasOpen) return;

  const anchor = getMenuAnchor(category);
  if (!anchor) return;
  const btn = anchor.button;

  const movie = getMovie();
  const items = LBDL.sortedSources(state.sources[category])
    .filter((source) => source.enabled)
    .map((source) => ({
      source,
      ...LBDL.buildSourceUrl(source, movie, state.settings, category),
    }));

  // A single source opens directly, no menu needed.
  if (items.length === 1 && items[0].url) {
    openUrls([items[0].url], true);
    return;
  }

  const dropdown = renderDropdown(category, items);
  document.body.appendChild(dropdown);
  positionDropdown(dropdown, anchor.group);

  openMenu = { el: dropdown, category, button: btn };
  btn.setAttribute("aria-expanded", "true");

  if (focusFirst) qs("a.lbdl-item", dropdown)?.focus();
}

function positionDropdown(dropdown, btn) {
  const rect = btn.getBoundingClientRect();
  const maxLeft =
    document.documentElement.clientWidth - dropdown.offsetWidth - 8;
  const left = Math.max(8, Math.min(rect.left, maxLeft));

  dropdown.style.top = `${rect.bottom + window.scrollY + 2}px`;
  dropdown.style.left = `${left + window.scrollX}px`;
}

function renderDropdown(category, items) {
  const dropdown = createEl("div", { className: "lbdl-dropdown" });
  dropdown.setAttribute("role", "menu");

  if (!items.length) {
    dropdown.appendChild(
      createEl("div", {
        className: "lbdl-empty",
        textContent: LBDL.CATEGORIES[category].emptyMessage,
      }),
    );
    return dropdown;
  }

  items.forEach(({ source, url, missing }) => {
    if (!url) {
      const disabled = createEl("span", {
        className: "lbdl-item is-disabled",
        textContent: source.name,
        title: missing?.length
          ? `Unavailable: ${LBDL.describeMissing(missing)} not found on this page`
          : "Unavailable: invalid source URL",
      });
      dropdown.appendChild(disabled);
      return;
    }

    const link = createEl("a", {
      className: "lbdl-item",
      href: url,
      textContent: source.name,
      title: url,
    });
    link.setAttribute("role", "menuitem");

    // Every click (normal, Ctrl/Cmd, Shift or middle) opens one foreground tab.
    const open = (e) => {
      if (e.type === "auxclick" && e.button !== 1) return;
      e.preventDefault();
      openUrls([url], true);
      closeMenus();
    };
    link.addEventListener("click", open);
    link.addEventListener("auxclick", open);
    dropdown.appendChild(link);
  });

  return dropdown;
}

document.addEventListener("click", (e) => {
  if (!openMenu) return;
  if (e.target instanceof Element && e.target.closest(".lbdl-dropdown, .lbdl-btn")) {
    return;
  }
  closeMenus();
});

document.addEventListener("keydown", (e) => {
  if (!openMenu) return;

  if (e.key === "Escape") {
    const { button } = openMenu;
    closeMenus();
    button.focus();
    e.preventDefault();
    return;
  }

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const links = [...openMenu.el.querySelectorAll("a.lbdl-item")];
    if (!links.length) return;
    const index = links.indexOf(document.activeElement);
    const next =
      e.key === "ArrowDown"
        ? (index + 1) % links.length
        : index <= 0
          ? links.length - 1
          : index - 1;
    links[next].focus();
    e.preventDefault();
  }
});

/* ---------------------------------------------------------- release dates */

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
    hasData: Boolean(dvdBluray?.value || digital?.value),
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

function renderReleaseInfo() {
  const el = qs(".lbdl-release");
  if (!el || !releaseInfo) return;

  const dates = releaseInfo.dates;
  if (!dates?.hasData) {
    el.textContent = NO_RELEASE_DATA_MSG;
  } else {
    el.replaceChildren();
    [
      ["DVD/Blu-ray", dates.dvdBluray],
      ["Digital", dates.digital],
    ]
      .filter(([, date]) => date?.value)
      .forEach(([label, date], i) => {
        if (i) el.append(" • ");
        el.append(`${label}: `);
        const value = createEl("span", { textContent: date.value });
        value.style.color = STATUS_COLORS[date.status] ?? STATUS_COLORS.unknown;
        el.append(value);
      });
  }

  const infoBtn = qs(".lbdl-info");
  if (infoBtn && releaseInfo.url) infoBtn.href = releaseInfo.url;
}

async function cacheReleaseInfo(key, data, ttl) {
  try {
    await browser.storage.local.set({
      [key]: { data, expires: Date.now() + ttl },
    });
  } catch (err) {
    console.warn("[Letterboxd DL] Could not cache release dates:", err);
  }
}

async function loadReleaseDates(movie) {
  if (!movie.title) {
    releaseInfo = { dates: null, url: null };
    renderReleaseInfo();
    return;
  }

  const key = `${LBDL.RELEASE_CACHE_PREFIX}${
    movie.slug || `${movie.title}|${movie.year}`
  }`;

  try {
    const cached = (await browser.storage.local.get(key))[key];
    if (cached?.expires > Date.now()) {
      releaseInfo = cached.data;
      renderReleaseInfo();
      return;
    }
  } catch {
    // Storage unavailable: just fetch.
  }

  let response = null;
  try {
    response = await browser.runtime.sendMessage({
      action: "getReleaseDates",
      movieTitle: movie.title,
      movieYear: movie.year,
    });
  } catch (err) {
    console.warn("[Letterboxd DL] Release date lookup failed:", err);
  }

  if (response?.success) {
    const dates = parseReleaseDates(response.html);
    releaseInfo = { dates, url: response.url };

    const complete =
      dates.hasData &&
      [dates.dvdBluray, dates.digital].every(
        (date) => !date?.value || date.status === "released",
      );
    cacheReleaseInfo(
      key,
      releaseInfo,
      complete ? RELEASE_CACHE_TTL.complete : RELEASE_CACHE_TTL.pending,
    );
  } else {
    releaseInfo = { dates: null, url: null };
    if (response?.notFound) {
      cacheReleaseInfo(key, releaseInfo, RELEASE_CACHE_TTL.notFound);
    }
  }

  renderReleaseInfo();
}

/* ------------------------------------------------------------ live update */

browser.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== "sync") return;
  await refreshState();
  syncButtons();
});

browser.runtime.onMessage.addListener((request) => {
  if (request?.action === "openMenu" && LBDL.CATEGORIES[request.category]) {
    toggleMenu(request.category, { focusFirst: true });
  }
});

/* ------------------------------------------------------------------- init */

(async function init() {
  await refreshState();

  if (tryInject()) return;

  const observer = new MutationObserver(() => {
    if (tryInject()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Stop watching if the expected element never appears.
  setTimeout(() => observer.disconnect(), 30000);
})();
