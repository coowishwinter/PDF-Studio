import { useState, useEffect, useRef } from 'react';
import { FileItem } from '../App';
import { renderPageToCanvas } from '../lib/pdf-utils';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

export default function PdfViewer({ fileItem }: { fileItem: FileItem }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [isRendering, setIsRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const numPages = fileItem.numPages || 1;

  useEffect(() => {
    // Reset page when file changes
    setCurrentPage(1);
  }, [fileItem.id]);

  useEffect(() => {
    let active = true;

    const renderPage = async () => {
      if (!fileItem.pdfProxy || !canvasRef.current) return;
      
      setIsRendering(true);
      try {
        const { canvas, viewport } = await renderPageToCanvas(fileItem.pdfProxy, currentPage, scale);
        
        if (!active) return;

        // Copy rendered canvas to the ref canvas
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          canvasRef.current.width = viewport.width;
          canvasRef.current.height = viewport.height;
          ctx.drawImage(canvas, 0, 0);
        }
      } catch (err) {
        console.error("渲染预览页面失败:", err);
      } finally {
        if (active) setIsRendering(false);
      }
    };

    renderPage();

    return () => { active = false; };
  }, [fileItem, currentPage, scale]);

  return (
    <div className="flex flex-col h-full bg-(--color-canvas)">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-(--color-border-subtle) bg-(--color-panel) shrink-0">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1 || isRendering}
            className="p-1 rounded hover:bg-(--color-bg-hover) disabled:opacity-50 text-(--color-text-main) cursor-pointer"
            title="上一页"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-xs font-semibold w-36 text-center text-(--color-text-main)">
            第 {currentPage} 页 / 共 {numPages} 页
          </span>
          <button 
            onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages || isRendering}
            className="p-1 rounded hover:bg-(--color-bg-hover) disabled:opacity-50 text-(--color-text-main) cursor-pointer"
            title="下一页"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
            className="p-1.5 rounded hover:bg-(--color-bg-hover) text-(--color-text-main) cursor-pointer"
            title="缩小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold w-12 text-center text-(--color-text-muted)">
            {Math.round(scale * 100)}%
          </span>
          <button 
            onClick={() => setScale(s => Math.min(4, s + 0.25))}
            className="p-1.5 rounded hover:bg-(--color-bg-hover) text-(--color-text-main) cursor-pointer"
            title="放大"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewer Area */}
      <div className="flex-1 overflow-auto relative p-8 flex justify-center bg-(--color-canvas) custom-scrollbar" ref={wrapperRef}>
        <div className={`relative shadow-lg transition-opacity duration-300 ${isRendering ? 'opacity-50' : 'opacity-100'}`}>
          <canvas ref={canvasRef} className="max-w-none bg-white rounded-sm drop-shadow-md" />
        </div>
      </div>
    </div>
  );
}
