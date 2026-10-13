import { useState } from 'react';
import { FileItem } from '../App';
import PdfViewer from './PdfViewer';
import PdfConverter from './PdfConverter';
import PdfTextExtractor from './PdfTextExtractor';
import PdfSplitter from './PdfSplitter';
import PdfPrinter from './PdfPrinter';
import { Eye, Scissors, Image as ImageIcon, Printer, Type, Loader2 } from 'lucide-react';

export type MainTab = 'view' | 'split' | 'convert' | 'print' | 'text';

export default function MainArea({
  fileItem,
  files,
  onSwitchToBatchPrint,
}: {
  fileItem: FileItem;
  files: FileItem[];
  onSwitchToBatchPrint?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<MainTab>('view');

  if (!fileItem.pdfProxy) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-(--color-text-muted) gap-2">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <div className="animate-pulse text-xs">正在渲染解析 PDF 文档，请稍候...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden w-full">
      {/* Tabs */}
      <div className="flex items-center border-b border-(--color-border-subtle) bg-(--color-panel) p-2 gap-1.5 shadow-sm z-10 shrink-0 overflow-x-auto custom-scrollbar">
        <button
          onClick={() => setActiveTab('view')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md transition duration-150 text-xs font-semibold cursor-pointer shrink-0 ${activeTab === 'view' ? 'bg-(--color-canvas) shadow-sm text-blue-600 dark:text-blue-400 font-bold border border-(--color-border-subtle)' : 'text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main)'}`}
        >
          <Eye className="w-4 h-4 text-blue-500" /> 在线预览
        </button>

        <button
          onClick={() => setActiveTab('split')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md transition duration-150 text-xs font-semibold cursor-pointer shrink-0 ${activeTab === 'split' ? 'bg-(--color-canvas) shadow-sm text-blue-600 dark:text-blue-400 font-bold border border-(--color-border-subtle)' : 'text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main)'}`}
        >
          <Scissors className="w-4 h-4 text-amber-500" /> PDF 拆分
        </button>

        <button
          onClick={() => setActiveTab('print')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md transition duration-150 text-xs font-semibold cursor-pointer shrink-0 ${activeTab === 'print' ? 'bg-(--color-canvas) shadow-sm text-blue-600 dark:text-blue-400 font-bold border border-(--color-border-subtle)' : 'text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main)'}`}
        >
          <Printer className="w-4 h-4 text-emerald-500" /> 打印文档
        </button>

        <button
          onClick={() => setActiveTab('convert')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md transition duration-150 text-xs font-semibold cursor-pointer shrink-0 ${activeTab === 'convert' ? 'bg-(--color-canvas) shadow-sm text-blue-600 dark:text-blue-400 font-bold border border-(--color-border-subtle)' : 'text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main)'}`}
        >
          <ImageIcon className="w-4 h-4 text-purple-500" /> 批量转为图片
        </button>

        <button
          onClick={() => setActiveTab('text')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md transition duration-150 text-xs font-semibold cursor-pointer shrink-0 ${activeTab === 'text' ? 'bg-(--color-canvas) shadow-sm text-blue-600 dark:text-blue-400 font-bold border border-(--color-border-subtle)' : 'text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main)'}`}
        >
          <Type className="w-4 h-4 text-sky-500" /> 提取文档文字
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'view' && <PdfViewer fileItem={fileItem} />}
        {activeTab === 'split' && <PdfSplitter fileItem={fileItem} />}
        {activeTab === 'print' && <PdfPrinter files={files} currentFileItem={fileItem} />}
        {activeTab === 'convert' && <PdfConverter fileItem={fileItem} />}
        {activeTab === 'text' && <PdfTextExtractor fileItem={fileItem} />}
      </div>
    </div>
  );
}
