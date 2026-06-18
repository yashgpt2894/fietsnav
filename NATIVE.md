# FietsNav → phone app

Two ways to get FietsNav onto your phone. Both use the **same** web app — no rewrite.

---

## Option 1 — Install as a PWA (works today, 0 build tools)

This is the fastest path and is plenty for personal use. The app runs **full-screen**, offline-capable (app shell + recently-seen tiles are cached), with the bike icon on your home screen.

1. Put the files on any HTTPS URL (geolocation + service worker need a secure context):
   - Drag the project folder onto **[Netlify Drop](https://app.netlify.com/drop)**, or
   - Push to a repo and enable **GitHub Pages**, or
   - Any static host. (Locally, `npm run dev` → `http://localhost:8000` also counts as secure.)
2. Open that URL on your phone:
   - **iOS Safari:** Share → *Add to Home Screen*.
   - **Android Chrome:** ⋮ menu → *Install app* / *Add to Home Screen*.
3. Launch from the home-screen icon. It opens full-screen, no browser chrome.
   Long-press the icon for the **Navigate home / Navigate to work** shortcuts.

> Live GPS, routing, search and map tiles still need a data connection; the cached
> shell just lets the app *open* offline and makes revisits fast.

---

## Option 2 — Capacitor native app (real iOS / Android binary)

Capacitor wraps the web app in a native shell. You need a **Mac + Xcode** for iOS and
**Android Studio (+ JDK)** for Android. `capacitor.config.json` is already committed, so
there is no interactive setup.

```bash
npm install                 # project deps
npm run cap:install         # @capacitor/core, cli, ios, android
npm run native:prep         # copy the web files into www/  (Capacitor's webDir)
npm run cap:add             # create the ios/ and android/ native projects
npm run cap:sync            # copy web assets + sync native deps

# run on a simulator / emulator
npm run ios                 # → pick a Simulator
npm run android             # → pick an emulator
# …or open the native IDEs:
npx cap open ios
npx cap open android
```

After any change to the web app, re-sync: `npm run cap:sync`.

### Required permissions (add once, after `cap:add`)

Live GPS keeps working inside the WebView once these are set.

**iOS** — `ios/App/App/Info.plist`, inside the top-level `<dict>`:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>FietsNav uses your location to show where you are and give turn-by-turn cycling directions.</string>
```
For navigation with the screen off, also add `NSLocationAlwaysAndWhenInUseUsageDescription`
and enable the *Location updates* background mode in the target's *Signing & Capabilities*.

**Android** — `android/app/src/main/AndroidManifest.xml`, inside `<manifest>`:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

Optional: `npm i @capacitor/geolocation` for nicer native permission prompts.

### Notes
- The service worker isn't needed inside Capacitor (assets are already local) but is harmless.
- All API/tile calls are HTTPS, so there's no mixed-content issue in the WebView.
- `keepAwake` (Settings → "Keep screen on while navigating") uses the Web Wake Lock API,
  which works in the WebView; for true screen-off background nav, add a Capacitor background
  geolocation plugin.

### Publishing (optional)
- **iOS** — Xcode → set signing team → *Product → Archive* → upload to App Store Connect (needs an Apple Developer account).
- **Android** — Android Studio → *Build → Generate Signed Bundle (AAB)* → Play Console.
