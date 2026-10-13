import React, { useState } from 'react';
import { FileItem } from '../App';
import {
  parsePageRange,
  mergePdfs,
  renderPrintPages,
  mountPagesToPrintContainer,
  cleanupPrintContainer,
  safeTriggerWindowPrint,
  RenderedPrintPage,
  PrintItem,
} from '../lib/pdf-ops';
import { saveAs } from 'file-saver';
import {
  Printer,
  CheckSquare,
  Square,
  ArrowUp,
  ArrowDown,
  Download,
  Loader2,
  CheckCircle,
  FileText,
  Settings2,
  X,
  ExternalLink,
  AlertTriangle,
  ZoomIn,
} from 'lucide-react';

interface PrintFileConfig {
  id: string;
  fileItem: FileItem;
  selected: boolean;
  pageRange: string;
}

export default function PdfPrinter({
  files,
  currentFileItem,
}: {
  files: FileItem[];
  currentFileItem?: FileItem;
}) {
  const [printMode, setPrintMode] = useState<'current' | 'batch'>(() =>
    currentFileItem ? 'current' : 'batch'
  );

  // Single file state
  const [singleRangeType, setSingleRangeType] = useState<'all' | 'custom'>('all');
  const [singleCustomRange, setSingleCustomRange] = useState('');

  // Batch print state
  const [batchList, setBatchList] = useState<PrintFileConfig[]>(() =>
    files.map(f => ({
      id: f.id,
      fileItem: f,
      selected: currentFileItem ? f.id === currentFileItem.id : true,
      pageRange: '',
    }))
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  // Modal / Preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [renderedPages, setRenderedPages] = useState<RenderedPrintPage[]>([]);
  const [printBlockedNotice, setPrintBlockedNotice] = useState<string | null>(null);

  // Active current item
  const targetSingle = currentFileItem || files[0];
  const singleTotalPages = targetSingle?.numPages || 1;

  const toggleSelectAll = (checked: boolean) => {
    setBatchList(prev => prev.map(item => ({ ...item, selected: checked })));
  };

  const toggleItemSelect = (id: string) => {
    setBatchList(prev =>
      prev.map(item => (item.id === id ? { ...item, selected: !item.selected } : item))
    );
  };

  const updateItemRange = (id: string, range: string) => {
    setBatchList(prev =>
      prev.map(item => (item.id === id ? { ...item, pageRange: range } : item))
    );
  };

  const moveBatchItem = (index: number, dir: 'up' | 'down') => {
    const targetIndex = dir === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= batchList.length) return;
    const next = [...batchList];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setBatchList(next);
  };

  // Calculations for batch
  const selectedBatchItems = batchList.filter(item => item.selected && item.fileItem.pdfProxy);
  const totalBatchPages = selectedBatchItems.reduce((acc, item) => {
    const numPages = item.fileItem.numPages || 1;
    const pageIndices = parsePageRange(item.pageRange, numPages);
    return acc + pageIndices.length;
  }, 0);

  // Core Print Routine
  const handleStartPrint = async () => {
    if (isProcessing) return;

    const itemsToPrint: PrintItem[] = [];

    if (printMode === 'current') {
      if (!targetSingle?.pdfProxy) {
        alert('当前文档尚未就绪');
        return;
      }
      const pageIndices =
        singleRangeType === 'all'
          ? Array.from({ length: singleTotalPages }, (_, i) => i)
          : parsePageRange(singleCustomRange, singleTotalPages);

      if (pageIndices.length === 0) {
        alert('请至少选择或输入 1 个有效页码');
        return;
      }

      itemsToPrint.push({
        pdfProxy: targetSingle.pdfProxy,
        title: targetSingle.file.name,
        pageIndices,
      });
    } else {
      if (selectedBatchItems.length === 0) {
        alert('请在列表中至少勾选 1 个文档进行批量打印');
        return;
      }

      for (const item of selectedBatchItems) {
        const numPages = item.fileItem.numPages || 1;
        const pageIndices = parsePageRange(item.pageRange, numPages);
        if (pageIndices.length > 0) {
          itemsToPrint.push({
            pdfProxy: item.fileItem.pdfProxy,
            title: item.fileItem.file.name,
            pageIndices,
          });
        }
      }
    }

    if (itemsToPrint.length === 0) {
      alert('没有可打印的有效页面');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setStatus('正在初始化打印页面数据...');
    setPrintBlockedNotice(null);

    try {
      // 1. Render all pages to high-resolution data URLs
      const pages = await renderPrintPages(itemsToPrint, (p, s) => {
        setProgress(p);
        setStatus(s);
      });

      setRenderedPages(pages);
      setProgress(95);
      setStatus('正在挂载页面至打印引擎...');

      // 2. Mount to DOM print container
      mountPagesToPrintContainer(pages);

      // Open print preview modal for immediate feedback
      setPreviewOpen(true);
      setProgress(100);

      // 3. Trigger native browser print
      const result = safeTriggerWindowPrint();
      if (!result.ok) {
        setPrintBlockedNotice(
          '当前预览环境拦截了系统打印对话框（沙盒限制）。在独立窗口或实际部署环境 (http://localhost:8080) 中可直接呼出；您也可以直接点击下方【一键下载打印合订本 PDF】使用本地系统打印。'
        );
        setStatus('检测到浏览器拦截了弹窗，已为您备好一键打印版 PDF！');
      } else {
        setStatus('已成功唤出浏览器打印对话框！');
      }
    } catch (err: any) {
      console.error(err);
      setStatus(`打印排版出错: ${err?.message || '未知错误'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Re-trigger window.print from modal
  const handleRetryPrint = () => {
    if (renderedPages.length === 0) return;
    mountPagesToPrintContainer(renderedPages);
    const result = safeTriggerWindowPrint();
    if (!result.ok) {
      setPrintBlockedNotice(
        '当前沙盒环境拦截了直接弹窗，请点击右侧【下载打印版 PDF】在本地打开直接打印。'
      );
    }
  };

  // Close preview modal
  const handleClosePreview = () => {
    setPreviewOpen(false);
    cleanupPrintContainer();
  };

  // Export as Merged Print PDF
  const handleExportPrintPdf = async () => {
    if (isProcessing) return;

    setIsProcessing(true);
    setProgress(0);
    setStatus('正在合并生成打印专用 PDF...');

    try {
      if (printMode === 'current') {
        if (!targetSingle) return;
        const range = singleRangeType === 'all' ? '' : singleCustomRange;
        const blob = await mergePdfs([{ file: targetSingle.file, pageRange: range }], (p, s) => {
          setProgress(p);
          setStatus(s);
        });
        saveAs(blob, `打印版_${targetSingle.file.name}`);
      } else {
        if (selectedBatchItems.length === 0) {
          alert('请至少勾选 1 个文档');
          setIsProcessing(false);
          return;
        }

        const mergePayload = selectedBatchItems.map(item => ({
          file: item.fileItem.file,
          pageRange: item.pageRange,
        }));

        const blob = await mergePdfs(mergePayload, (p, s) => {
          setProgress(p);
          setStatus(s);
        });
        saveAs(blob, `批量打印合订本_${selectedBatchItems.length}个文件.pdf`);
      }
      setStatus('打印版 PDF 已生成并开始下载！');
    } catch (err: any) {
      console.error(err);
      setStatus('生成打印版 PDF 失败');
    } finally {
      setIsProcessing(false);
      setTimeout(() => {
        if (status.includes('已生成')) setStatus('');
      }, 5000);
    }
  };

  return (
    <div className="flex-1 p-6 md:p-8 bg-(--color-canvas) text-(--color-text-main) h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Header Card */}
        <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold flex items-center gap-2 text-(--color-text-main)">
              <Printer className="w-5 h-5 text-blue-500" />
              文档打印与批量排版中心
            </h2>
            <div className="flex items-center bg-(--color-canvas) p-1 rounded-lg border border-(--color-border-subtle)">
              {currentFileItem && (
                <button
                  onClick={() => setPrintMode('current')}
                  className={`px-3 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${printMode === 'current' ? 'bg-(--color-panel) text-blue-600 dark:text-blue-400 shadow-sm' : 'text-(--color-text-muted) hover:text-(--color-text-main)'}`}
                >
                  当前文档打印
                </button>
              )}
              <button
                onClick={() => setPrintMode('batch')}
                className={`px-3 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${printMode === 'batch' ? 'bg-(--color-panel) text-blue-600 dark:text-blue-400 shadow-sm' : 'text-(--color-text-muted) hover:text-(--color-text-main)'}`}
              >
                批量打印 ({files.length}个文件)
              </button>
            </div>
          </div>
          <p className="text-xs text-(--color-text-muted) leading-relaxed">
            支持一键调起浏览器物理打印机对话框，或将多份文档批量编排导出为统一的高清打印版 PDF。所有渲染与排版工作完全在本地浏览器沙盒执行，安全私密。
          </p>
        </div>

        {/* Mode: Current File Print */}
        {printMode === 'current' && targetSingle && (
          <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-(--color-border-subtle)">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-blue-500" />
                <div>
                  <div className="text-xs font-bold text-(--color-text-main)">
                    {targetSingle.file.name}
                  </div>
                  <div className="text-[11px] text-(--color-text-muted)">
                    总页数: {singleTotalPages} 页 • 大小: {(targetSingle.file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
              </div>
            </div>

            {/* Scope selection */}
            <div>
              <label className="text-xs font-bold text-(--color-text-main) block mb-2">
                打印范围选择
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className={`p-3 rounded-lg border cursor-pointer flex items-center gap-2.5 transition-colors ${singleRangeType === 'all' ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400' : 'border-(--color-border-subtle) hover:bg-(--color-bg-hover)'}`}>
                  <input
                    type="radio"
                    name="singleScope"
                    checked={singleRangeType === 'all'}
                    onChange={() => setSingleRangeType('all')}
                    className="text-blue-600"
                  />
                  <div>
                    <span className="text-xs font-bold block">全部页面</span>
                    <span className="text-[10px] text-(--color-text-muted)">第 1 页 至 第 {singleTotalPages} 页 (完整打印)</span>
                  </div>
                </label>

                <label className={`p-3 rounded-lg border cursor-pointer flex items-center gap-2.5 transition-colors ${singleRangeType === 'custom' ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400' : 'border-(--color-border-subtle) hover:bg-(--color-bg-hover)'}`}>
                  <input
                    type="radio"
                    name="singleScope"
                    checked={singleRangeType === 'custom'}
                    onChange={() => setSingleRangeType('custom')}
                    className="text-blue-600"
                  />
                  <div>
                    <span className="text-xs font-bold block">指定页码范围</span>
                    <span className="text-[10px] text-(--color-text-muted)">自定义输入需要打印的页码</span>
                  </div>
                </label>
              </div>

              {singleRangeType === 'custom' && (
                <div className="mt-3">
                  <input
                    type="text"
                    value={singleCustomRange}
                    onChange={(e) => setSingleCustomRange(e.target.value)}
                    placeholder="例如: 1-3, 5, 8 (留空则打印全部)"
                    className="w-full p-2.5 text-xs font-mono rounded-lg border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) focus:border-blue-500 outline-none"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mode: Batch Print */}
        {printMode === 'batch' && (
          <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-(--color-border-subtle)">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleSelectAll(selectedBatchItems.length !== batchList.length)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  {selectedBatchItems.length === batchList.length ? (
                    <>
                      <CheckSquare className="w-4 h-4" /> 取消全选
                    </>
                  ) : (
                    <>
                      <Square className="w-4 h-4" /> 全选文档
                    </>
                  )}
                </button>
                <span className="text-xs text-(--color-text-muted)">
                  (已勾选 {selectedBatchItems.length} / {batchList.length} 个文档)
                </span>
              </div>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full">
                共计 {totalBatchPages} 页待打印
              </span>
            </div>

            {batchList.length === 0 ? (
              <div className="border border-dashed border-(--color-border-subtle) p-8 rounded-xl text-center text-xs text-(--color-text-muted)">
                暂无导入的文件，请在左侧栏导入多个 PDF 电子文档。
              </div>
            ) : (
              <div className="space-y-2.5">
                {batchList.map((item, idx) => {
                  const pages = parsePageRange(item.pageRange, item.fileItem.numPages || 1);

                  return (
                    <div
                      key={item.id}
                      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-lg border transition-all gap-3 ${item.selected ? 'border-blue-500/40 bg-(--color-canvas)' : 'border-(--color-border-subtle) opacity-60 bg-(--color-panel)'}`}
                    >
                      <div className="flex items-center gap-3 overflow-hidden flex-1">
                        <button
                          type="button"
                          onClick={() => toggleItemSelect(item.id)}
                          className="text-blue-600 cursor-pointer shrink-0"
                        >
                          {item.selected ? <CheckSquare className="w-4.5 h-4.5" /> : <Square className="w-4.5 h-4.5 text-gray-400" />}
                        </button>
                        <div className="overflow-hidden">
                          <div className="text-xs font-semibold text-(--color-text-main) truncate max-w-xs md:max-w-md">
                            {item.fileItem.file.name}
                          </div>
                          <div className="text-[10px] text-(--color-text-muted) flex items-center gap-2 mt-0.5">
                            <span>原始文档: {item.fileItem.numPages || 1} 页</span>
                            <span>•</span>
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              本次打印: {pages.length} 页
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Range Input for batch item */}
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-(--color-text-muted)">打印页码 (默认全部)</span>
                          <input
                            type="text"
                            placeholder="全部页面"
                            value={item.pageRange}
                            disabled={!item.selected}
                            onChange={(e) => updateItemRange(item.id, e.target.value)}
                            className="px-2.5 py-1 text-xs font-mono rounded border border-(--color-border-subtle) bg-(--color-panel) text-(--color-text-main) w-32 focus:border-blue-500 outline-none disabled:opacity-40"
                          />
                        </div>

                        {/* Move order */}
                        <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                          <button
                            onClick={() => moveBatchItem(idx, 'up')}
                            disabled={idx === 0}
                            className="p-1 rounded hover:bg-(--color-bg-hover) disabled:opacity-30 text-(--color-text-main) cursor-pointer"
                            title="优先打印"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => moveBatchItem(idx, 'down')}
                            disabled={idx === batchList.length - 1}
                            className="p-1 rounded hover:bg-(--color-bg-hover) disabled:opacity-30 text-(--color-text-main) cursor-pointer"
                            title="延后打印"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons & Execution Card */}
        <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <button
              onClick={handleStartPrint}
              disabled={isProcessing || (printMode === 'batch' && selectedBatchItems.length === 0)}
              className="w-full relative overflow-hidden flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white p-3.5 rounded-lg font-bold text-xs transition-colors disabled:cursor-not-allowed cursor-pointer shadow-md"
            >
              {isProcessing && (
                <div
                  className="absolute left-0 top-0 bottom-0 bg-blue-500 opacity-50 z-0 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    正在渲染打印队列... {progress}%
                  </>
                ) : (
                  <>
                    <Printer className="w-4 h-4" />
                    {printMode === 'current' ? '调起浏览器打印当前文档' : `立即批量打印 (共 ${totalBatchPages} 页)`}
                  </>
                )}
              </span>
            </button>

            <button
              onClick={handleExportPrintPdf}
              disabled={isProcessing || (printMode === 'batch' && selectedBatchItems.length === 0)}
              className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white p-3.5 rounded-lg font-bold text-xs transition-colors disabled:cursor-not-allowed cursor-pointer shadow-md"
            >
              <Download className="w-4 h-4" />
              {printMode === 'current' ? '导出打印版高清 PDF' : '合并导出批量打印合订本 (PDF)'}
            </button>
          </div>

          {status && (
            <div className="flex items-center justify-center gap-2 text-xs font-semibold text-center text-blue-600 dark:text-blue-400 pt-2">
              {status.includes('成功') ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{status}</span>
            </div>
          )}

          <div className="bg-blue-50/50 dark:bg-blue-950/20 text-blue-900 dark:text-blue-200 p-3.5 rounded-lg text-xs border border-blue-200/50 dark:border-blue-900/50 flex items-start gap-2 leading-relaxed">
            <Settings2 className="w-4 h-4 shrink-0 text-blue-500 mt-0.5" />
            <div>
              <strong>双重打印保障：</strong>
              <div className="mt-1 space-y-1 text-[11px] opacity-90">
                <p>1. <b>直接调起打印机</b>：系统在本地将所有选定页面渲染为高清排版，并呼出浏览器的原生打印面板（可在面板中选择物理打印机、单双面打印等）。</p>
                <p>2. <b>合订本 PDF 导出</b>：如需带去外部打印店或在离线电脑上打印，可点击“合并导出批量打印合订本”，生成单份标准 PDF 文件。</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Print Preview & Management Modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-(--color-panel) w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl border border-(--color-border-subtle) flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-(--color-border-subtle) flex items-center justify-between bg-(--color-panel) shrink-0">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-sm text-(--color-text-main)">
                  批量打印页面就绪控制台 (已准备 {renderedPages.length} 页)
                </h3>
              </div>
              <button
                onClick={handleClosePreview}
                className="p-1.5 rounded-lg hover:bg-(--color-bg-hover) text-(--color-text-muted) hover:text-(--color-text-main) cursor-pointer"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Sandbox Notice Banner if blocked */}
            {printBlockedNotice && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-850 flex items-start gap-2 text-amber-900 dark:text-amber-200 text-xs shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  {printBlockedNotice}
                </div>
              </div>
            )}

            {/* Scrollable Gallery Preview */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-100 dark:bg-slate-900/60 custom-scrollbar">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {renderedPages.map((page, idx) => (
                  <div
                    key={idx}
                    className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col"
                  >
                    <div className="p-2 border-b border-gray-100 dark:border-gray-700/50 flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                      <span className="font-bold text-blue-600 dark:text-blue-400">第 {idx + 1} 页</span>
                      <span className="truncate max-w-[120px]">{page.title}</span>
                    </div>
                    <div className="p-2 flex-1 flex items-center justify-center bg-gray-50 dark:bg-slate-900">
                      <img
                        src={page.dataUrl}
                        alt={`Page ${idx + 1}`}
                        className="max-h-48 w-auto object-contain shadow-xs border border-gray-100 dark:border-gray-800"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 border-t border-(--color-border-subtle) bg-(--color-panel) flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              <div className="text-xs text-(--color-text-muted)">
                当前队列：共计 <b>{renderedPages.length}</b> 个页面准备就绪
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                <button
                  onClick={handleRetryPrint}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer transition-colors shadow-sm"
                >
                  <Printer className="w-3.5 h-3.5" /> 调起系统打印机窗口
                </button>

                <button
                  onClick={handleExportPrintPdf}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-bold cursor-pointer transition-colors shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" /> 一键下载打印版 PDF
                </button>

                <button
                  onClick={handleClosePreview}
                  className="px-3.5 py-2 rounded-lg border border-(--color-border-subtle) hover:bg-(--color-bg-hover) text-xs font-semibold text-(--color-text-main) cursor-pointer"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
