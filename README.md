# 🚲 FietsNav

**A scenic bike-route planner for the Netherlands.** FietsNav finds the *greenest, most
pleasant* way to cycle between two points — along real cycle paths and through parks, forests
and waterside trails — then hands the route to **OsmAnd** for voice-guided turn-by-turn
navigation. It installs to your phone like a native app.

[![Live — fietsnav.netlify.app](https://img.shields.io/badge/live-fietsnav.netlify.app-0e7c5a)](https://fietsnav.netlify.app) ![type: PWA](https://img.shields.io/badge/type-PWA-1971c2) ![stack: vanilla JS + Leaflet](https://img.shields.io/badge/stack-vanilla%20JS%20%2B%20Leaflet-2f9e44) ![license: MIT](https://img.shields.io/badge/license-MIT-7048e8)

> Most cycling apps optimise for *speed*. FietsNav optimises for the *ride*: it deliberately
> trades a little distance for cycle paths, parks and quiet streets — and shows you exactly how
> much green each option buys you.

---

## 👉 Use it

**Open [fietsnav.netlify.app](https://fietsnav.netlify.app)** in your browser — that's it,
nothing to install to start planning.

For the best experience, **add it to your home screen** so it opens full-screen like a native
app (and gets quick shortcuts):

| Device | How to install |
|---|---|
| **iPhone / iPad (Safari)** | Open the link → tap **Share** → **Add to Home Screen** |
| **Android (Chrome)** | Open the link → **⋮** menu → **Install app** (or **Add to Home Screen**) |
| **Desktop (Chrome / Edge)** | Click the **install icon** in the address bar → **Install** |

Once installed, **long-press the app icon** for the **Navigate home** / **Navigate to work**
shortcuts. The site is served over HTTPS, so the **"use my location"** feature works.

> Planning, search and map tiles need a data connection; the app caches its shell so it opens
> instantly and works offline apart from live data.

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
  drop a start / stop / destination.

### Navigation & sharing
- **Start in OsmAnd.** One tap opens your exact route in [OsmAnd](https://osmand.net) on its
  bike profile for turn-by-turn voice navigation. If OsmAnd isn't installed, you're sent to the
  App Store / Play Store. *(Why OsmAnd and not Google Maps? See [How it works](#how-it-works).)*
- **GPX export** to take the precise track to a bike computer, Strava, Komoot or OsmAnd.

### Map & places
- **Four base maps** — CyclOSM (bike map), Light, Standard and Dark — with overlays for
  **cycle-route networks** and the **shortest-route comparison**.
- **Points of interest** you can toggle on: the Dutch node network (**knooppunten**), bike
  parking, **ferries (pontveren)** and train stations.
- **Search-as-you-type** biased to the Netherlands, with **recent searches** and one-tap
  **"use my location"** for the start.
- **Saved Home / Work and favourite routes**, stored privately in your browser.

### The app itself
- **Installable PWA** with home-screen shortcuts and an **offline app shell**.
- **Light / dark mode** that auto-follows your phone, with a matching dark map.
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
(`https://osmand.net/map?...&profile=bicycle`). OsmAnd re-routes between the points it's handed, so
FietsNav samples one waypoint at the *mid-point of each stretch between turns* — off the junctions,
on the exact path it wants ridden — which pins the scenic route closely with the fewest points
(more points cause more re-routing wobble, not less). **Google Maps deep links are capped at 3
waypoints and recompute their own path**, so they can't follow a custom scenic route — which is
why FietsNav uses OsmAnd. For pixel-perfect fidelity, the GPX export carries every point.

---

## Tech & dependencies

FietsNav is a **single static web app** — vanilla HTML/CSS/JS with [Leaflet](https://leafletjs.com)
for the map. **No build step and no bundled npm dependencies**; Leaflet is loaded from a CDN.
It runs in any modern evergreen browser (Chrome, Edge, Firefox, Safari 15+); geolocation needs a
secure context (`https://`), which the live site provides.

At runtime it calls these **free, public** services (no API keys required):

| Service | Used for |
|---|---|
| [BRouter](https://brouter.de) | Bicycle route calculation |
| [Photon](https://photon.komoot.io) (Komoot) | Address search & reverse geocoding |
| [Overpass API](https://overpass-api.de) | Parks & points of interest from OpenStreetMap |
| CyclOSM · CARTO · OpenStreetMap | Base-map tiles |
| [waymarkedtrails](https://cycling.waymarkedtrails.org) | Cycle-route network overlay |
| [OsmAnd](https://osmand.net) | Turn-by-turn navigation (hand-off) |

A [Capacitor](https://capacitorjs.com) setup for packaging native iOS/Android builds is included
— see **[NATIVE.md](NATIVE.md)**.

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
