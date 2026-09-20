# Third-party notices

Veil's standalone HTML embeds these third-party components. Their license texts are included in the app under **Third-party notices** and are retained by `build.mjs`.

| Component | Version | License / project |
| --- | --- | --- |
| Mozilla PDF.js (`pdfjs-dist`) | 5.6.205 | Apache-2.0 — https://github.com/mozilla/pdf.js |
| pdf-lib | 1.17.1 | MIT — https://github.com/Hopding/pdf-lib |
| fflate | 0.8.3 | MIT — https://github.com/101arrowz/fflate |
| PostalMime (`postal-mime`) | 3.0.0 | MIT — https://github.com/postalsys/postal-mime |
| @pdf-lib/fontkit | 1.1.1 | MIT — https://github.com/Hopding/fontkit |
| pako (included in fontkit) | 1.0.11 | MIT and Zlib — https://github.com/nodeca/pako |
| PDF.js fonts, character maps and WebAssembly decoding assets | Bundled with PDF.js | Associated license notices included in the standalone HTML |

Playwright and esbuild are development-only testing/build tools; they are not runtime dependencies of the app.

Original Veil source is copyright © 2026 Louise Mead and licensed under GNU AGPL v3 only (`AGPL-3.0-only`); see [LICENSE](LICENSE). This does not replace the third-party licenses and attributions above.

- sax 1.6.1 (BlueOak-1.0.0), vendored from the installed workspace dependency runtime at `vendor/sax.cjs`. License: `licenses/sax.txt`. Used only for bounded local XML parsing; bundled into the standalone HTML.
