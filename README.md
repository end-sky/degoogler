# FOSS Device Finder

A lightweight, static HTML/CSS/JavaScript checker for devices found in the locally supplied HTML snapshots for LineageOS, GrapheneOS, CalyxOS, and /e/OS. It uses `DOMParser` to read the HTML as data; scripts in those downloaded pages are never executed.

## Run locally

Browsers generally block `fetch()` when an HTML page is opened directly as `file://`. From this folder, run:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Updating the source snapshots

Replace the corresponding HTML file(s) inside `static/`. The checker fetches the files without using its HTTP cache on page load, so updated contents in existing files are read automatically.

If you **add or remove** source HTML files:

- With `python3 -m http.server`, the checker reads the `static/` directory listing and discovers new `.html` files automatically.
- On static hosts that do not expose directory listings (such as many static-site hosts), regenerate the manifest by running `python3 update-manifest.py`, then deploy `static/sources.json` alongside the new files.

The parser recognizes the four supplied source formats. An unfamiliar extra HTML file gets a best-effort generic table parser; for a new OS, add a dedicated parser in `find.js` to provide accurate names, metadata, and installation links.

## Data and limitations

- This project searches only the files in `static/`; it does not query device APIs or send search terms to a server.
- A match means the supplied snapshot lists the device. Snapshots can be old, incomplete, or change format, so always check the OS maintainer's current official documentation.
- LineageOS discontinued entries are excluded. CalyxOS entries under “No longer supported” and marked legacy `/e/OS` entries are shown as historical rather than current support.
- Community and unofficial builds can differ greatly in stability and security. See [`risks.html`](risks.html) before considering an unsupported port.

## Files

- `index.html` — checker interface
- `styles.css` — responsive styling and dark/light themes
- `find.js` — source discovery, parsing, matching, and result rendering
- `risks.html` — risks and primary-source links
- `static/` — user-provided HTML snapshots and a source manifest
