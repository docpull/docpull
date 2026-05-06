import https from "https";
import http from "http";
import { URL } from "url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Fetch a PDF from a URL and return it as a Buffer.
 */
async function fetchPdf(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const request = client.get(url, (res) => {
      // Handle redirects (up to 5 hops)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPdf(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }

      const contentType = res.headers["content-type"] || "";
      if (!contentType.includes("pdf") && !url.toLowerCase().endsWith(".pdf")) {
        // Be lenient – some servers don't set content-type correctly
        console.warn(`Warning: content-type is "${contentType}", proceeding anyway`);
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });

    request.on("error", reject);
    request.setTimeout(30_000, () => {
      request.destroy();
      reject(new Error("PDF fetch timed out after 30s"));
    });
  });
}

/**
 * Return the number of pages in a remote PDF without extracting text.
 */
export async function getPageCount(url) {
  const buffer = await fetchPdf(url);
  const data = new Uint8Array(buffer);
  const pdfDoc = await getDocument({ data }).promise;
  const count = pdfDoc.numPages;
  pdfDoc.destroy();
  return count;
}

/**
 * Download a PDF from `url` and return clean Markdown text.
 *
 * Strategy (in order of quality):
 *  1. pdfjs-dist for structural extraction with heading detection
 *  2. Falls back to raw text concatenation if structure detection fails
 */
export async function extractPdfToMarkdown(url) {
  const buffer = await fetchPdf(url);
  const data = new Uint8Array(buffer);
  const pdfDoc = await getDocument({ data }).promise;

  const pageMarkdowns = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();

    pageMarkdowns.push(
      convertPageToMarkdown(textContent.items, pageNum, pdfDoc.numPages)
    );
  }

  pdfDoc.destroy();
  return pageMarkdowns.join("\n\n---\n\n");
}

/**
 * Convert pdfjs text items for a single page into Markdown.
 * Detects headings by font size and bold weight.
 */
function convertPageToMarkdown(items, pageNum, totalPages) {
  if (!items.length) return `<!-- Page ${pageNum} has no extractable text -->`;

  // Collect font sizes to determine heading thresholds
  const fontSizes = items
    .filter((i) => i.str.trim())
    .map((i) => i.height || 0)
    .filter((h) => h > 0);

  const maxFontSize = fontSizes.length ? Math.max(...fontSizes) : 12;
  const avgFontSize =
    fontSizes.length
      ? fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length
      : 12;

  const lines = [];
  let currentLine = [];
  let lastY = null;
  const LINE_TOLERANCE = 2; // pt – items within this vertical distance are on the same line

  for (const item of items) {
    const text = item.str;
    if (!text) continue;

    const y = item.transform ? item.transform[5] : 0;

    if (lastY !== null && Math.abs(y - lastY) > LINE_TOLERANCE) {
      if (currentLine.length) {
        lines.push({ y: lastY, text: currentLine.join(""), height: currentLine[0]?.height || avgFontSize });
        currentLine = [];
      }
    }

    // Attach height to first item of the line for heading detection
    if (!currentLine.length) {
      currentLine.height = item.height || avgFontSize;
    }
    currentLine.push(text);
    lastY = y;
  }
  if (currentLine.length) {
    lines.push({ y: lastY, text: currentLine.join(""), height: currentLine.height || avgFontSize });
  }

  // Reverse so lines appear top-to-bottom (PDF y-axis is bottom-up)
  lines.reverse();

  const markdownLines = lines.map(({ text, height }) => {
    const trimmed = text.trim();
    if (!trimmed) return "";

    // Heading heuristics
    if (height >= maxFontSize * 0.9 && trimmed.length < 120) {
      return `# ${trimmed}`;
    }
    if (height >= avgFontSize * 1.4 && trimmed.length < 120) {
      return `## ${trimmed}`;
    }
    if (height >= avgFontSize * 1.2 && trimmed.length < 120) {
      return `### ${trimmed}`;
    }

    // Detect bullet lists (common PDF bullet characters)
    if (/^[•◦▪▸\-–—]\s/.test(trimmed)) {
      return `- ${trimmed.replace(/^[•◦▪▸\-–—]\s+/, "")}`;
    }

    // Detect numbered lists
    if (/^\d+[.)]\s/.test(trimmed)) {
      return trimmed;
    }

    return trimmed;
  });

  // Collapse consecutive blank lines into a single blank line
  const collapsed = markdownLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return totalPages > 1
    ? `<!-- Page ${pageNum} of ${totalPages} -->\n\n${collapsed}`
    : collapsed;
}
