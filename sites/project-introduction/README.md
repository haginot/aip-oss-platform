# AIP-OSS Platform — Your business semantics. Your rules.

A bilingual editorial Site, fully rewritten from the project discussion on October 13, 2026. It distinguishes the target architecture, the bounded reference implementation, and dated verification records.

## Edit and build

Edit `content/ja.md` and `content/en.md`. Styles, source diagrams, and selected design references also live in `content/`. All build inputs are included in this checkout; no parent repository or external package is required for the default build.

```sh
node build.mjs
node check.mjs
node preview.mjs
```

The preview serves `http://127.0.0.1:4179/` and `/ja.html`. The build produces English `dist/index.html`, Japanese `dist/ja.html`, Markdown downloads, bilingual SVG maps, and reference files.

For GitHub Pages, run `node build.mjs --github-pages` from this directory, then `node check.mjs`. Commit both the source and generated files under the repository's `docs/` directory. GitHub Pages publishes the `main` branch's `/docs` folder at <https://haginot.github.io/aip-oss-platform/>; the Japanese edition is <https://haginot.github.io/aip-oss-platform/ja.html>. The build preserves unrelated documentation already in `docs/`.

`content/reference/IMPLEMENTATION_SNAPSHOT.md` documents the inspected evidence, its scope, and its limits. It is not a product completion declaration. Raw operational records, credentials, and customer data are excluded.

The site requires no external fonts, scripts, analytics, integrations, or runtime database. It is a personal development project unrelated to Canly. GitHub Pages deployment does not modify the previously hosted introduction site.
