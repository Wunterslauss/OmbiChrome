# OmbiChrome

A Chrome/Brave extension that lets you search for movies and TV shows and request them on your [Ombi](https://ombi.io/) instance — right from your browser toolbar.

Browse any movie or show page on popular sites and add it to Ombi with one click.

## Features

- **Search** for movies and TV shows directly from the popup using your Ombi instance (powered by TMDB)
- **Detect** the movie or show you're currently browsing and request it instantly
- **Auto-check** whether a title is already requested, approved, or available
- **Filter** results by Movies or TV Shows
- **Dark theme** UI inspired by Ombi's design

## Supported Sites

OmbiChrome detects movies and TV shows on the following sites:

| Site | Movies | TV Shows |
|------|--------|----------|
| [IMDB](https://www.imdb.com) | ✓ | ✓ |
| [TMDB](https://www.themoviedb.org) | ✓ | ✓ |
| [Rotten Tomatoes](https://www.rottentomatoes.com) | ✓ | ✓ |
| [Letterboxd](https://letterboxd.com) | ✓ | — |
| [Trakt](https://trakt.tv) | ✓ | ✓ |
| [JustWatch](https://www.justwatch.com) | ✓ | ✓ |
| [Metacritic](https://www.metacritic.com) | ✓ | ✓ |
| [YIFY/YTS](https://yts.mx) | ✓ | — |
| [1337x](https://www.1337x.to) | ✓ | — |

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `OmbiChrome` folder
5. Click the extension icon and go to **Settings**

## Setup

You'll need to configure two things in the extension settings:

| Setting | Required | Where to find it |
|---------|----------|------------------|
| **Ombi Server URL** | Yes | Your Ombi instance URL (e.g. `https://ombi.example.com`) |
| **Ombi API Key** | Yes | Ombi → Settings → Ombi → API Key |
| **OMDb API Key** | No | [omdbapi.com](https://www.omdbapi.com/apikey.aspx) — enables additional IMDB search results |

Use the **Test Connection** button to verify your setup.

## Usage

### Popup Search
1. Click the OmbiChrome icon in your toolbar
2. Type a movie or show name and press Enter
3. Browse results and click **Request** to add to Ombi

### Page Detection
1. Browse to any movie or show page on a supported site
2. Click the OmbiChrome icon
3. The detected title appears at the top with its Ombi status
4. Click **Add to Ombi** if it hasn't been requested yet

## Screenshots

*Coming soon*

## Tech Stack

- Manifest V3
- Chrome Storage API for settings
- Ombi API v1 for search and requests
- No external dependencies

## License

MIT
