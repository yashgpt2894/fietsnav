# FietsNav — Handover for Claude Code

A personal, Google-Maps-style **bike navigation app** for the Netherlands. It routes along
**real cycle paths, ferries and the knooppunten node network** (what `routeplanner.fietsersbond.nl`
shows) — not car roads — and adds live turn-by-turn navigation with voice.

**Status:** v2 — map-first redesign + dark mode, elevation/surface profile, GPX export, screen
wake-lock, recent searches, request cancellation + capped tile cache. Verified: `npm test` → 27
smoke tests passing, no known bugs. Mobile = floating search bar + draggable bottom sheet; desktop
= left rail. Native build is wired up (Capacitor) — see `NATIVE.md`.
Stack is intentionally simple: vanilla HTML/CSS/JS + Leaflet, **no build step, no backend**.

---

## 1. Where everything lives

Project root (open this folder in Claude Code):

```
bike app/
├─ index.html              App shell: layout + all CSS (design tokens in :root)
├─ app.js                  All logic: map, search, routing, turn-by-turn, POIs, saved places
├─ manifest.webmanifest    PWA manifest (name, icons, theme)
├─ sw.js                   Service worker — caches the app shell for offline open
├─ icon-192.png / 512.png  Home-screen icons (green bike)
├─ package.json            npm scripts: dev / test / cap:* (Capacitor)
├─ test/smoke.test.js      Pure-logic unit tests (no browser/network needed)
├─ CLAUDE.md               Always-on context for Claude Code (conventions, gotchas, UI rules)
├─ HANDOVER.md             This file
└─ README.md               End-user readme
```

> On disk this folder is `~/Documents/Claude/Projects/bike app/`. There's no hidden state
> elsewhere — everything the app needs is in this folder.

---

## 2. Run it

| Goal | Command / action |
|------|------------------|
| Open quickly (no GPS) | double-click `index.html` |
| Proper dev server (GPS works) | `npm run dev` → http://localhost:8000 |
| Run the tests | `npm test` |

`localhost` counts as a secure context, so geolocation and the service worker work there;
a bare `file://` open will load the map and route fine but won't do live GPS.

---

## 3. Test on a phone simulator

**Fastest — Chrome DevTools device mode:** open the app in Chrome → `F12` → click the device
toolbar (📱) or `Ctrl/Cmd+Shift+M` → pick iPhone/Pixel. *More tools → Sensors → Location* feeds
a fake GPS position so you can watch navigation run.

