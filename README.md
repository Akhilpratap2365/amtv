<div align="center">

<img src="docs/icon.png" width="120" alt="Apple Music icon">

# Apple Music — Full-Screen Web Player for Android TV, Google TV & Phones

**Runs the official Apple Music web player (`music.apple.com`) in full screen with AMTV's ultra-smooth WebView engine, a Circular Liquid Glass cursor with click ripple, and a Guaranteed 1600px Desktop Viewport & Lyrics Button lock.**

</div>

## Highlights

- **Direct Full-Screen Apple Music Website**: Opens `music.apple.com` directly in full screen with zero extra custom overlay UI, keeping all native Apple Music web features working seamlessly.
- **Guaranteed 1600px Desktop Width & Lyrics Button**: Locked via `applyGuaranteed1600pxViewport` on layout changes and page load across phones, 1080p TVs, and 4K TVs so the full desktop interface and the **Lyrics** button are always visible.
- **Circular Liquid Glass Cursor with Ripple Effect**: Smooth hardware-accelerated circular liquid glass pointer in its own dedicated window layer (so moving the cursor never triggers WebView repaints), complete with a multi-wave liquid ripple animation and tactile droplet bounce on click.
- **Ultra-Smooth TV Performance**:
  - **Dedicated Cursor Layer**: Pointer rendering runs in a separate hardware-accelerated `TYPE_APPLICATION_PANEL` overlay window with throttled hover dispatch (`10 Hz`).
  - **WebGL Backdrop Limiter**: Allows the Now Playing / Lyrics WebGL background mesh to animate during track transitions and interactions, then freezes background frames so idle CPU stays near 0%.
  - **Animated Cover Video Filter**: Blocks heavy background HLS motion artwork streams (`mvod.itunes.apple.com`) while preserving all crisp static `.webp` and `.jpg` artwork (`mzstatic.com`).
  - **Smart Accessibility Tree**: Only builds Chromium's DOM accessibility tree if a spoken/braille screen reader is active, avoiding button-remapper overhead on Android TV.
  - **Automatic Country Storefront Sync & Widevine Pre-Warm**: Automatically aligns the web storefront with your signed-in Apple ID country and pre-warms Widevine DRM for fast playback start.

## Getting the APK on GitHub (Actions Tab)

This repository includes a pre-configured GitHub Actions workflow (`.github/workflows/build.yml`):

1. Upload or push this repository to your GitHub account.
2. Open the **Actions** tab in your GitHub repository.
3. Select the latest **Build Apple Music APK** workflow run (or click **Run workflow**).
4. Scroll down to **Artifacts** and download **`Apple-Music-APK`** (which contains `Apple-Music.apk`).

## Local Build

If you have the Android SDK and JDK 17 installed locally:

```bash
make
```

The signed APK is output to `build/Apple-Music.apk`.
