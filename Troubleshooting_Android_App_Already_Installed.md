# Troubleshooting: Android "App is Already Installed" (WebAPK / PWA)

If Chrome displays **"App is already installed"** or **"Could not open app"**, but the app cannot be found in Android's standard **Settings > Apps / App Management**, clearing Chrome's browser cache will not resolve the issue.

---

## Why Clearing Chrome Cache Doesn't Fix It

When you tap **Add to Home screen** or **Install app** in Android Chrome:
1. Chrome's WebAPK minting server automatically packages the Progressive Web App into a lightweight Android  package (e.g., ).
2. Android installs this package directly into  through Android's native .
3. **Chrome's browser cache only stores web data** (HTML, CSS, JavaScript, cookies). Clearing browser cache leaves the registered OS-level package intact inside Android.

---

## Why the App is Hidden in App Management

OEM Android skins (Samsung One UI, Xiaomi/HyperOS, Oppo/ColorOS, and Google Pixel) classify WebAPK companion wrappers as **helper or system packages**:
- By default, **Settings > Apps** only lists primary user apps with dedicated launcher intent filters.
- If a partial installation fails or a shortcut is deleted without removing the APK, the package remains registered in Android's internal database without showing up in the default app list.

---

## 3 Ways to Remove or Launch the Stuck App

### Method 1: Use Chrome's Hidden WebAPK Manager (Fastest & Easiest)
Chrome includes a built-in management interface that bypasses Android Settings entirely:
1. Open **Google Chrome** on your Android phone.
2. Type or paste  into the address bar and tap Enter.
3. You will see a complete list of every WebAPK installed on your device.
4. Locate **SetTimer** (or any old exercise timer app).
5. Tap the **Uninstall** button directly next to it.
6. Once removed, return to your live web link and tap **Install App**.

---

### Method 2: Toggle "Show System Apps" in Android Settings
To reveal the hidden package in Android's application manager:
1. Open phone **Settings** > **Apps** (or **App Management**).
2. Tap the filter/sort icon or the 3-dot menu () in the top right corner.
3. Turn on **"Show system apps"** (or **"Show all apps"**).
4. In the search bar at the top, type . If it does not appear under that name, type .
5. Tap the app entry > tap **Storage** > **Clear Data**.
6. Tap **Uninstall** at the bottom of the screen.

---

### Method 3: Search the App Drawer / Launcher Search
Often the app exists in the phone's app library even if omitted from the top-level Settings list:
1. Swipe up on your home screen to open the **App Drawer**.
2. Type  in the search bar at the top.
3. If the icon appears, press and hold it until the pop-up menu appears.
4. Tap **Uninstall** (the trash can icon).

---

## Bypass Solution: New WebAPK Package Identity (Version 4)

If you cannot find the old package or prefer not to dig through settings, the updated  package has been assigned a distinct WebAPK identity:
- **Manifest ID**: 
- **Start URL**: 
- **Cache Scope**: 

Because Chrome calculates the WebAPK package signature based on the manifest uid=1235(spark) gid=1235(spark) groups=1235(spark), updating your files forces Chrome to register a completely fresh Android app package that will install without conflict.
