// ========================================
// Constants
// ========================================

const BASE_URL = "https://www.dvdsreleasedates.com";
const SEARCH_URL = `${BASE_URL}/search/`;

// ========================================
// Message Listener
// ========================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "getReleaseDates") return;

  handleGetReleaseDates(request)
    .then((data) => sendResponse({ success: true, ...data }))
    .catch((err) =>
      sendResponse({ success: false, error: err.message }),
    );

  return true; // Required for async response
});

// ========================================
// Main Handler
// ========================================

async function handleGetReleaseDates({ movieTitle, movieYear }) {
  const movieUrl = await searchMovie(movieTitle, movieYear);
  const html = await fetchHtml(movieUrl);

  return { url: movieUrl, html };
}

// ========================================
// Search Logic
// ========================================

async function searchMovie(title, year) {
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ searchStr: title }).toString(),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Search failed (${response.status})`);
  }

  const html = await response.text();
  const results = extractMovieResults(html);

  if (!results.length) {
    throw new Error("No movie link found");
  }

  // Try match by year
  if (year) {
    const match = results.find((r) => r.year === year);
    if (match) return toAbsoluteUrl(match.url);
  }

  // Fallback to first result
  return toAbsoluteUrl(results[0].url);
}

// ========================================
// Helpers
// ========================================

async function fetchHtml(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to fetch movie page");
  }

  return response.text();
}

function extractMovieResults(html) {
  const regex =
    /<a[^>]+href=["']([^"']*\/movies\/[^"']+)["'][^>]*>[\s\S]*?<img[^>]+src=["'][^"']*?(\d{4})\.jpg["'][^>]*>/gi;

  return [...html.matchAll(regex)].map((match) => ({
    url: match[1],
    year: match[2],
  }));
}

function toAbsoluteUrl(url) {
  return url.startsWith("/") ? `${BASE_URL}${url}` : url;
}
