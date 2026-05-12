# WatchTracker — Browser Extension

Track movies, TV shows, and series you're watching. Like MyAnimeList, but for everything.

## Features

- **Search** movies & TV shows powered by TMDB (The Movie Database)
- **Track status**: Watching, Plan to Watch, Completed, On Hold, Dropped
- **Episode progress** tracking for TV series
- **Rate** titles on a 1–10 scale
- **Filter** by status and type (movie vs TV)
- **Notes** field for each entry
- **Export/Import** your watchlist as JSON backup

## Setup

### 1. Get a TMDB API Key (free)

1. Go to [themoviedb.org](https://www.themoviedb.org/) and create a free account
2. Go to **Settings → API** (https://www.themoviedb.org/settings/api)
3. Request an API key (choose "Developer" → fill in the form)
4. Copy your **API Key (v3 auth)**

### 2. MyAnimeList Sync (Optional)

If you track Anime on MyAnimeList, you can sync your library directly:
1. Go to [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig)
2. Create a new Client. Set **App Type** to `other`.
3. Set **App Redirect URI** to the exact URL displayed in WatchTracker's settings.
4. Copy your **Client ID** into WatchTracker and log in!

### 3. Install the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `watchtracker` folder
5. Click the extension icon in your toolbar

### 4. Enter Your API Key

1. Click the ⚙ gear icon in the extension
2. Paste your TMDB API key
3. Click **Save Key**

You're all set! Start searching and tracking.

## How TMDB Keeps You Updated

TMDB is community-maintained with 900k+ movies and 160k+ TV shows. It updates continuously with:

- New episode air dates and season info
- Upcoming movies and release dates
- Ratings, cast, genres, and overviews

When you search, you always get the latest data from TMDB's servers.

## Data Storage & Backups

All your watchlist data is stored locally in your browser using `chrome.storage.local`. Nothing is sent to any server besides TMDB search queries.

You can use the **Export/Import** buttons in settings for one-off JSON backups.
