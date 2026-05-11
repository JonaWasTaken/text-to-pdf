# Text and PDF Converter

A small, dependency-free browser app that converts typed or pasted text into a downloadable PDF and extracts text from text-based PDFs.
# Text to PDF Converter

A small, dependency-free browser app that converts typed or pasted text into a downloadable PDF.

## Features

- Clean responsive UI for entering text and PDF settings.
- Local text-to-PDF generation with no server upload.
- PDF-to-text extraction for text-based PDFs, including files made by this app.
- Letter and A4 page sizes, configurable font size, and margin presets.
- Live character, word, and estimated page counts for PDF creation.
- Copy or download extracted PDF text as a `.txt` file.
- Local PDF generation with no server upload.
- Letter and A4 page sizes, configurable font size, and margin presets.
- Live character, word, and estimated page counts.

## Run locally

Open `index.html` in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Notes

PDF-to-text extraction works best with selectable text. Scanned image-only PDFs require OCR software, and some compressed or heavily encoded PDFs may not expose text to this dependency-free extractor.
