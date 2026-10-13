import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { canvasToBlob, renderPageToCanvas } from './pdf-utils';

/**
 * Parses page range string like "1, 3-5, 8" into 0-indexed array of page indices.
 * totalPages is 1-indexed count of pages.
 */
export function parsePageRange(rangeStr: string | undefined | null, totalPages: number): number[] {
  if (!rangeStr || rangeStr.trim().toLowerCase() === 'all' || rangeStr.trim() === '') {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const result: number[] = [];
  const parts = rangeStr.split(/[,，\s]+/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const min = Math.max(1, Math.min(start, end));
        const max = Math.min(totalPages, Math.max(start, end));
        for (let p = min; p <= max; p++) {
          if (!result.includes(p - 1)) {
            result.push(p - 1);
          }
        }
      }
    } else {
      const p = parseInt(trimmed, 10);
      if (!isNaN(p) && p >= 1 && p <= totalPages) {
        if (!result.includes(p - 1)) {
          result.push(p - 1);
        }
      }
    }
  }

  // If user typed something invalid that yielded no pages, fallback to all pages
  return result.length > 0 ? result.sort((a, b) => a - b) : Array.from({ length: totalPages }, (_, i) => i);
}

/**
 * Merges multiple PDF files with optional custom page ranges into a single PDF blob.
 */
export async function mergePdfs(
  items: { file: File; pageRange?: string }[],
  onProgress?: (progress: number, status: string) => void
): Promise<Blob> {
  const mergedPdf = await PDFDocument.create();
  const total = items.length;

  for (let i = 0; i < total; i++) {
    const item = items[i];
    onProgress?.(
      Math.round(((i) / total) * 100),
      `正在读取合并文档 (${i + 1}/${total}): ${item.file.name}...`
    );

    const fileBytes = await item.file.arrayBuffer();
    const srcPdf = await PDFDocument.load(fileBytes);
    const pageCount = srcPdf.getPageCount();
    const pageIndices = parsePageRange(item.pageRange, pageCount);

    const copiedPages = await mergedPdf.copyPages(srcPdf, pageIndices);
    for (const page of copiedPages) {
      mergedPdf.addPage(page);
    }
  }

  onProgress?.(95, '正在生成合并后的 PDF 数据流...');
  const mergedPdfBytes = await mergedPdf.save();
  onProgress?.(100, '合并完成！');

  return new Blob([mergedPdfBytes as any], { type: 'application/pdf' });
}

/**
 * Extracts specific pages from a PDF into a single PDF blob.
 */
export async function extractPagesFromPdf(
  file: File,
  pageIndices: number[]
): Promise<Blob> {
  const fileBytes = await file.arrayBuffer();
  const srcPdf = await PDFDocument.load(fileBytes);
  const newPdf = await PDFDocument.create();

  const copiedPages = await newPdf.copyPages(srcPdf, pageIndices);
  for (const page of copiedPages) {
    newPdf.addPage(page);
  }

  const pdfBytes = await newPdf.save();
  return new Blob([pdfBytes as any], { type: 'application/pdf' });
}

/**
 * Splits a PDF into individual single-page PDFs packaged inside a ZIP archive.
 */
export async function splitPdfToSinglePagesZip(
  file: File,
  onProgress?: (percent: number, status: string) => void
): Promise<Blob> {
  const fileBytes = await file.arrayBuffer();
  const srcPdf = await PDFDocument.load(fileBytes);
  const pageCount = srcPdf.getPageCount();
  const baseName = file.name.replace(/\.pdf$/i, '');
  const zip = new JSZip();
  const padLen = pageCount.toString().length;

  for (let i = 0; i < pageCount; i++) {
    onProgress?.(
      Math.round((i / pageCount) * 85),
      `正在拆分第 ${i + 1} / ${pageCount} 页...`
    );

    const singlePdf = await PDFDocument.create();
    const [copiedPage] = await singlePdf.copyPages(srcPdf, [i]);
    singlePdf.addPage(copiedPage);
    const singlePdfBytes = await singlePdf.save();

    const paddedIndex = (i + 1).toString().padStart(padLen, '0');
    zip.file(`${baseName}_第${paddedIndex}页.pdf`, singlePdfBytes);
  }

  onProgress?.(90, '正在生成 ZIP 压缩归档...');
  const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
    onProgress?.(90 + Math.round(metadata.percent * 0.1), `正在压缩打包: ${Math.round(metadata.percent)}%`);
  });

  onProgress?.(100, '拆分完成！');
  return zipBlob;
}

/**
 * Splits a PDF by fixed page intervals (e.g. every N pages) into a ZIP archive.
 */
