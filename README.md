# 🚲 FietsNav — your personal bike-navigation app

A Google-Maps-style navigation app that routes along **real cycle paths, ferries and the
Dutch node network (knooppunten)** — not along car roads. It's a single static web app
(vanilla HTML/CSS/JS + Leaflet, no build step, no backend, no account), so it runs on your
phone and your computer instantly.

It does what `routeplanner.fietsersbond.nl` does, then hands the route to OsmAnd for turn-by-turn navigation.

## What it does

- **Scenic-first routing** via BRouter — every route maximises **dedicated cycle paths and tracks
  through parks, forest and along the water** (typically ~half or more on car-free cycleways), only
  dropping onto quiet country roads where no path exists
- **Park discovery** — BRouter is blind to urban parks (`leisure=park`), so the app also finds big
  green areas near your route from OpenStreetMap and **dips the route through them** when the detour
  is small. Routes are ranked by **measured green cover** into up to three tiers — **Scenic / More
  scenic / Most scenic** — defaulting to the balanced "More scenic"
- **Start in OsmAnd** — one tap opens the route straight in **OsmAnd** on its bike profile for
  turn-by-turn voice nav (a deep link carrying ~28 waypoints from our route, so OsmAnd traces it
  closely — Google Maps can't: its links cap at 3 waypoints); if OsmAnd isn't installed the link
  offers it. For a pixel-exact track, the **GPX export** button hands the full route to OsmAnd/Komoot
- **Elevation & surface profile** under every route (how much climb, how much is paved)
- **Distance comparison** vs. the *shortest* bike route (the more direct, Google-Maps-style ride)
- **Search-as-you-type** (Photon), biased to the Netherlands, with **recent searches**
- **Light / dark mode** (auto-follows your phone) with a matching dark map
- **GPX export** to share rides with your bike computer / Strava / Komoot
- **Cycling layers & points**: CyclOSM bike map, cycle-route networks, **knooppunten**, bike
  parking, **ferries (pontveren)**, train stations
- **Saved Home / Work + favourite routes** (stored privately in your browser)
- **Installable** to your home screen as a full-screen app (PWA), with an offline app shell

---

## 📱 Run it on your phone

The app needs **HTTPS** for live GPS (a browser security rule). Pick whichever path suits you —
the first one takes about two minutes and needs no tools.

### Option A — Install as a web app (easiest, recommended)

1. Get the app onto an HTTPS URL — **the quickest way is [Netlify Drop](https://app.netlify.com/drop)**:
   open that page and **drag this whole project folder onto it**. You instantly get a private
   `https://…netlify.app` link. (No account needed; you can claim/delete the site later.)
2. Open that link on your phone:
   - **iPhone (Safari):** Share button → **Add to Home Screen**
   - **Android (Chrome):** ⋮ menu → **Install app** / **Add to Home Screen**
3. Launch it from the home-screen icon — it opens **full-screen** with no browser bars.
   Long-press the icon for the **Navigate home / Navigate to work** shortcuts.

> Live GPS, routing, search and map tiles need a data connection; the cached app shell just
> lets it open offline and makes it fast to reopen.

### Option B — From this GitHub repo

```bash
git clone https://github.com/yashgpt2894/fietsnav.git
cd fietsnav
npm run dev          # serves http://localhost:8000 (localhost is a secure context → GPS works)
```

That runs it on your **computer**. To get it on your **phone** from the repo, either use
**Netlify Drop** (Option A, drag the folder) or, if you have **GitHub Pro/Team**, enable
**GitHub Pages** for this private repo (Settings → Pages → *Deploy from branch*) and open the
resulting `https://yashgpt2894.github.io/fietsnav/` link on your phone. *(On a free plan,
Pages for a private repo would make the published site public — use Netlify Drop instead.)*

### Option C — A real native iOS / Android app

A Capacitor project is already wired up. With a Mac + Xcode (iOS) or Android Studio (Android):

```bash
npm install
npm run cap:install   # Capacitor core + ios + android
npm run cap:add       # creates the native projects
npm run cap:sync
npm run ios           # or: npm run android
```

Full steps and the required location permissions are in **[NATIVE.md](NATIVE.md)**.

---

## Test it like a phone (on your computer)

1. Open the app in **Chrome** → press **F12** (⌥⌘I).
2. Click the **device-toolbar** (📱) or press **⌃⇧M / Ctrl+Shift+M**, pick **iPhone**/**Pixel**.

## Develop / test

```bash
npm run dev      # local server at http://localhost:8000
npm test         # 27 pure-logic smoke tests (no browser/network needed)
npm run check    # syntax check + tests
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell, design system (light + dark), layout |
| `app.js` | Map, search, scenic routing + green-cover tiers, OsmAnd hand-off, elevation, POIs, saved places, theme, bottom sheet |
| `scenic.brf` | BRouter routing profile — prefers cycle paths/tracks through parks, forest & water (uploaded to BRouter on first use, then cached) |
| `manifest.webmanifest` | Makes it installable (name, icons, shortcuts, colours) |
| `sw.js` | Service worker — offline app shell + capped map-tile cache |
| `capacitor.config.json` · `NATIVE.md` | Native (iOS/Android) build config + instructions |
| `icon-192.png`, `icon-512.png` | Home-screen icons |
| `CLAUDE.md` · `HANDOVER.md` | Project context & handover notes |

## Credits & data

Routing & scenic/shortest profiles **BRouter** · Search **Photon (Komoot)** ·
Points **Overpass API** · Maps **CyclOSM / CARTO / waymarkedtrails** ·
Map data **© OpenStreetMap contributors**. All free, public services — please use gently.
Built for personal use.
