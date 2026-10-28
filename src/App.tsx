import React, { useState, useEffect } from 'react';
import { FileUp, Moon, Sun, Trash2, FileText, ShieldAlert, Combine, Printer, Layers, Plus } from 'lucide-react';
import { loadPdf } from './lib/pdf-utils';
import MainArea from './components/MainArea';
import PdfMerger from './components/PdfMerger';
import PdfPrinter from './components/PdfPrinter';

export type FileItem = {
  id: string;
  file: File;
  pdfProxy?: any;
  numPages?: number;
};

export type GlobalView = 'workspace' | 'merge' | 'batch-print';

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [globalView, setGlobalView] = useState<GlobalView>('workspace');
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const handleFilesAdded = async (newFiles: FileList | null) => {
    if (!newFiles) return;
    const items: FileItem[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) continue;

      const id = Math.random().toString(36).substring(7);
      items.push({ id, file });
    }

    if (items.length === 0) return;

    // Load PDF proxies
    const itemsWithPdf = await Promise.all(
      items.map(async (item) => {
        try {
          const pdf = await loadPdf(item.file);
          return { ...item, pdfProxy: pdf, numPages: pdf.numPages };
        } catch (e) {
          console.error("加载PDF出错:", e);
          return item;
        }
      })
    );

    setFiles(prev => [...prev, ...itemsWithPdf]);
    if (!selectedFileId && itemsWithPdf.length > 0) {
      setSelectedFileId(itemsWithPdf[0].id);
    }
  };

  const handleAddSingleFile = async (file: File) => {
    const id = Math.random().toString(36).substring(7);
    let item: FileItem = { id, file };
    try {
      const pdf = await loadPdf(file);
      item = { id, file, pdfProxy: pdf, numPages: pdf.numPages };
    } catch (e) {
      console.error("加载新添加文件失败:", e);
    }
    setFiles(prev => [...prev, item]);
    setSelectedFileId(id);
    setGlobalView('workspace');
  };

  const removeFile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFiles(prev => prev.filter(f => f.id !== id));
    if (selectedFileId === id) {
      setSelectedFileId(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFilesAdded(e.dataTransfer.files);
    }
  };

  const selectedFile = files.find(f => f.id === selectedFileId);

  return (
    <div className="flex h-screen w-full font-sans overflow-hidden transition-colors duration-200">
      {/* Sidebar */}
      <div className="w-80 border-r border-(--color-border-subtle) bg-(--color-panel) flex flex-col shrink-0 transition-colors duration-200">
        {/* Title logo section */}
        <div className="p-4 border-b border-(--color-border-subtle) flex items-center justify-between">
          <h1 className="text-base font-bold flex items-center gap-2 text-(--color-text-main)">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            PDF 全能处理大师
          </h1>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-1.5 rounded-md hover:bg-(--color-bg-hover) text-(--color-text-muted) hover:text-(--color-text-main) transition-colors cursor-pointer"
            title={darkMode ? "切换至浅色模式" : "切换至深色模式"}
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* Global Functional Mode Navigation */}
        <div className="p-2.5 border-b border-(--color-border-subtle) bg-(--color-canvas)/60">
          <div className="grid grid-cols-3 gap-1 bg-(--color-panel) p-1 rounded-lg border border-(--color-border-subtle)">
            <button
              onClick={() => setGlobalView('workspace')}
              className={`py-1.5 px-2 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer transition-all ${globalView === 'workspace' ? 'bg-blue-600 text-white shadow-sm' : 'text-(--color-text-muted) hover:text-(--color-text-main) hover:bg-(--color-bg-hover)'}`}
              title="针对选中文档进行预览、拆分、转图片或提取文字"
            >
              <Layers className="w-3.5 h-3.5" />
              文档编辑
            </button>

            <button
              onClick={() => setGlobalView('merge')}
              className={`py-1.5 px-2 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer transition-all ${globalView === 'merge' ? 'bg-blue-600 text-white shadow-sm' : 'text-(--color-text-muted) hover:text-(--color-text-main) hover:bg-(--color-bg-hover)'}`}
              title="合并多个 PDF 文档"
            >
              <Combine className="w-3.5 h-3.5" />
              合并
              {files.length > 1 && (
                <span className="text-[9px] bg-white/20 px-1 rounded-full">
                  {files.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setGlobalView('batch-print')}
              className={`py-1.5 px-2 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer transition-all ${globalView === 'batch-print' ? 'bg-blue-600 text-white shadow-sm' : 'text-(--color-text-muted) hover:text-(--color-text-main) hover:bg-(--color-bg-hover)'}`}
              title="批量打印多个 PDF 文档"
            >
              <Printer className="w-3.5 h-3.5" />
              批量打印
            </button>
          </div>
        </div>

        {/* Drag / Upload Zone */}
        <div className="p-3">
          <label
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center w-full h-24 px-3 transition-all duration-200 border-2 border-dashed rounded-lg cursor-pointer ${isDragging ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 shadow-inner' : 'border-gray-300 dark:border-gray-700 hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-800/20'}`}
          >
            <span className="flex flex-col items-center space-y-1 text-center text-(--color-text-muted)">
              <FileUp className={`w-5 h-5 transition-transform duration-200 ${isDragging ? 'scale-110 text-blue-500' : ''}`} />
              <span className="font-semibold text-xs">拖拽文件 或 点击上传</span>
              <span className="text-[10px] opacity-65">支持批量导入 .pdf 文件</span>
            </span>
            <input
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={(e) => handleFilesAdded(e.target.files)}
            />
          </label>
        </div>

        {/* Selected files stack list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          <div className="px-2 py-1 text-[11px] font-semibold text-(--color-text-muted)/80 uppercase tracking-wider flex items-center justify-between">
            <span>文档库 ({files.length})</span>
            {files.length > 0 && (
              <span className="text-[10px] text-(--color-text-muted) font-normal">
                共 {files.reduce((a, c) => a + (c.numPages || 0), 0)} 页
              </span>
            )}
          </div>

          {files.map(fileItem => (
            <div
              key={fileItem.id}
              onClick={() => {
                setSelectedFileId(fileItem.id);
                setGlobalView('workspace');
              }}
              className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors ${selectedFileId === fileItem.id && globalView === 'workspace' ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 font-medium border border-blue-500/20' : 'hover:bg-(--color-bg-hover) text-(--color-text-main)'}`}
            >
              <div className="flex items-center gap-2.5 overflow-hidden">
                <FileText className={`w-4 h-4 shrink-0 ${selectedFileId === fileItem.id && globalView === 'workspace' ? 'text-blue-600 dark:text-blue-400' : 'text-(--color-text-muted)'}`} />
                <div className="flex flex-col overflow-hidden">
                  <span className="text-xs truncate w-44">{fileItem.file.name}</span>
                  <span className="text-[10px] text-(--color-text-muted)">
                    {fileItem.numPages ? `${fileItem.numPages} 页` : '解析中...'} • {(fileItem.file.size / 1024 / 1024).toFixed(1)}MB
                  </span>
                </div>
              </div>
              <button
                onClick={(e) => removeFile(fileItem.id, e)}
                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-all text-(--color-text-muted) cursor-pointer"
                title="移除该文件"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {files.length === 0 && (
            <div className="text-center text-(--color-text-muted) px-4 py-8 text-xs border border-dashed border-gray-200 dark:border-gray-800 rounded-lg mx-2">
              <ShieldAlert className="w-7 h-7 mx-auto mb-2 opacity-30 text-emerald-500" />
              暂无导入的文档。<br/>
              <span className="text-[10px] mt-1 block">
                所有拆分、合并、渲染与打印完全在本地浏览器中运行，不经任何服务器。
              </span>
            </div>
          )}
        </div>

        {/* Private security footer badge */}
        <div className="p-3 bg-(--color-canvas) border-t border-(--color-border-subtle) text-[10px] text-(--color-text-muted) flex items-center gap-1.5 justify-center">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0"></span>
          纯本地沙盒计算：绝对保护文档隐私
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-(--color-canvas) flex flex-col overflow-hidden transition-colors duration-200 relative">
        {globalView === 'merge' ? (
          <PdfMerger
            files={files}
            onAddMergedFile={handleAddSingleFile}
            onFilesAdded={handleFilesAdded}
          />
        ) : globalView === 'batch-print' ? (
          <PdfPrinter files={files} />
        ) : selectedFile ? (
          <MainArea
            fileItem={selectedFile}
            files={files}
            onSwitchToBatchPrint={() => setGlobalView('batch-print')}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-(--color-text-muted) p-8">
            <div className="p-6 bg-(--color-panel) border border-(--color-border-subtle) rounded-2xl shadow-xl flex flex-col items-center max-w-md text-center">
              <FileText className="w-14 h-14 mb-3 text-blue-500 opacity-70 animate-pulse" />
              <p className="text-base font-bold text-(--color-text-main)">欢迎使用 PDF 全能处理大师</p>
              <p className="text-xs mt-2 text-(--color-text-muted) leading-relaxed">
                高私密纯本地工具：支持<b>在线预览</b>、<b>PDF 编辑（文字/图片签名/高亮/涂白/水印/页码）</b>、<b>PDF拆分与提取</b>、<b>多文档合并</b>、<b>高清打印（支持批量打印）</b>、<b>批量转图片</b>以及<b>文字提取</b>。
              </p>

              <div className="grid grid-cols-2 gap-2 mt-5 w-full">
                <label className="flex items-center justify-center gap-1.5 p-2.5 rounded-lg border border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-semibold text-xs cursor-pointer hover:bg-blue-50 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> 导入 PDF 开始
                  <input
                    type="file"
                    accept=".pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFilesAdded(e.target.files)}
                  />
                </label>

                <button
                  onClick={() => setGlobalView('merge')}
                  className="flex items-center justify-center gap-1.5 p-2.5 rounded-lg border border-(--color-border-subtle) hover:bg-(--color-bg-hover) text-(--color-text-main) font-semibold text-xs cursor-pointer transition-colors"
                >
                  <Combine className="w-3.5 h-3.5" /> 多文件合并
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
