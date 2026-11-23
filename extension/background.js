// Chrome loads this as a service worker; Firefox loads defaults.js first via the manifest.
if (typeof importScripts === "function") {
  importScripts("defaults.js");
}

const RELEASE_BASE_URL = "https://www.dvdsreleasedates.com";
const RELEASE_SEARCH_URL = `${RELEASE_BASE_URL}/search/`;

const MENU_ROOT_ID = "lbdl-root";
const MENU_PREFIX = "lbdl|";
const FILM_LINK_PATTERNS = [
  "*://letterboxd.com/film/*",
  "*://letterboxd.com/*/film/*",
];

const COMMAND_CATEGORIES = {
  "open-download": "trackers",
  "open-watch": "streamingSources",
};

/* ---------------------------------------------------------------- messages */

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action === "getReleaseDates") {
    handleGetReleaseDates(request)
      .then((data) => sendResponse({ success: true, ...data }))
      .catch((err) =>
        sendResponse({
          success: false,
          notFound: err.code === "NOT_FOUND",
          error: err.message,
        }),
      );
    return true;
  }

  if (request?.action === "openTabs") {
    openTabs(request.urls, { active: Boolean(request.active), tab: sender.tab })
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

async function openTabs(urls, { active = true, tab } = {}) {
  const safeUrls = (Array.isArray(urls) ? urls : []).filter(
    (url) => typeof url === "string" && /^https?:\/\//i.test(url),
  );

  for (const [i, url] of safeUrls.entries()) {
    const props = { url, active: active && i === 0 };
    if (tab?.id != null) {
      props.openerTabId = tab.id;
      props.index = tab.index + 1 + i;
    }
    try {
      await browser.tabs.create(props);
    } catch {
      // Safari doesn't support every tab property (e.g. openerTabId).
      await browser.tabs.create({ url, active: props.active });
    }
  }
}

/* ----------------------------------------------------------- release dates */

function notFoundError(message) {
  const err = new Error(message);
  err.code = "NOT_FOUND";
  return err;
}

async function handleGetReleaseDates({ movieTitle, movieYear, imdbId }) {
  if (!movieTitle) throw notFoundError("Missing movie title");

  const match = await searchMovie(movieTitle, movieYear, imdbId);
  const url = toAbsoluteUrl(match.url);
  // A search that redirected straight to the film page already has its HTML.
  const html = match.html ?? (await fetchHtml(url));

  return {
    url,
    html,
    // Which film the dates belong to, shown in the ⓘ tooltip.
    match: {
      title: match.title || movieTitle,
      year: match.year,
      by: match.by,
    },
  };
}

/**
 * Picks the search result for this film. Returns the result plus `by`:
 * "imdb" (same IMDb ID), "year" (same year), "nearYear" (±1 year) or "first".
 */
async function searchMovie(title, year, imdbId) {
  const response = await fetch(RELEASE_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ searchStr: title }).toString(),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Search failed (${response.status})`);
  }

  const searchHtml = await response.text();

  // With one strong hit the site skips the result list and redirects to the
  // film page. Its sidebar lists other films, so read only the page's own film.
  if (/\/movies\//.test(response.url)) {
    const film = parseFilmPage(searchHtml, response.url);
    const by = checkFilmPage(film, year, imdbId);
    if (!by) throw notFoundError(`Redirected to a different film: ${film.title} (${film.year})`);
    return { ...film, by, html: searchHtml };
  }

  const results = extractMovieResults(searchHtml);
  if (!results.length) throw notFoundError("No movie link found");

  // An IMDb ID match is exact.
  if (imdbId) {
    const byImdb = results.find((r) => r.imdbId === imdbId);
    if (byImdb) return { ...byImdb, by: "imdb" };
  }

  // Never fall back to a result that is a known, different film.
  const candidates = imdbId
    ? results.filter((r) => !r.imdbId || r.imdbId === imdbId)
    : results;

  if (!year) {
    if (candidates.length) return { ...candidates[0], by: "first" };
    throw notFoundError(`No result for ${title}`);
  }

  // Prefer an exact year match. Festival vs. theatrical years often differ by
  // one, so allow ±1 as a fallback, but never show an unrelated film's dates.
  const exact = candidates.find((r) => r.year === year);
  if (exact) return { ...exact, by: "year" };

  const near = candidates.find((r) => Math.abs(Number(r.year) - Number(year)) <= 1);
  if (near) return { ...near, by: "nearYear" };

  throw notFoundError(`No result for ${title} (${year})`);
}

/** Reads the film's own title, year and IMDb ID from a dvdsreleasedates film page. */
function parseFilmPage(html, pageUrl) {
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const name =
    heading.match(/itemprop=["']name["'][^>]*>([^<]+)</i)?.[1] ??
    heading.replace(/<[^>]+>/g, " ").replace(/\(\s*\d{4}\s*\)/, "");
  const canonical = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
  )?.[1];

  return {
    url: canonical || pageUrl,
    title: LBDL.decodeEntities(name).replace(/\s+/g, " ").trim() || null,
    // Newer pages link the year: "(<a …>2024</a>)".
    year: heading.replace(/<[^>]+>/g, " ").match(/\(\s*(\d{4})\s*\)/)?.[1] ?? null,
    // The film's own IMDb link comes first; the sidebar's films come later.
    imdbId: html.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] ?? null,
  };
}

/** How a redirected-to film page matches this film, or null if it's a different film. */
function checkFilmPage(film, year, imdbId) {
  if (imdbId && film.imdbId) return film.imdbId === imdbId ? "imdb" : null;
  if (!year || !film.year) return "first";
  if (film.year === year) return "year";
  return Math.abs(Number(film.year) - Number(year)) <= 1 ? "nearYear" : null;
}

async function fetchHtml(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch movie page");
  return response.text();
}

function extractMovieResults(html) {
  const regex =
    // The poster <img> must sit directly inside the link. A looser pattern let a
    // result's title link pair up with the *next* result's poster and year.
    /<a[^>]+href=["']([^"']*\/movies\/[^"']+)["'][^>]*>\s*<img[^>]+src=["'][^"']*?(\d{4})\.jpg["'][^>]*>/gi;

  const matches = [...html.matchAll(regex)];

  return matches.map((match, i) => {
    // Each result is: poster link, then a title link, then an IMDb link.
    const end = matches[i + 1]?.index ?? match.index + match[0].length + 1500;
    const rest = html.slice(match.index + match[0].length, end);
    const title = rest.match(/<a[^>]+\/movies\/[^>]*>([^<]+)<\/a>/i)?.[1];

    return {
      url: match[1],
      year: match[2],
      title: title ? LBDL.decodeEntities(title).trim() : null,
      imdbId: rest.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] ?? null,
    };
  });
}

function toAbsoluteUrl(url) {
  return url.startsWith("/") ? `${RELEASE_BASE_URL}${url}` : url;
}

async function pruneReleaseCache() {
  try {
    const all = await browser.storage.local.get(null);
    const now = Date.now();
    const stale = Object.entries(all)
      .filter(
        ([key, value]) =>
          key.startsWith(LBDL.RELEASE_CACHE_PREFIX) &&
          !(value?.expires > now),
      )
      .map(([key]) => key);
    if (stale.length) await browser.storage.local.remove(stale);
  } catch (err) {
    console.error("[Letterboxd DL] Cache prune failed:", err);
  }
}

browser.runtime.onStartup?.addListener(pruneReleaseCache);
browser.runtime.onInstalled?.addListener(pruneReleaseCache);

/* ----------------------------------------------------------- context menus */

function createMenu(props) {
  // Resolves with the error (if any) instead of rejecting.
  return new Promise((resolve) => {
    try {
      browser.contextMenus.create(props, () => resolve(browser.runtime.lastError));
    } catch (err) {
      resolve(err);
    }
  });
}

async function buildMenus() {
  try {
    await browser.contextMenus.removeAll();

    const { settings, sources } = await LBDL.loadAll();
    const groups = LBDL.CATEGORY_ORDER.filter((key) =>
      LBDL.isCategoryVisible(key, settings),
    )
      .map((key) => [key, LBDL.sortedSources(sources[key]).filter((s) => s.enabled)])
      .filter(([, list]) => list.length);

    if (!groups.length) return;

    const rootProps = {
      id: MENU_ROOT_ID,
      title: "Letterboxd DL",
      contexts: ["link"],
      targetUrlPatterns: FILM_LINK_PATTERNS,
      documentUrlPatterns: ["*://letterboxd.com/*"],
    };
    if (await createMenu(rootProps)) {
      // Fallback for browsers without targetUrlPatterns support (Safari):
      // show on every link; clicks on non-film links are ignored.
      delete rootProps.targetUrlPatterns;
      await createMenu(rootProps);
    }

    for (const [key, list] of groups) {
      const groupId = `${MENU_PREFIX}${key}`;
      await createMenu({
        id: groupId,
        parentId: MENU_ROOT_ID,
        title: LBDL.CATEGORIES[key].label,
        contexts: ["link"],
      });

      for (const source of list) {
        await createMenu({
          id: `${groupId}|${source.id}`,
          parentId: groupId,
          title: source.name,
          contexts: ["link"],
        });
      }
    }
  } catch (err) {
    console.error("[Letterboxd DL] Failed to build context menu:", err);
  }
}

// Serialize rebuilds so removeAll/create calls never interleave.
let menuBuild = Promise.resolve();
function scheduleMenuBuild() {
  menuBuild = menuBuild.then(buildMenus);
  return menuBuild;
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") scheduleMenuBuild();
});

scheduleMenuBuild();

const filmInfoCache = new Map();

async function getFilmInfo(slug) {
  if (filmInfoCache.has(slug)) return filmInfoCache.get(slug);

  let info = null;
  try {
    const response = await fetch(`https://letterboxd.com/film/${slug}/`, {
      credentials: "include",
    });
    if (response.ok) {
      const parsed = LBDL.parseFilmHtml(await response.text());
      if (parsed.title) info = parsed;
    }
  } catch (err) {
    console.warn("[Letterboxd DL] Could not fetch film page:", err);
  }

  if (!info) {
    // Fall back to the slug so title-based sources still work.
    return { title: LBDL.titleFromSlug(slug), year: "", imdbId: null, tmdbId: null };
  }

  if (filmInfoCache.size > 50) {
    filmInfoCache.delete(filmInfoCache.keys().next().value);
  }
  filmInfoCache.set(slug, info);
  return info;
}

async function handleMenuClick(categoryKey, sourceId, linkUrl, tab) {
  const slug = linkUrl?.match(/\/film\/([^/?#]+)/)?.[1];
  if (!slug || !LBDL.CATEGORIES[categoryKey]) return;

  const [{ settings, sources }, movie] = await Promise.all([
    LBDL.loadAll(),
    getFilmInfo(slug),
  ]);

  const source = sources[categoryKey]?.[sourceId];
  if (!source?.enabled) return;

  const { url } = LBDL.buildSourceUrl(source, movie, settings, categoryKey);
  if (url) await openTabs([url], { active: true, tab });
}

browser.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (!id.startsWith(MENU_PREFIX)) return;

  const [, categoryKey, sourceId] = id.split("|");
  if (!sourceId) return;

  handleMenuClick(categoryKey, sourceId, info.linkUrl, tab).catch((err) =>
    console.error("[Letterboxd DL] Context menu action failed:", err),
  );
});

/* --------------------------------------------------------------- shortcuts */

browser.commands?.onCommand.addListener(async (command) => {
  const category = COMMAND_CATEGORIES[command];
  if (!category) return;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;

  browser.tabs.sendMessage(tab.id, { action: "openMenu", category }).catch(() => {});
});
