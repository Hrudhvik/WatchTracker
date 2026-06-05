# WatchTracker

WatchTracker is a Chrome extension for tracking movies, TV shows, anime, diary entries, rewatch progress, recommendations, and a watch-next Lineup.

## Highlights

- **Watchlist** for TMDB movies/TV and MAL anime.
- **Lineup** queue for what to watch next, with drag-and-drop reordering.
- **Diary** with cross-source duplicate prevention for manual entries, Letterboxd, imports, and MAL sync.
- **Background auto-sync** for Letterboxd and MAL using Chrome alarms.
- **Popup dashboard** with Watchlist, Lineup, Diary, Search, and Settings quick access.
- **New-tab dashboard** with Watchlist, Lineup, Diary, Recommendations, and Profile.
- **Separated TMDB and Anime/MAL search** in both popup and new-tab search.
- **Theme system** with the current presets:
  - Midnight (default)
  - OLED Black
  - Deep Ocean
  - Nord
  - Sakura Night
  - Matcha
  - Cloud
  - Latte
  - Custom
- **Unified icon and branding system** using a squircle WatchTracker logo with a play button and progress ring.

## Current branding

The app icon uses:

- Indigo squircle background
- White play triangle
- Circular progress ring
- Clean `WatchTracker` typography, with `Watch` using the active theme text color and `Tracker` using the active theme accent

## Setup

1. Download or clone this project.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the WatchTracker folder.
6. Open the extension settings and configure TMDB, Letterboxd, and MAL as needed.

## Sync behavior

Auto-sync runs from the extension background service worker using Chrome alarms. It can run even when the popup or dashboard tab is closed, subject to Chrome extension service-worker scheduling.

The popup settings only contain quick controls. Full account/API setup remains in the full settings page.

## Development notes

- Do not commit local API keys, exported watchlists, or generated ZIP packages.
- Keep UI icons in `icons/` so popup and dashboard use the same visual language.
- If a new theme is added, update the theme preset list in both `app.js`, `popup.js`, and `early-theme.js`.


## Theme palettes

The theme engine uses layered tokens (`bg0`, `bg1`, `bg2`, `bg3`, `bg4`, `accent`, `accentL`, `text0`, `text1`, `text2`, `text3`, `border`). Midnight is the default rich dark slate preset with purple accents.