**iOS Simulator (Mac + Xcode):**
1. `npm run dev`
2. Open the **Simulator** app (`xcrun simctl boot "iPhone 15"` or via Xcode) → launch Safari
3. Go to `http://localhost:8000` (the Simulator shares the Mac's localhost)
4. *Features → Location* in the Simulator menu sets a fake position.

**Android Emulator (Android Studio):**
1. `npm run dev`
2. Start an emulator, open Chrome on it
3. Go to `http://10.0.2.2:8000` (`10.0.2.2` = the host machine from inside the emulator)
4. Set a mock location from the emulator's *⋯ → Location* panel.

---

## 4. Make it an actual phone app

Three paths, easiest → most capable. **Capacitor (Option A) is the recommended one** for a real,
publishable native app.

### Option A — Capacitor 8 (real native iOS + Android app)

Capacitor drops a native shell around the existing web app — no rewrite. Requires a **Mac + Xcode**
for iOS and **Android Studio** for Android.

```bash
# one-time setup
npm install
npm run native:prep        # copies the 6 web files into www/ (Capacitor's webDir)
npm run cap:init           # installs Capacitor, inits app id nl.fietsnav.app, webDir=www
npm run cap:add            # adds the ios/ and android/ native projects

# run on a simulator / emulator
npm run cap:sync           # re-copies web assets after any change
npm run ios                # npx cap run ios     → choose a Simulator
npm run android            # npx cap run android → choose an emulator
# or open the native IDEs directly:
npx cap open ios           # Xcode
npx cap open android       # Android Studio
```

**Permissions to add** (so live GPS works in the native shell — `navigator.geolocation` keeps
working inside the WebView once these are set):
- iOS — `ios/App/App/Info.plist`: add `NSLocationWhenInUseUsageDescription` with a short reason
  string (and `NSLocationAlwaysAndWhenInUseUsageDescription` + a Location background mode if you
  later want navigation with the screen off).
- Android — `android/app/src/main/AndroidManifest.xml`: add `ACCESS_FINE_LOCATION` and
  `ACCESS_COARSE_LOCATION`.
- Optional: install `@capacitor/geolocation` for nicer native permission prompts.

Notes: the service worker isn't needed inside Capacitor (assets are already local) but is
harmless. All API/tile calls are HTTPS, so there's no mixed-content issue in the WebView.

**Publish:**
- iOS — in Xcode set your signing team → *Product → Archive* → upload to App Store Connect.
  Needs an Apple Developer account (annual fee).
- Android — in Android Studio *Build → Generate Signed Bundle (AAB)* → upload to Play Console.
  Needs a Play Console account (one-time fee).

### Option B — PWABuilder (fastest route into the stores)

Deploy the app to a public HTTPS URL first (Netlify Drop / GitHub Pages), then go to
**pwabuilder.com**, enter the URL, and *Package for stores*.
- **Android** is generated as a Trusted Web Activity (needs a Lighthouse PWA score ≥ 80 and a
  Digital Asset Links file to verify domain ownership) — this works well.
- **iOS** is a WebView wrapper and can hit Apple's "Guideline 4.2 / minimum functionality"
  rejection; Capacitor (Option A) is the more reliable iOS path.

### Option C — PWA install (zero effort, no store, works today)

Deploy to HTTPS and open on the phone → **Add to Home Screen**. It launches full-screen with the
bike icon and opens offline (tiles/routing still need data). Good enough for personal use.

---

## 5. How the app works (architecture)

`app.js` is organised top-to-bottom into commented sections:

1. **Config + helpers** — endpoints, `haversine`, `bearing`, distance/time formatting.
2. **Map** — Leaflet map, base layers (CyclOSM/light/OSM), overlay (cycle routes), panes.
3. **Geocoding** — Photon type-ahead (`geocode`/`reverseGeocode`) + autocomplete UI (`wireField`).
4. **Points** — from/to/via state, draggable pins, tap-the-map to set points.
5. **Routing** — `brouterRoute` (GeoJSON) → `parseRoute`; `shortestBikeRoute` for the comparison.
6. **Turn computation** — `rdpKeep` (Ramer–Douglas–Peucker corner detection) → `buildTurns` →
   `classifyTurn`; street names best-effort from BRouter `messages` (`namesFromMessages`).
7. **Results panel** — summary, route alternatives, **shortest-bike-route comparison card**, turn list.
8. **Navigation** — GPS follow, voice (`speak`), snap-to-route (`snapToRoute`), off-route reroute.
9. **POIs** — Overpass queries for knooppunten / parking / ferries / stations (zoom-gated).
10. **Saved places & routes** — Home/Work + favourites in `localStorage`.
11. **UI wiring + init**.

**Deliberate decisions** (see CLAUDE.md): turn directions come from geometry (robust, not from
BRouter's voicehint encoding); the comparison baseline is the *shortest bike route*, not a car
route; parsing is defensive everywhere so a missing field degrades gracefully.

---

## 6. UI principles — "always make the best UI"

The app already has a consistent design language; keep extending it rather than reinventing.

- **Mobile-first, responsive.** Breakpoint at **760px**. Phone: floating top search bar + a
  bottom sheet for results. Desktop: a 380px left rail with a full-bleed map. Verify both on
  every change.
- **Use the design tokens** in `index.html` `:root`: accent green `#0e7c5a`; route-style colours
  fast `#e8590c`, quiet `#1971c2`, shortest `#7048e8`. No one-off colours.
- **Flat and calm**: white surfaces, 1px hairline borders, soft shadows only to lift the active
  panel/sheet. Sentence case everywhere. Touch targets ≥ 44px.
- **Look before you ship.** After a UI change, capture device-emulated screenshots at a phone
  width (~390px) and desktop, and review them. If the Claude-in-Chrome extension is connected,
  drive `npm run dev` → navigate → resize to mobile → screenshot as a tight feedback loop.
- **Don't block the map.** Panels/sheets overlay; the map stays pannable. Keep motion subtle.
- Accessibility: label icon-only buttons, keep contrast strong on the green accent, support
  keyboard nav in the search box (already wired).

---

## 7. Suggested next steps / roadmap

Done in v2: ✅ elevation & surface profile · ✅ GPX export · ✅ auto/manual dark mode (+ dark map) ·
✅ recent searches · ✅ screen wake-lock during nav · ✅ Capacitor native scaffold (`NATIVE.md`).

Still open:
- **GPX import** (export is done) — load a `.gpx` and route/preview it.
- **Draggable route** (drag the line to insert a via, like Google Maps).
- **Better knooppunten routing**: let users enter a sequence of node numbers and route node→node.
- **Background navigation** on native (Capacitor background geolocation) so the screen can sleep.
  (Wake-lock keeps the screen awake while the app is foregrounded; true screen-off needs a plugin.)
- **Localisation**: Dutch UI + Dutch voice prompts (`speechSynthesis` lang `nl-NL`).
- Replace the public demo servers with your own BRouter/Photon/Overpass instances if usage grows
  (the public ones are rate-limited and meant for light use).

---

## 8. Verification checklist (run before calling any change done)

- [ ] `npm test` is green (currently 27/27).
- [ ] `node --check app.js` passes (no syntax errors).
- [ ] Plan a real NL route (e.g. *Amsterdam Centraal → Utrecht Centraal*): route draws, summary
      shows distance/time/ascent, comparison card shows "vs. shortest bike route".
- [ ] Switch route styles (Recommended/Fast/Quiet/Shortest) — route updates; picking *Shortest*
      shows the "you're already on the shortest" notice.
- [ ] Toggle POIs at zoom ≥ 12 — knooppunten/parking/ferries/stations appear.
- [ ] Start navigation with a mock GPS location — banner + voice fire, ETA counts down.
- [ ] Phone (≤760px) and desktop layouts both look right.

---

## 9. Credits & limits

Routing & shortest-route comparison **BRouter** · search **Photon (Komoot)** · points
**Overpass API** · maps **CyclOSM / CARTO / waymarkedtrails** · data **© OpenStreetMap
contributors**. All free public services — use gently; for heavier or commercial use, self-host.
Built for personal use.
