# SetTimer — Modular Exercise Interval Timer

**SetTimer** is a browser-based interval timer web application built with compartmentalized HTML, CSS, and JavaScript modules, ready to be hosted directly on **GitHub Pages**.

## File & Module Architecture

All code is compartmentalized into separate files by module:

- `index.html` — Application shell containing Edit Mode and the full-screen Run Mode view.
- `styles.css` — Visual styling module including responsive layout, drag-and-drop indicators, and full-screen timer state colors.
- `storage.js` — LocalStorage persistence module (`SetTimerStorage`) that stores routines locally and auto-loads them on page open.
- `dragdrop.js` — Drag-and-drop exercise reordering module (`SetTimerDragDrop`) with HTML5 drag events and accessible Up/Down controls.
- `excel.js` — Excel backup and restore module (`SetTimerExcel`) powered by SheetJS (`xlsx`) for exporting routines to `.xlsx` and restoring backups on the page.
- `timer.js` — Interval timer state machine and Web Audio sound cue module (`SetTimerEngine`).
- `app.js` — Main application controller connecting Edit Mode, Run Mode, and user interactions.

## Run-Down Visual States

| State | Screen Color | On-Screen Information |
| :--- | :--- | :--- |
| **Activity Active** | **Bright Green** (`#00C853`) | Activity name, current Set (`Set X of Y`), and countdown timer |
| **Rest Between Sets** | **Bright Orange** (`#FF6D00`) | `REST` status, next set details, and countdown timer |
| **Between Activities** | **Yellow** (`#FFD600`) | Countdown timer and prominent `UP NEXT: [Next Activity]` banner |
| **Paused** | **Grey** (`#52525B`) | Preserves active status and countdown timer with prominent `PAUSED` badge; returns to state color on Resume |
| **Routine Complete** | **Bright Red** (`#D50000`) | Displays `END` on a bright red full-screen backdrop |

## Deploying to GitHub Pages

1. Commit and push all files (`index.html`, `styles.css`, `storage.js`, `dragdrop.js`, `excel.js`, `timer.js`, `app.js`, `README.md`) to your GitHub repository.
2. In your repository on GitHub, navigate to **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, choose your branch (`main` / `root`), and click **Save**.