export async function splitPdfByIntervalZip(
  file: File,
  pagesPerChunk: number,
  onProgress?: (percent: number, status: string) => void
): Promise<Blob> {
  const fileBytes = await file.arrayBuffer();
  const srcPdf = await PDFDocument.load(fileBytes);
  const totalPages = srcPdf.getPageCount();
  const baseName = file.name.replace(/\.pdf$/i, '');
  const zip = new JSZip();

  const totalChunks = Math.ceil(totalPages / pagesPerChunk);

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const startPage = chunkIdx * pagesPerChunk;
    const endPage = Math.min(startPage + pagesPerChunk, totalPages);
    const chunkIndices = Array.from({ length: endPage - startPage }, (_, idx) => startPage + idx);

    onProgress?.(
      Math.round((chunkIdx / totalChunks) * 85),
      `正在生成分卷 ${chunkIdx + 1} / ${totalChunks} (第 ${startPage + 1}-${endPage} 页)...`
    );

    const chunkPdf = await PDFDocument.create();
    const copiedPages = await chunkPdf.copyPages(srcPdf, chunkIndices);
    for (const page of copiedPages) {
      chunkPdf.addPage(page);
    }
    const chunkBytes = await chunkPdf.save();

    zip.file(`${baseName}_分卷${chunkIdx + 1}_(第${startPage + 1}-${endPage}页).pdf`, chunkBytes);
  }

  onProgress?.(90, '正在生成分卷 ZIP 压缩包...');
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  onProgress?.(100, '分卷拆分完成！');
  return zipBlob;
}

/**
 * Batch printing helper:
 * Renders pages across one or multiple PDF documents into high-resolution images
 * and triggers an isolated print iframe, ensuring seamless cross-browser printing.
 */
export async function printPdfDocuments(
  items: {
    pdfProxy: any;
    title: string;
    pageIndices: number[]; // 0-indexed
  }[],
  onProgress?: (percent: number, status: string) => void
): Promise<void> {
  const totalPagesToPrint = items.reduce((acc, item) => acc + item.pageIndices.length, 0);
  if (totalPagesToPrint === 0) {
    throw new Error('没有选定任何可打印的页面');
  }

  let completedPages = 0;
  const imageSources: string[] = [];

  for (const item of items) {
    for (const pageIdx of item.pageIndices) {
      completedPages++;
      onProgress?.(
        Math.round((completedPages / totalPagesToPrint) * 80),
        `正在渲染高精度打印页面 (${completedPages}/${totalPagesToPrint}): ${item.title} 第 ${pageIdx + 1} 页...`
      );

      // Render at 2.0 scale for sharp print quality
      const { canvas } = await renderPageToCanvas(item.pdfProxy, pageIdx + 1, 2.0);
      const dataUrl = canvas.toDataURL('image/png');
      imageSources.push(dataUrl);
    }
  }

  onProgress?.(90, '正在初始化打印输出沙盒窗口...');

  // Create or reuse hidden iframe
  let iframe = document.getElementById('pdf-print-sandbox-iframe') as HTMLIFrameElement;
  if (iframe) {
    document.body.removeChild(iframe);
  }

  iframe = document.createElement('iframe');
  iframe.id = 'pdf-print-sandbox-iframe';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    throw new Error('无法创建打印窗口环境');
  }

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>打印文档</title>
        <style>
          @page {
            size: auto;
            margin: 0mm;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          html, body {
            width: 100%;
            height: 100%;
            background: #ffffff;
          }
          .print-page-wrapper {
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
            width: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 0;
            margin: 0;
          }
          .print-page-img {
            max-width: 100%;
            width: 100%;
            height: auto;
            display: block;
          }
          @media screen {
            body { padding: 20px; }
            .print-page-wrapper { margin-bottom: 20px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
          }
        </style>
      </head>
      <body>
        ${imageSources.map((src, i) => `
          <div class="print-page-wrapper">
            <img class="print-page-img" src="${src}" alt="Page ${i + 1}" />
          </div>
        `).join('')}
      </body>
    </html>
  `);
  doc.close();

  onProgress?.(100, '调起打印机对话框...');

  // Wait for all images inside iframe to load before printing
  await new Promise<void>((resolve) => {
    const images = doc.images;
    if (images.length === 0) {
      resolve();
      return;
    }

    let loaded = 0;
    const checkAll = () => {
      loaded++;
      if (loaded >= images.length) {
        resolve();
      }
    };

    for (let i = 0; i < images.length; i++) {
      if (images[i].complete) {
        loaded++;
      } else {
        images[i].onload = checkAll;
        images[i].onerror = checkAll;
      }
    }

    if (loaded >= images.length) {
      resolve();
    }
  });

  // Small delay to ensure render layout is settled
  await new Promise((r) => setTimeout(r, 300));

  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
}
