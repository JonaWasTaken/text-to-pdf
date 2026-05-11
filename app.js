const PAGE_SIZES = {
  letter: { width: 612, height: 792, label: 'Letter' },
  a4: { width: 595.28, height: 841.89, label: 'A4' },
};

const LINE_HEIGHT_RATIO = 1.35;
const AVERAGE_CHARACTER_WIDTH_RATIO = 0.52;

function normalizePdfText(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
}

function sanitizeFileName(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9-_ ]/gi, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return `${cleaned || 'document'}.pdf`;
}

function escapePdfString(value) {
  return normalizePdfText(value).replace(/([\\()])/g, '\\$1');
}

function wrapParagraph(paragraph, maxCharactersPerLine) {
  if (!paragraph.trim()) {
    return [''];
  }

  const words = paragraph.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
      continue;
    }

    const nextLine = `${currentLine} ${word}`;
    if (nextLine.length <= maxCharactersPerLine) {
      currentLine = nextLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.flatMap((line) => splitLongLine(line, maxCharactersPerLine));
}

function splitLongLine(line, maxCharactersPerLine) {
  if (line.length <= maxCharactersPerLine) {
    return [line];
  }

  const chunks = [];
  for (let index = 0; index < line.length; index += maxCharactersPerLine) {
    chunks.push(line.slice(index, index + maxCharactersPerLine));
  }
  return chunks;
}

function paginateText(text, options) {
  const pageSize = PAGE_SIZES[options.pageSize] || PAGE_SIZES.letter;
  const fontSize = Number(options.fontSize) || 12;
  const margin = Number(options.margin) || 54;
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const usableWidth = pageSize.width - margin * 2;
  const usableHeight = pageSize.height - margin * 2;
  const maxLinesPerPage = Math.max(1, Math.floor(usableHeight / lineHeight));
  const maxCharactersPerLine = Math.max(12, Math.floor(usableWidth / (fontSize * AVERAGE_CHARACTER_WIDTH_RATIO)));
  const allLines = normalizePdfText(text)
    .split(/\r?\n/)
    .flatMap((paragraph) => wrapParagraph(paragraph, maxCharactersPerLine));
  const pages = [];

  for (let index = 0; index < allLines.length; index += maxLinesPerPage) {
    pages.push(allLines.slice(index, index + maxLinesPerPage));
  }

  return pages.length ? pages : [['']];
}

function buildPdf(text, options = {}) {
  const pageSize = PAGE_SIZES[options.pageSize] || PAGE_SIZES.letter;
  const fontSize = Number(options.fontSize) || 12;
  const margin = Number(options.margin) || 54;
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const pages = paginateText(text, { pageSize: options.pageSize, fontSize, margin });
  const objects = [];

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');

  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);
  objects.push(`<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  pages.forEach((lines, index) => {
    const pageObjectNumber = 4 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    const contentLines = [
      'BT',
      `/F1 ${fontSize} Tf`,
      `${margin} ${pageSize.height - margin - fontSize} Td`,
      `${lineHeight} TL`,
      ...lines.map((line) => `(${escapePdfString(line)}) Tj T*`),
      'ET',
    ];
    const content = contentLines.join('\n');

    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize.width} ${pageSize.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  return serializePdf(objects);
}

function serializePdf(objects) {
  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(chunks.join('').length);
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });

  const xrefOffset = chunks.join('').length;
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');

  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  }

  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return chunks.join('');
}

function downloadPdf(pdfContent, fileName) {
  const blob = new Blob([pdfContent], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getFormOptions() {
  return {
    pageSize: document.querySelector('#page-size').value,
    fontSize: Number(document.querySelector('#font-size').value),
    margin: Number(document.querySelector('#margin-size').value),
  };
}

function updateSummary() {
  const text = document.querySelector('#source-text').value;
  const options = getFormOptions();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const pages = paginateText(text, options);

  document.querySelector('#character-count').textContent = text.length.toLocaleString();
  document.querySelector('#word-count').textContent = words.toLocaleString();
  document.querySelector('#page-count').textContent = pages.length.toLocaleString();
}

function initializeApp() {
  const form = document.querySelector('#pdf-form');
  const sourceText = document.querySelector('#source-text');
  const clearButton = document.querySelector('#clear-button');
  const statusMessage = document.querySelector('#status-message');
  const watchedInputs = ['#source-text', '#page-size', '#font-size', '#margin-size'];

  watchedInputs.forEach((selector) => {
    document.querySelector(selector).addEventListener('input', updateSummary);
  });

  clearButton.addEventListener('click', () => {
    sourceText.value = '';
    sourceText.focus();
    statusMessage.textContent = 'Text cleared. Add new text when you are ready.';
    updateSummary();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = sourceText.value.trim();

    if (!text) {
      statusMessage.textContent = 'Add some text before downloading a PDF.';
      sourceText.focus();
      return;
    }

    const options = getFormOptions();
    const pdf = buildPdf(text, options);
    const fileName = sanitizeFileName(document.querySelector('#file-name').value);
    downloadPdf(pdf, fileName);
    statusMessage.textContent = `Downloaded ${fileName}.`;
  });

  updateSummary();
}

if (typeof document !== 'undefined') {
  initializeApp();
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildPdf,
    escapePdfString,
    paginateText,
    sanitizeFileName,
  };
}
