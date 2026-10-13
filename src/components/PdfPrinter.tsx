import { useState } from 'react';
import { FileItem } from '../App';
import { printPdfDocuments, parsePageRange, mergePdfs } from '../lib/pdf-ops';
import { saveAs } from 'file-saver';
import { Printer, CheckSquare, Square, ArrowUp, ArrowDown, Download, Loader2, CheckCircle, FileText, Settings2, Sliders } from 'lucide-react';

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

  const [isPrinting, setIsPrinting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  // Active current item
  const targetSingle = currentFileItem || files[0];
  const singleTotalPages = targetSingle?.numPages || 1;

  // Sync batch list if files change
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

  // Trigger browser print
  const handlePrint = async () => {
    if (isPrinting) return;

    const itemsToPrint: { pdfProxy: any; title: string; pageIndices: number[] }[] = [];

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

    setIsPrinting(true);
    setProgress(0);
    setStatus('正在准备打印页面渲染...');

    try {
      await printPdfDocuments(itemsToPrint, (p, s) => {
        setProgress(p);
        setStatus(s);
      });
      setStatus('打印请求已成功调起！');
    } catch (err: any) {
      console.error(err);
      setStatus(`打印失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsPrinting(false);
      setTimeout(() => {
        if (status.includes('成功')) setStatus('');
      }, 5000);
    }
  };

  // Export as Merged Print PDF
  const handleExportPrintPdf = async () => {
    if (isPrinting) return;

    setIsPrinting(true);
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
          setIsPrinting(false);
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
      setIsPrinting(false);
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
            支持一键调起浏览器物理打印机对话框，或将多份文档批量编排导出为统一的打印版 PDF。所有渲染与排版工作均在本地浏览器执行。
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
              onClick={handlePrint}
              disabled={isPrinting || (printMode === 'batch' && selectedBatchItems.length === 0)}
              className="w-full relative overflow-hidden flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white p-3.5 rounded-lg font-bold text-xs transition-colors disabled:cursor-not-allowed cursor-pointer shadow-md"
            >
              {isPrinting && (
                <div
                  className="absolute left-0 top-0 bottom-0 bg-blue-500 opacity-50 z-0 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                {isPrinting ? (
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
              disabled={isPrinting || (printMode === 'batch' && selectedBatchItems.length === 0)}
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
              <strong>批量打印贴士：</strong> 点击“立即批量打印”后，系统将在本地沙盒中把所有被选中文档的所有选定页面按照顺序合成为高清打印队列，并自动呼出浏览器的标准打印窗口。您可以在弹出的打印面板中自由选择双面打印（长边翻转/短边翻转）、彩色或黑白以及缩放比例。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
