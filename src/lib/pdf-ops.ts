import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { renderPageToCanvas } from './pdf-utils';

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

export interface PrintItem {
  pdfProxy: any;
  title: string;
  pageIndices: number[]; // 0-indexed
}

export interface RenderedPrintPage {
  title: string;
  pageNumber: number;
  dataUrl: string;
}

/**
 * Renders batch or single PDF pages into high-resolution image data URLs
 */
export async function renderPrintPages(
  items: PrintItem[],
  onProgress?: (percent: number, status: string) => void
): Promise<RenderedPrintPage[]> {
  const totalPagesToPrint = items.reduce((acc, item) => acc + item.pageIndices.length, 0);
  if (totalPagesToPrint === 0) {
    throw new Error('没有选定任何可打印的页面');
  }

  let completedPages = 0;
  const renderedPages: RenderedPrintPage[] = [];

  for (const item of items) {
    for (const pageIdx of item.pageIndices) {
      completedPages++;
      onProgress?.(
        Math.round((completedPages / totalPagesToPrint) * 90),
        `正在渲染高精度页面 (${completedPages}/${totalPagesToPrint}): ${item.title} 第 ${pageIdx + 1} 页...`
      );

      // Render at 2.0 scale for sharp print quality
      const { canvas } = await renderPageToCanvas(item.pdfProxy, pageIdx + 1, 2.0);
      const dataUrl = canvas.toDataURL('image/png');
      renderedPages.push({
        title: item.title,
        pageNumber: pageIdx + 1,
        dataUrl,
      });
    }
  }

  return renderedPages;
}

/**
 * Injects rendered pages into the DOM's dedicated #app-print-container
 */
export function mountPagesToPrintContainer(renderedPages: RenderedPrintPage[]) {
  let container = document.getElementById('app-print-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'app-print-container';
    document.body.appendChild(container);
  }

  container.innerHTML = renderedPages
    .map(
      (p, i) => `
    <div class="print-page-box" data-page="${i + 1}">
      <img src="${p.dataUrl}" alt="${p.title} - Page ${p.pageNumber}" />
    </div>
  `
    )
    .join('');
}

/**
 * Clears the print container after print to release memory
 */
export function cleanupPrintContainer() {
  const container = document.getElementById('app-print-container');
  if (container) {
    container.innerHTML = '';
  }
}

/**
 * Triggers browser native print dialog safely.
 * Returns true if window.print() was called without sandbox exception, false otherwise.
 */
export function safeTriggerWindowPrint(): { ok: boolean; error?: string } {
  try {
    window.print();
    return { ok: true };
  } catch (err: any) {
    console.warn('window.print() 被浏览器安全策略或沙盒拦截:', err);
    return {
      ok: false,
      error: err?.message || '当前窗口环境拦截了打印弹窗（缺少 allow-modals 权限）',
    };
  }
}
