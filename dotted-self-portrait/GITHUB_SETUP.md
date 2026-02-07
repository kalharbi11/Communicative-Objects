# GitHub Setup Guide

Follow these steps to add this project to your Communicative-Objects repository.

## Step 1: Navigate to Your Repo

```bash
cd path/to/Communicative-Objects
```

## Step 2: Create the Project Folder

```bash
mkdir "dotted-self-portrait"
```

## Step 3: Copy Files

Copy all files from your current `self-portrait` folder into the new `dotted-self-portrait` folder in your repo:

```bash
# Copy all project files
cp -r /path/to/current/self-portrait/* dotted-self-portrait/
```

**Files to include:**
- `README.md`
- `.gitignore`
- `editor.html`
- `viewer.html`
- `index.html`
- `sketch-editor.js`
- `sketch.js`
- `style.css`
- `assets/README.md` (instructions for users)

**Files to EXCLUDE (already in .gitignore):**
- `assets/portrait.png` (your personal image)
- `tmpclaude-*` files
- `p5.js` (using CDN instead)

## Step 4: Add Example Screenshot (Optional)

Take a screenshot of your rendered portrait and save it as `example.png` in the project root. This will show in the README.

## Step 5: Git Commands

```bash
# Add the new folder
git add dotted-self-portrait/

# Commit
git commit -m "Add dotted self portrait project

- Interactive p5.js portrait generator
- Based on Generated-p5js-Portraits by stihilus
- Added two-phase rendering and interactive controls
- Performance optimized for web deployment"

# Push to GitHub
git push origin main
```

## Step 6: Verify on GitHub

1. Go to: https://github.com/kalharbi11/Communicative-Objects
2. Navigate to `dotted-self-portrait` folder
3. Check that README displays correctly
4. Verify example image shows if you added one

## Optional: GitHub Pages

If you want to host it live on GitHub Pages:

1. Go to repository Settings > Pages
2. Select branch: `main`
3. Select folder: `/ (root)` or `/dotted-self-portrait` if supported
4. Your project will be live at:
   `https://kalharbi11.github.io/Communicative-Objects/dotted-self-portrait/editor.html`

## File Structure in Repo

```
Communicative-Objects/
├── ... (your other projects)
└── dotted-self-portrait/
    ├── assets/
    │   └── README.md
    ├── .gitignore
    ├── README.md
    ├── editor.html
    ├── viewer.html
    ├── index.html
    ├── sketch-editor.js
    ├── sketch.js
    └── style.css
```

## Troubleshooting

**Git not recognizing files:**
- Make sure you're in the repo root directory
- Check `.gitignore` isn't excluding needed files

**Large file errors:**
- The .gitignore should prevent `portrait.png` from being committed
- Make sure `p5.js` isn't being committed (using CDN instead)

**README not rendering:**
- Ensure it's named exactly `README.md`
- Check markdown syntax is valid
