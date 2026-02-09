Communicative Objects repo for hosting multiple interactive projects via GitHub Pages.

Live site: `https://kalharbi11.github.io/Communicative-Objects/`

**Structure**
- `index.html` is the homepage/menu in the repo root.
- Each project lives in its own folder with its own `index.html`.
- `noise-map/` is one project folder. Example URL: `https://kalharbi11.github.io/Communicative-Objects/noise-map/`
- `.nojekyll` disables the GitHub Pages build step so files are served as-is.

**Troubleshooting Pages**
- Confirm GitHub Pages is set to `main` and `/(root)`.
- Make sure `index.html` exists at the repo root.
- Keep `.nojekyll` at the repo root to avoid Pages build failures.
- If the homepage shows old content, force a rebuild by committing a tiny change to `index.html`.
