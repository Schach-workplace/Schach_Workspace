# Self-hosted Schach website fonts

Retrieved unchanged from the Schach Engineers website on 10 October 2026. The source URLs and weight ranges below were read directly from `@font-face` declarations in the [official homepage](https://www.schachengineers.com/). Both downloaded files have the WOFF2 `wOF2` file signature.

| Local file | Website font usage | Declared weights | Original URL |
| --- | --- | --- | --- |
| `chivo-latin-variable.woff2` | Chivo headings | 400–900, normal | https://www.schachengineers.com/_astro/fonts/d51f2258800ce6b1.woff2 |
| `ibm-plex-sans-latin-variable.woff2` | IBM Plex Sans body | 400–700, normal, stretch 100% | https://www.schachengineers.com/_astro/fonts/2eb6e0e4fc33dd24.woff2 |

IBM Plex Sans regular (400) and medium (500) are covered by the same file. These are the website's Latin subsets: maintain a system font fallback for characters outside the declared Latin and punctuation coverage. No font binaries were edited or re-subsetted.

## Licenses and attribution

Both families use the SIL Open Font License, Version 1.1. The full notices are included beside the fonts and should accompany redistributed source packages.

- **Chivo:** `chivo-OFL.txt`, obtained from the [Google Fonts Chivo distribution](https://raw.githubusercontent.com/google/fonts/main/ofl/chivo/OFL.txt). Copyright 2019 The Chivo Project Authors; original project: https://github.com/Omnibus-Type/Chivo.
- **IBM Plex Sans:** `ibm-plex-sans-OFL.txt`, obtained from the [Google Fonts IBM Plex Sans distribution](https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsans/OFL.txt). Copyright © 2017 IBM Corp.; the notice reserves the font name “Plex.”

These files preserve the fetched font binaries and the upstream distribution license notices. The font license does not grant rights in the separate Schach logo or company name.

## Suggested CSS after copying into the app

```css
@font-face {
  font-family: "Chivo";
  src: url("/fonts/chivo-latin-variable.woff2") format("woff2");
  font-weight: 400 900;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "IBM Plex Sans";
  src: url("/fonts/ibm-plex-sans-latin-variable.woff2") format("woff2");
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}
```

Weight ranges above are verified against the website CSS. Full font table decoding was not performed because this research runtime lacked Python's optional Brotli decoder; verify visual rendering as part of the application's normal browser check.
