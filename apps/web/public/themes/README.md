# Theme background images

Each theme renders one of these images full-screen behind the glass UI. The accent
palette for each theme (defined in `src/index.css` under `[data-theme="…"]`) is colour-
matched to its image.

Drop the photos here with **exactly** these filenames (any landscape image works,
≈1600×900 or larger recommended):

| File           | Theme    | Palette                       |
|----------------|----------|-------------------------------|
| `glacier.jpg`  | Glacier  | blue · indigo · cyan          |
| `emerald.jpg`  | Emerald  | green · gold · lime           |
| `carnival.jpg` | Carnival | orange · red · yellow         |
| `onyx.jpg`     | Amethyst | violet · indigo · fuchsia     |
| `crimson.jpg`  | Crimson  | red · orange · amber          |

Until an image is added, the theme falls back to a colour-matched CSS gradient, so the
app always looks themed. `.png`/`.webp` also work — update the `--bg-image` URL in
`src/index.css` if you change the extension.
