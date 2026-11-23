/*
 * Shared configuration and helpers.
 * Loaded by the content script, the popup and the background script so that
 * defaults, settings merging and URL building only live in one place.
 */
if (typeof browser === "undefined") {
  var browser = chrome;
}

var LBDL = (() => {
  const SEARCH_TYPES = {
    titleOnly: "Title",
    title: "Title + Year",
    imdb: "IMDb ID",
  };

  // Placeholders that can be used in a source URL.
  const PLACEHOLDERS = ["query", "title", "year", "imdb", "imdbNum", "tmdb", "quality"];

  // Placeholders that cannot be substituted with an empty value.
  const ID_PLACEHOLDERS = {
    imdb: "IMDb ID",
    imdbNum: "IMDb ID",
    tmdb: "TMDB ID",
  };

  const CATEGORIES = {
    trackers: {
      label: "Download",
      buttonText: "Download",
      idPrefix: "tracker",
      emptyMessage: "No download sources enabled",
      defaultSearchType: "title",
      useQuality: true,
      defaults: {
        "1337x": {
          name: "1337x",
          url: "https://1337x.to/search/{query}/1/",
          enabled: true,
          searchType: "title",
        },
        rarbg: {
          name: "The RARBG",
          url: "https://therarbg.to/get-posts/keywords:{query}/",
          enabled: true,
          searchType: "imdb",
        },
        piratebay: {
          name: "The Pirate Bay",
          url: "https://thepiratebay.org/search.php?q={query}&all=on&search=Pirate+Search&page=0&orderby=",
          enabled: true,
          searchType: "title",
        },
      },
    },
    streamingSources: {
      label: "Streaming",
      buttonText: "Watch",
      idPrefix: "streaming",
      visibilitySetting: "watchButtonEnabled",
      emptyMessage: "No streaming sources enabled",
      defaultSearchType: "titleOnly",
      defaults: {
        pstream: {
          name: "P-Stream",
          url: "https://pstream.net/browse/{query}",
          enabled: true,
          searchType: "titleOnly",
        },
      },
    },
  };

  const CATEGORY_ORDER = Object.keys(CATEGORIES);

  const DEFAULT_SETTINGS = {
    watchButtonEnabled: true,
    cleanTitles: true,
    qualitySuffix: "",
    // { [categoryKey]: sourceId } — the button opens this source directly.
    defaultSources: {},
  };

  /** Keeps only { knownCategory: "sourceId" } pairs; always returns a new object. */
  function sanitizeDefaultSources(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([category, id]) =>
          Object.hasOwn(CATEGORIES, category) && typeof id === "string" && id,
      ),
    );
  }

  /** The enabled default source of a category, or null. */
  function getDefaultSource(categoryKey, settings, sources) {
    const id = settings.defaultSources?.[categoryKey];
    const source = id ? sources[categoryKey]?.[id] : null;
    return source?.enabled ? { id, ...source } : null;
  }

  const QUALITY_OPTIONS = ["", "720p", "1080p", "2160p"];

  const RELEASE_CACHE_PREFIX = "releaseDates:";

  function pickSourceFields(stored, fallback = {}) {
    return {
      name:
        typeof stored.name === "string" && stored.name.trim()
          ? stored.name
          : fallback.name ?? "Untitled",
      url: typeof stored.url === "string" ? stored.url : fallback.url ?? "",
      enabled:
        typeof stored.enabled === "boolean"
          ? stored.enabled
          : fallback.enabled ?? true,
      searchType: Object.hasOwn(SEARCH_TYPES, stored.searchType)
        ? stored.searchType
        : fallback.searchType ?? "title",
    };
  }

  /**
   * Combines the built-in sources with what is stored.
   * - Built-ins the user never edited always use the current default URL/name,
   *   so URL fixes and new built-ins in updates reach existing users.
   * - Only `enabled` and `order` are taken from storage for those.
   * - Edited built-ins (`customized: true`) and custom sources keep their fields.
   */
  function mergeSources(categoryKey, stored) {
    const defaults = CATEGORIES[categoryKey].defaults;
    const storedEntries =
      stored && typeof stored === "object" ? Object.entries(stored) : [];
    const entries = [];
    const seen = new Set();

    storedEntries.forEach(([id, source], index) => {
      if (!source || typeof source !== "object") return;
      const sort = Number.isFinite(source.order) ? source.order : index;

      if (Object.hasOwn(defaults, id)) {
        const def = defaults[id];
        const merged = source.customized
          ? { ...def, ...pickSourceFields(source, def), customized: true }
          : {
              ...def,
              enabled:
                typeof source.enabled === "boolean" ? source.enabled : def.enabled,
              customized: false,
            };
        entries.push({ id, sort, source: { ...merged, builtIn: true } });
        seen.add(id);
      } else if (
        !source.builtIn &&
        typeof source.url === "string" &&
        typeof source.name === "string"
      ) {
        entries.push({
          id,
          sort,
          source: { ...pickSourceFields(source), builtIn: false },
        });
      }
      // A stored built-in that no longer exists in the defaults is dropped.
    });

    let next = entries.length ? Math.max(...entries.map((e) => e.sort)) + 1 : 0;
    Object.entries(defaults).forEach(([id, def]) => {
      if (seen.has(id)) return;
      entries.push({
        id,
        sort: next++,
        source: { ...def, builtIn: true, customized: false },
      });
    });

    entries.sort((a, b) => a.sort - b.sort);
    return Object.fromEntries(
      entries.map((entry, order) => [entry.id, { ...entry.source, order }]),
    );
  }

  function sortedSources(sources) {
    return Object.entries(sources || {})
      .map(([id, source]) => ({ id, ...source }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  function isCategoryVisible(categoryKey, settings) {
    const key = CATEGORIES[categoryKey].visibilitySetting;
    return !key || settings[key] !== false;
  }

  async function loadAll() {
    const query = { ...DEFAULT_SETTINGS };
    CATEGORY_ORDER.forEach((key) => (query[key] = {}));

    let stored = query;
    try {
      stored = await browser.storage.sync.get(query);
    } catch (err) {
      console.error("[Letterboxd DL] Error loading settings:", err);
    }

    const settings = {};
    Object.entries(DEFAULT_SETTINGS).forEach(([key, def]) => {
      settings[key] = typeof stored[key] === typeof def ? stored[key] : def;
    });
    if (!QUALITY_OPTIONS.includes(settings.qualitySuffix)) {
      settings.qualitySuffix = "";
    }
    settings.defaultSources = sanitizeDefaultSources(stored.defaultSources);

    const sources = {};
    CATEGORY_ORDER.forEach((key) => {
      sources[key] = mergeSources(key, stored[key]);
    });

    return { settings, sources };
  }

  /**
   * "Amélie" -> "Amelie", "Mission: Impossible" -> "Mission Impossible",
   * "Schindler's List" -> "Schindlers List". Non-Latin scripts are kept.
   */
  function cleanTitle(title) {
    return title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .normalize("NFC")
      .replace(/['’`]/g, "")
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
      .trim();
  }

  function placeholdersIn(url) {
    return [...String(url).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  }

  /**
   * Builds the final URL for a source.
   * movie: { title, year, imdbId, tmdbId }
   * Returns { url } or { url: null, missing: [...] } when an ID placeholder
   * has no value or the result is not an http(s) URL.
   */
  function buildSourceUrl(source, movie, settings, categoryKey) {
    const rawTitle = (movie.title || "").replace(/ /g, " ").trim();
    const title = settings.cleanTitles ? cleanTitle(rawTitle) || rawTitle : rawTitle;
    const year = movie.year || "";
    const imdb = movie.imdbId || "";
    const quality = CATEGORIES[categoryKey]?.useQuality
      ? settings.qualitySuffix || ""
      : "";
    const join = (...parts) => parts.filter(Boolean).join(" ");

    const queryByType = {
      titleOnly: title,
      title: join(title, year, quality),
      imdb: imdb || join(title, year, quality),
    };

    const values = {
      query: queryByType[source.searchType] ?? queryByType.title,
      title,
      year,
      imdb,
      imdbNum: imdb.replace(/^tt0*/, ""),
      tmdb: movie.tmdbId || "",
      quality,
    };

    const missing = [];
    const url = String(source.url).replace(/\{(\w+)\}/g, (match, key) => {
      if (!Object.hasOwn(values, key)) return match;
      if (!values[key] && Object.hasOwn(ID_PLACEHOLDERS, key)) {
        missing.push(key);
        return "";
      }
      return encodeURIComponent(values[key]);
    });

    if (missing.length || !/^https?:\/\//i.test(url)) {
      return { url: null, missing };
    }
    return { url };
  }

  function describeMissing(missing) {
    return [...new Set(missing.map((key) => ID_PLACEHOLDERS[key] || key))].join(
      " and ",
    );
  }

  /** Returns an error message, or null if the template is valid. */
  function validateTemplate(url) {
    const keys = placeholdersIn(url);
    if (!keys.length) {
      return "URL must include a placeholder such as {query}";
    }
    const unknown = keys.find((key) => !PLACEHOLDERS.includes(key));
    if (unknown) {
      return `Unknown placeholder {${unknown}}`;
    }
    let parsed;
    try {
      parsed = new URL(url.replace(/\{(\w+)\}/g, "test"));
    } catch {
      return "Please enter a valid URL";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "URL must start with http:// or https://";
    }
    return null;
  }

  const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

  function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity) => {
      if (entity[0] !== "#") return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    });
  }

  function splitTitleYear(text) {
    const match = text.match(/^(.*?)(?:\s+\((\d{4})\))?$/s);
    return { title: (match?.[1] ?? text).trim(), year: match?.[2] ?? "" };
  }

  /** Extracts film info from a Letterboxd film page's HTML without a DOM. */
  function parseFilmHtml(html) {
    const ogTag = html.match(/<meta\b[^>]*\bproperty=(["'])og:title\1[^>]*>/i)?.[0];
    const ogTitle = ogTag?.match(/\bcontent=(["'])(.*?)\1/i)?.[2] ?? "";
    const { title, year } = splitTitleYear(decodeEntities(ogTitle));

    return {
      title,
      year,
      imdbId: html.match(/imdb\.com\/title\/(tt\d+)/)?.[1] ?? null,
      tmdbId:
        html.match(/themoviedb\.org\/movie\/(\d+)/)?.[1] ??
        html.match(/data-tmdb-id=(["'])(\d+)\1/)?.[2] ??
        null,
    };
  }

  function titleFromSlug(slug) {
    return decodeURIComponent(slug).replace(/-+/g, " ").trim();
  }

  return {
    SEARCH_TYPES,
    PLACEHOLDERS,
    CATEGORIES,
    CATEGORY_ORDER,
    DEFAULT_SETTINGS,
    QUALITY_OPTIONS,
    RELEASE_CACHE_PREFIX,
    mergeSources,
    sortedSources,
    sanitizeDefaultSources,
    getDefaultSource,
    isCategoryVisible,
    loadAll,
    cleanTitle,
    placeholdersIn,
    buildSourceUrl,
    describeMissing,
    validateTemplate,
    splitTitleYear,
    decodeEntities,
    parseFilmHtml,
    titleFromSlug,
  };
})();
