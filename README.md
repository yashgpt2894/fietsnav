# 🚲 FietsNav

**A scenic bike-route planner for the Netherlands.** FietsNav finds the *greenest, most
pleasant* way to cycle between two points — along real cycle paths and through parks, forests
and waterside trails — then hands the route to **OsmAnd** for voice-guided turn-by-turn
navigation. It's a single static web app that installs to your phone like a native app.

![type: PWA](https://img.shields.io/badge/type-PWA-0e7c5a) ![stack: vanilla JS + Leaflet](https://img.shields.io/badge/stack-vanilla%20JS%20%2B%20Leaflet-1971c2) ![build: none](https://img.shields.io/badge/build-none-2f9e44) ![license: MIT](https://img.shields.io/badge/license-MIT-7048e8)

> Most cycling apps optimise for *speed*. FietsNav optimises for the *ride*: it deliberately
> trades a little distance for cycle paths, parks and quiet streets — and shows you exactly how
> much green each option buys you.

---

## Table of contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [Requirements & dependencies](#requirements--dependencies)
- [Project structure](#project-structure)
- [Developing](#developing)
- [Privacy](#privacy)
- [Credits & data](#credits--data)
- [License](#license)

---

## What it does

### Planning
- **Scenic-first routing.** Every route maximises dedicated cycle paths and tracks through
  parks, forest and along the water (typically half or more on car-free cycleways), only
  dropping onto quiet country roads where no path exists.
- **Three green tiers, ranked by real greenery.** For each trip you get up to three options —
  **🍃 Scenic / 🌿 More scenic / 🌳 Most scenic** — ranked by *measured green cover* (the share
  of the route that actually passes through parks/forest), not by guesswork. The balanced
  **More scenic** is selected by default, and each option shows its green % and distance.
- **Park discovery.** Routing engines are blind to urban parks, so FietsNav separately finds
  large green areas near your route from OpenStreetMap and dips the route through them when the
  detour is worth it.
- **Honest comparison.** Every route is compared against the *shortest* bike route so you can
  see exactly how much extra distance the scenery costs.
- **Elevation & surface profile** under every route — how much you climb and how much is paved.
- **Multi-stop trips** — add intermediate stops, drag any pin to fine-tune, or tap the map to
  drop a start/stop/destination.

### Navigation & sharing
- **Start in OsmAnd.** One tap opens your exact route in [OsmAnd](https://osmand.net) on its
  bike profile for turn-by-turn voice navigation. If OsmAnd isn't installed, you're sent to the
  App Store / Play Store. *(Why OsmAnd and not Google Maps? See [How it works](#how-it-works).)*
- **GPX export** to take the precise track to a bike computer, Strava, Komoot or OsmAnd.
- **Open in Google Maps** is intentionally **not** offered — Google can't follow a custom route
  (see below).

### Map & places
- **Four base maps** — CyclOSM (bike map), Light, Standard and Dark — with overlays for
  **cycle-route networks** and the **shortest-route comparison**.
- **Points of interest** you can toggle on: the Dutch node network (**knooppunten**), bike
  parking, **ferries (pontveren)** and train stations.
- **Search-as-you-type** biased to the Netherlands, with **recent searches** and one-tap
  **"use my location"** for the start.
- **Saved Home / Work and favourite routes**, stored privately in your browser.

### The app itself
- **Installable PWA** — add it to your home screen and it opens full-screen with no browser
  bars, plus **"Navigate home / Navigate to work"** long-press shortcuts.
- **Light / dark mode** that auto-follows your phone, with a matching dark map.
- **Offline app shell** — opens instantly and works offline for everything except live data
  (routing, search, tiles).
- **No account, no sign-up, no tracking.**

---

## How it works

FietsNav is a thin client over a few excellent free services; the "intelligence" is in how it
combines them.

**1. Candidate routes.** For each trip it asks the [BRouter](https://brouter.de) engine for
several candidates in parallel — a custom *scenic* profile (maximal greenery), a lighter
*hybrid* profile, and BRouter's own alternatives. The two custom profiles ship as `.brf` files
and are uploaded to BRouter on first use, then cached.

**2. Park dips.** BRouter doesn't know about urban parks, so FietsNav queries
[Overpass](https://overpass-api.de) for nearby green areas (`leisure=park`, `landuse=forest`,
`natural=wood`, …) and re-routes some candidates *through* them.

**3. Green-cover scoring.** Each candidate is scored by what fraction of its length actually
runs inside those green polygons (a point-in-polygon test along the route).

**4. Pick the tiers.** Candidates are placed on a *Pareto frontier* — a route that's longer
**and** less green than another is discarded — and the survivors become the Scenic → More
scenic → Most scenic ladder. A tier only appears if it's genuinely greener than the one below,
so you never get three near-identical "options".

**5. Navigation hand-off.** Turn-by-turn is delegated to OsmAnd via a deep link
(`https://osmand.net/map?...&profile=bicycle`) carrying ~28 waypoints sampled from the route,
which OsmAnd traces closely on its bike profile. **Google Maps deep links are capped at 3
waypoints and recompute their own path**, so they can't follow a custom scenic route — which is
why FietsNav uses OsmAnd. For pixel-perfect fidelity, the GPX export carries every point.

---

## Getting started

You don't need to build anything — FietsNav is plain static files.

### Run it locally (fastest)

```bash
git clone https://github.com/yashgpt2894/fietsnav.git
cd fietsnav
npm run dev          # serves http://localhost:8000
```

Open <http://localhost:8000>. `localhost` is a secure context, so geolocation ("my location")
works. `npm run dev` just runs a static file server (`npx http-server`) — see
[requirements](#requirements--dependencies).

> No Node? Any static server works, e.g. `python3 -m http.server 8000`, or just open the folder
> with a tool like VS Code Live Server.

### Put it on your phone

Live GPS needs **HTTPS** (a browser rule), so the app must be served over `https://`.

**Option A — Netlify Drop (no tools, ~2 min).** Open [Netlify Drop](https://app.netlify.com/drop)
and **drag the whole project folder onto it**. You instantly get a private `https://…netlify.app`
link. Open it on your phone, then:
- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ → **Install app** / **Add to Home Screen**

**Option B — GitHub Pages.** With GitHub Pro/Team, enable Pages for the repo
(Settings → Pages → *Deploy from branch*) and open `https://yashgpt2894.github.io/fietsnav/`.
*(On a free plan, Pages on a private repo publishes it publicly — prefer Netlify Drop.)*

### Build a native iOS / Android app (optional)

A [Capacitor](https://capacitorjs.com) project is wired up. With a Mac + Xcode (iOS) or Android
Studio (Android):

```bash
npm run cap:install   # installs Capacitor core + ios + android
npm run cap:add       # creates the native projects
npm run cap:sync      # copies the web app into them
npm run ios           # or: npm run android
```

Full steps and the required location permissions are in **[NATIVE.md](NATIVE.md)**.

---

## Requirements & dependencies

**The web app has no build step and zero bundled npm dependencies.** Leaflet is loaded from a
CDN; everything else is hand-written vanilla JS. So all you need to *run* it is a static file
server (or an HTTPS host).

### Tooling

| Need it for | Requirement |
|---|---|
| `npm run dev` / `npm test` | **Node.js 18+** (the dev server is `npx http-server`; tests use Node's built-in `vm`/`fs` — no packages to install) |
| Native iOS build | macOS + **Xcode** |
| Native Android build | **Android Studio** |
| Native (either) | Capacitor packages, installed on demand by `npm run cap:install` |

### Browser support

Any modern evergreen browser (Chrome, Edge, Firefox, Safari 15+). Geolocation requires a
**secure context** — `https://` or `localhost`.

### Runtime services

FietsNav calls these **free, public** services at runtime (an internet connection is needed for
routing, search and map tiles). No API keys are required.

| Service | Used for |
|---|---|
| [BRouter](https://brouter.de) | Bicycle route calculation |
| [Photon](https://photon.komoot.io) (Komoot) | Address search & reverse geocoding |
| [Overpass API](https://overpass-api.de) | Parks & points of interest from OpenStreetMap |
| CyclOSM · CARTO · OpenStreetMap | Base-map tiles |
| [waymarkedtrails](https://cycling.waymarkedtrails.org) | Cycle-route network overlay |
| [OsmAnd](https://osmand.net) | Turn-by-turn navigation (hand-off) |

> These are shared community services — please use them gently.

---

## Project structure

| File | Purpose |
|---|---|
| `index.html` | App shell, design system (light + dark) and layout |
| `app.js` | Map, search, scenic routing + green-cover tiers, park discovery, OsmAnd hand-off, elevation, POIs, saved places, theme, bottom sheet |
| `scenic.brf` | BRouter profile — maximal greenery (cycle paths/tracks through parks, forest & water) |
| `smart.brf` | BRouter profile — lighter "hybrid" green lean, used as the more-direct tier candidate |
| `sw.js` | Service worker — offline app shell + capped map-tile cache |
| `manifest.webmanifest` | PWA manifest (name, icons, shortcuts, colours) |
| `icon-192.png`, `icon-512.png` | Home-screen / install icons |
| `capacitor.config.json`, `NATIVE.md` | Native (iOS/Android) build config + instructions |
| `test/smoke.test.js` | Pure-logic smoke tests (geometry, turns, formatting, comparison) |
| `CLAUDE.md`, `HANDOVER.md` | Project context & handover notes |

---

## Developing

```bash
npm run dev      # static server at http://localhost:8000
npm test         # 25 pure-logic smoke tests (no browser or network needed)
npm run check    # syntax-checks app.js + sw.js, then runs the tests
```

**Test it like a phone:** open the app in Chrome, press **F12**, click the device-toolbar (📱)
or **Ctrl/⌘ + Shift + M**, and pick iPhone/Pixel. Geolocation can be faked from
*⋮ → More tools → Sensors → Location* to see the "my location" dot.

The smoke tests load `app.js` inside a mocked-browser sandbox and exercise the pure functions
(haversine, bearings, turn classification, distance/time formatting, the comparison card), so
they run fast with no browser or network. Keep module-level code sandbox-safe.

---

## Privacy

Everything runs in your browser. Your saved places, favourite routes, recent searches and
settings live in `localStorage` on your device — there is **no account, no server and no
analytics**. The only data leaving your device are the route/search/tile requests to the public
services listed above.

---

## Credits & data

Routing by **BRouter** · search by **Photon (Komoot)** · points by **Overpass API** · base maps
by **CyclOSM / CARTO / OpenStreetMap** · cycle-route overlay by **waymarkedtrails** ·
navigation hand-off to **OsmAnd**. Map data **© OpenStreetMap contributors**.

Built for personal use. Please respect each service's usage policy.

## License

[MIT](LICENSE)
