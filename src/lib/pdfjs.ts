import * as pdfjsLib from 'pdfjs-dist';

export const initPdfWorker = () => {
  // Try to use CDNs if Vite plugin url doesn't work out of the box nicely for pdfjs v4+
  // But using unpkg or cloudflare is very stable
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export { pdfjsLib };
