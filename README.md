# WatchTracker — Browser Extension

Track movies and TV shows, manage your watchlist, log diary entries, and get recommendations based on your own library.

WatchTracker is a local-first Chrome extension powered by TMDB, with optional OMDb/IMDb ratings support.

## Features

- **Search movies and TV shows** using TMDB.
- **Track status**: Watching, Plan to Watch, Completed, On Hold, Dropped.
- **Episode progress** for TV shows.
- **Rate titles** on a 1–10 scale.
- **Diary logging** for watched movies, episodes, rewatches, ratings, and notes.
- **Filter and browse** your saved movies and shows.
- **Profile and activity views** for your watching history.
- **Export/Import** your data as a JSON backup.
- **MyAnimeList sync** for anime tracking.
- **Recommendations** from the full app and popup.
- **Optional IMDb ratings** through OMDb.
- **External links** to TMDB, IMDb, and Letterboxd for movies.

## Recommendations

WatchTracker includes a recommendations page in the main app and a compact recommendation view in the popup.

Recommendation sources:

- **Something new** — suggests titles not already saved in your library.
- **Plan to Watch** — picks from your saved Plan to Watch list.
- **Completed** — recommends from titles you already completed.
- **My Library** — picks from your full saved library.

Recommendation styles:

- **Closest match** — uses your library and ratings to find similar titles.
- **Similar to favorites** — uses your highly rated titles as anchors.
- **Hidden gems** — favors less obvious titles while still requiring enough vote confidence.
- **Popular** — favors well-known titles.
- **Surprise me** — adds more variety.
- **Random by filters** — ignores taste and uses only selected filters like language, genre, decade, and rating.

Available filters:

- Pick count: **1, 3, 5, 10, 15, 20** in the full app; compact counts in the popup.
- Type: **Movies**, **TV Shows**, **Movies + TV**.
- Library handling: **New only**, **Not completed**, **Allow saved**.
- Genre.
- Decade.
- Language with searchable language input.
- Minimum TMDB rating: **Any, 6+, 7+, 8+, 9+**.
- Minimum personal rating: **Any, 6+, 7+, 8+, 9+**.

### Regional-language recommendations

The recommendation engine is tuned for regional and international films. It supports languages such as Telugu, Tamil, Malayalam, Kannada, Hindi, Bengali, Marathi, Japanese, Korean, Mandarin/Chinese, Cantonese, Thai, French, Spanish, Italian, German, Turkish, Arabic, Persian, and many others.

For regional-language recommendations, WatchTracker avoids strict global vote-count cutoffs. Instead, it fetches a broader language-specific pool and ranks results locally. Vote counts are weighted heavily enough to avoid single-digit-vote titles, but not so aggressively that regional films are unfairly hidden.

### Vote-aware ranking

Recommendations use vote confidence to avoid unreliable picks. The engine considers:

- TMDB rating.
- TMDB vote count.
- Optional IMDb rating from OMDb.
- Optional IMDb vote count from OMDb.
- Your personal ratings and saved library.
- Genre, language, type, and decade filters.
- Recently shown recommendations, so repeated clicks do not simply reshuffle the same titles.

## OMDb / IMDb Support

OMDb support is optional. If you add an OMDb API key, WatchTracker can show IMDb ratings and IMDb vote counts.

Used for:

- IMDb rating display.
- IMDb vote confidence.
- IMDb links on detail pages when an IMDb ID is available.
- Better recommendation scoring when IMDb data exists.

Without an OMDb key, WatchTracker continues to work using TMDB only.

## External Links

Detail pages can include:

- TMDB link.
- IMDb link when an IMDb ID is available.
- Letterboxd link for movies using the TMDB redirect format.

Letterboxd movie links use:

```txt
https://letterboxd.com/tmdb/{tmdbId}/
```

## Setup

### 1. Get a TMDB API Key

1. Go to [themoviedb.org](https://www.themoviedb.org/) and create a free account.
2. Open **Settings → API**.
3. Request an API key.
4. Copy your **API Key (v3 auth)**.
5. Paste it into WatchTracker settings.

TMDB is required for search, posters, metadata, and recommendations.

### 2. Optional: Get an OMDb API Key

1. Go to [omdbapi.com](https://www.omdbapi.com/).
2. Get an API key.
3. Paste it into WatchTracker settings.

OMDb is optional and is only used for IMDb ratings/votes and extra IMDb data.

### 3. Optional: MyAnimeList Sync

If you track anime on MyAnimeList, you can sync your library directly:

1. Go to [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig).
2. Create a new client.
3. Set **App Type** to `other`.
4. Set **App Redirect URI** to the exact URL displayed in WatchTracker settings.
5. Copy your **Client ID** into WatchTracker.
6. Log in from WatchTracker.

### 4. Install the Extension

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the WatchTracker folder.
5. Click the extension icon in your toolbar.

## Data Storage & Privacy

WatchTracker stores your data locally using `chrome.storage.local`.

Your library, diary, settings, API keys, and cached recommendation data stay in your browser. The extension only contacts external services when needed for features such as search, metadata, ratings, sync, or recommendations.

External services used:

- **TMDB** for search, posters, metadata, genres, languages, and discovery.
- **OMDb** for optional IMDb rating/vote data.
- **MyAnimeList** only if MAL sync is configured.

Use **Export/Import** in settings to create or restore JSON backups.

## Development Notes

Main files:

- `app.html` — main app shell.
- `app.js` — app navigation and page lifecycle.
- `popup.html`, `popup.js`, `popup.css` — popup UI.
- `store.js` — local storage/data helpers.
- `tmdb.js` — TMDB API helpers.
- `omdb.js` — optional OMDb API helpers.
- `recommendations.js` — recommendation engine.
- `ui-recommendations.js` — recommendations page UI.
- `ui-detail.js` — movie/show detail UI.
- `styles.css` — main app styles.

## Notes

- TMDB and IMDb ratings are public ratings, not your personal ratings.
- Your personal rating is used separately when building taste-based recommendations.
- Very narrow filters may produce fewer results, especially for TV shows or less common language/genre combinations.
- Regional-language recommendations intentionally use more flexible vote logic than global recommendations.
