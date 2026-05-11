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


function arrayBufferToBinaryString(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return binary;
}

function decodePdfEscapes(value) {
  let output = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== '\\') {
      output += character;
      continue;
    }

    const nextCharacter = value[index + 1];

    if (!nextCharacter) {
      continue;
    }

    const escapeMap = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      '(': '(',
      ')': ')',
      '\\': '\\',
    };

    if (escapeMap[nextCharacter]) {
      output += escapeMap[nextCharacter];
      index += 1;
      continue;
    }

    if (/[0-7]/.test(nextCharacter)) {
      const octalMatch = value.slice(index + 1).match(/^[0-7]{1,3}/);
      if (octalMatch) {
        output += String.fromCharCode(parseInt(octalMatch[0], 8));
        index += octalMatch[0].length;
        continue;
      }
    }

    if (nextCharacter === '\n' || nextCharacter === '\r') {
      index += nextCharacter === '\r' && value[index + 2] === '\n' ? 2 : 1;
      continue;
    }

    output += nextCharacter;
    index += 1;
  }

  return output;
}

function decodeHexPdfString(hexValue) {
  const normalizedHex = hexValue.replace(/\s+/g, '');
  let output = '';

  for (let index = 0; index < normalizedHex.length; index += 2) {
    const byte = normalizedHex.slice(index, index + 2).padEnd(2, '0');
    output += String.fromCharCode(parseInt(byte, 16));
  }

  return output;
}

function readLiteralPdfString(content, startIndex) {
  let depth = 1;
  let value = '';

  for (let index = startIndex + 1; index < content.length; index += 1) {
    const character = content[index];

    if (character === '\\') {
      value += character;
      if (index + 1 < content.length) {
        value += content[index + 1];
        index += 1;
      }
      continue;
    }

    if (character === '(') {
      depth += 1;
    }

    if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return { value: decodePdfEscapes(value), endIndex: index };
      }
    }

    value += character;
  }

  return { value: decodePdfEscapes(value), endIndex: content.length - 1 };
}

function extractTextFromPdfContent(content) {
  const pieces = [];

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === '(') {
      const literal = readLiteralPdfString(content, index);
      pieces.push(literal.value);
      index = literal.endIndex;
      continue;
    }

    if (character === '<' && content[index + 1] !== '<') {
      const endIndex = content.indexOf('>', index + 1);
      if (endIndex !== -1) {
        pieces.push(decodeHexPdfString(content.slice(index + 1, endIndex)));
        index = endIndex;
      }
      continue;
    }

    if (content.startsWith('T*', index) || content.startsWith("'", index) || content.startsWith('"', index)) {
      pieces.push('\n');
    }
  }

  return pieces.join('');
}

function extractTextFromPdfBinary(binary) {
  const streamMatches = [...binary.matchAll(/stream\r?\n?([\s\S]*?)\r?\n?endstream/g)];
  const contents = streamMatches.length ? streamMatches.map((match) => match[1]) : [binary];
  const text = contents
    .map(extractTextFromPdfContent)
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function downloadText(text, fileName = 'extracted-text.txt') {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function getExtractedTextFileName(pdfFileName) {
  const baseName = String(pdfFileName || 'extracted-text')
    .replace(/\.pdf$/i, '')
    .trim();

  return sanitizeFileName(baseName).replace(/\.pdf$/i, '.txt');
}

function initializeTextToPdf() {
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

function initializePdfToText() {
  const pdfInput = document.querySelector('#pdf-file');
  const extractedText = document.querySelector('#extracted-text');
  const copyButton = document.querySelector('#copy-text-button');
  const downloadTextButton = document.querySelector('#download-text-button');
  const clearPdfButton = document.querySelector('#clear-pdf-button');
  const pdfStatusMessage = document.querySelector('#pdf-status-message');
  let selectedPdfName = 'extracted-text.pdf';

  pdfInput.addEventListener('change', async () => {
    const file = pdfInput.files[0];

    if (!file) {
      return;
    }

    selectedPdfName = file.name;
    pdfStatusMessage.textContent = `Reading ${file.name}...`;

    try {
      const buffer = await file.arrayBuffer();
      const binary = arrayBufferToBinaryString(buffer);
      const text = extractTextFromPdfBinary(binary);
      extractedText.value = text;
      pdfStatusMessage.textContent = text
        ? `Extracted ${text.length.toLocaleString()} characters from ${file.name}.`
        : 'No selectable text was found. This may be a scanned or compressed PDF.';
    } catch (error) {
      extractedText.value = '';
      pdfStatusMessage.textContent = 'Could not extract text from that PDF.';
    }
  });

  copyButton.addEventListener('click', async () => {
    if (!extractedText.value) {
      pdfStatusMessage.textContent = 'Extract text before copying.';
      return;
    }

    if (!navigator.clipboard) {
      extractedText.removeAttribute('readonly');
      extractedText.select();
      extractedText.setAttribute('readonly', '');
      pdfStatusMessage.textContent = 'Clipboard unavailable. The extracted text is selected for manual copy.';
      return;
    }

    try {
      await navigator.clipboard.writeText(extractedText.value);
      pdfStatusMessage.textContent = 'Extracted text copied to clipboard.';
    } catch (error) {
      extractedText.removeAttribute('readonly');
      extractedText.select();
      extractedText.setAttribute('readonly', '');
      pdfStatusMessage.textContent = 'Clipboard permission denied. The extracted text is selected for manual copy.';
    }
  });

  downloadTextButton.addEventListener('click', () => {
    if (!extractedText.value) {
      pdfStatusMessage.textContent = 'Extract text before downloading a .txt file.';
      return;
    }

    const fileName = getExtractedTextFileName(selectedPdfName);
    downloadText(extractedText.value, fileName);
    pdfStatusMessage.textContent = `Downloaded ${fileName}.`;
  });

  clearPdfButton.addEventListener('click', () => {
    pdfInput.value = '';
    extractedText.value = '';
    selectedPdfName = 'extracted-text.pdf';
    pdfStatusMessage.textContent = 'Select a PDF to extract text.';
  });
}

function initializeApp() {
  initializeTextToPdf();
  initializePdfToText();
}

if (typeof document !== 'undefined') {
  initializeApp();
}

if (typeof module !== 'undefined') {
  module.exports = {
    arrayBufferToBinaryString,
    buildPdf,
    escapePdfString,
    extractTextFromPdfBinary,
    extractTextFromPdfContent,
    getExtractedTextFileName,
    paginateText,
    sanitizeFileName,
  };
}
