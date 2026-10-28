import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export async function loadPdf(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf;
}

export async function renderPageToCanvas(
  pdf: any,
  pageNumber: number,
  scale: number = 2.0,
  rotation?: number
) {
  const page = await pdf.getPage(pageNumber);
  const viewport = rotation === undefined
    ? page.getViewport({ scale })
    : page.getViewport({ scale, rotation });
  
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Could not create canvas context");
  
  await page.render({
    canvasContext: ctx,
    viewport: viewport,
  }).promise;
  
  return { canvas, viewport };
}

export async function extractTextFromPdf(pdf: any) {
  const numPages = pdf.numPages;
  let fullText = '';
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }
  return fullText;
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: string, quality: number = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas to Blob failed"));
    }, format, quality);
  });
}
