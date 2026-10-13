import { useState, useEffect } from 'react';
import { FileItem } from '../App';
import { renderPageToCanvas } from '../lib/pdf-utils';
import { extractPagesFromPdf, splitPdfToSinglePagesZip, splitPdfByIntervalZip, parsePageRange } from '../lib/pdf-ops';
import { saveAs } from 'file-saver';
import { Scissors, Download, CheckSquare, Square, Layers, Sparkles, Loader2, CheckCircle, FileText } from 'lucide-react';

type SplitMode = 'custom' | 'single' | 'interval';

export default function PdfSplitter({ fileItem }: { fileItem: FileItem }) {
  const [splitMode, setSplitMode] = useState<SplitMode>('custom');
  const [rangeInput, setRangeInput] = useState('1');
  const [intervalPages, setIntervalPages] = useState(2);
  const [selectedPages, setSelectedPages] = useState<number[]>([0]); // 0-indexed
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);

  const totalPages = fileItem.numPages || 1;

  // Initialize page range input and selected pages
  useEffect(() => {
    setSelectedPages([0]);
    setRangeInput(totalPages > 1 ? `1-${Math.min(totalPages, 3)}` : '1');
  }, [fileItem.id, totalPages]);

  // Load small thumbnails for visual selection (render at scale 0.3 for speed)
  useEffect(() => {
    let active = true;
    const loadThumbs = async () => {
      if (!fileItem.pdfProxy) return;
      setLoadingThumbnails(true);
      const thumbs: string[] = [];

      try {
        // Limit thumbnail rendering to up to 60 pages to preserve memory
        const maxThumbsToRender = Math.min(totalPages, 60);
        for (let i = 1; i <= maxThumbsToRender; i++) {
          if (!active) return;
          const { canvas } = await renderPageToCanvas(fileItem.pdfProxy, i, 0.28);
          thumbs.push(canvas.toDataURL('image/jpeg', 0.8));
        }
        if (active) {
          setThumbnails(thumbs);
        }
      } catch (err) {
        console.error("加载缩略图失败:", err);
      } finally {
        if (active) setLoadingThumbnails(false);
      }
    };

    loadThumbs();
    return () => { active = false; };
  }, [fileItem.id, fileItem.pdfProxy, totalPages]);

  // When range input changes in 'custom' mode, sync to selectedPages
  const handleRangeInputChange = (val: string) => {
    setRangeInput(val);
    const parsed = parsePageRange(val, totalPages);
    setSelectedPages(parsed);
  };

  // Toggle single page selection
  const togglePageSelection = (pageIdx: number) => {
    let next: number[];
    if (selectedPages.includes(pageIdx)) {
      next = selectedPages.filter(p => p !== pageIdx);
    } else {
      next = [...selectedPages, pageIdx].sort((a, b) => a - b);
    }
    setSelectedPages(next);

    // Format into range string
    if (next.length === 0) {
      setRangeInput('');
    } else {
      setRangeInput(formatPageNumbers(next.map(p => p + 1)));
    }
  };

  // Helper to format [1,2,3, 5] into "1-3, 5"
  const formatPageNumbers = (nums: number[]): string => {
    if (nums.length === 0) return '';
    nums.sort((a, b) => a - b);
    const ranges: string[] = [];
    let start = nums[0];
    let prev = nums[0];

    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === prev + 1) {
        prev = nums[i];
      } else {
        ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = nums[i];
        prev = nums[i];
      }
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    return ranges.join(', ');
  };

  const selectAll = () => {
    const all = Array.from({ length: totalPages }, (_, i) => i);
    setSelectedPages(all);
    setRangeInput(`1-${totalPages}`);
  };

  const selectOdd = () => {
    const odd = Array.from({ length: totalPages }, (_, i) => i).filter(i => (i + 1) % 2 === 1);
    setSelectedPages(odd);
    setRangeInput(formatPageNumbers(odd.map(p => p + 1)));
  };

  const selectEven = () => {
    const even = Array.from({ length: totalPages }, (_, i) => i).filter(i => (i + 1) % 2 === 0);
    setSelectedPages(even);
    setRangeInput(formatPageNumbers(even.map(p => p + 1)));
  };

  const clearSelection = () => {
    setSelectedPages([]);
    setRangeInput('');
  };

  // Execute Split
  const handleSplit = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setProgress(0);
    setStatus('正在初始化拆分程序...');

    const baseName = fileItem.file.name.replace(/\.pdf$/i, '');

    try {
      if (splitMode === 'custom') {
        const pagesToExtract = selectedPages.length > 0 ? selectedPages : parsePageRange(rangeInput, totalPages);
        if (pagesToExtract.length === 0) {
          alert('请至少选择或输入 1 个有效页码');
          setIsProcessing(false);
          return;
        }

        setStatus(`正在提取选定的 ${pagesToExtract.length} 页...`);
        const extractedBlob = await extractPagesFromPdf(fileItem.file, pagesToExtract);
        const pagesTag = pagesToExtract.length === 1 ? `第${pagesToExtract[0] + 1}页` : `共${pagesToExtract.length}页`;
        saveAs(extractedBlob, `${baseName}_提取(${pagesTag}).pdf`);
        setStatus('拆分提取成功！已开始下载。');
      } else if (splitMode === 'single') {
        const zipBlob = await splitPdfToSinglePagesZip(fileItem.file, (p, s) => {
          setProgress(p);
          setStatus(s);
        });
        saveAs(zipBlob, `${baseName}_单页拆分包.zip`);
        setStatus('拆分完成！已保存为 ZIP 压缩包。');
      } else if (splitMode === 'interval') {
        const zipBlob = await splitPdfByIntervalZip(fileItem.file, intervalPages, (p, s) => {
          setProgress(p);
          setStatus(s);
        });
        saveAs(zipBlob, `${baseName}_每${intervalPages}页分卷包.zip`);
        setStatus('分卷拆分完成！已保存为 ZIP 压缩包。');
      }
    } catch (err) {
      console.error(err);
      setStatus('拆分过程中出现异常，请确认文件未损坏');
    } finally {
      setIsProcessing(false);
      setTimeout(() => {
        if (status.includes('成功') || status.includes('完成')) {
          setStatus('');
          setProgress(0);
        }
      }, 5000);
    }
  };

  return (
    <div className="flex-1 p-6 md:p-8 bg-(--color-canvas) text-(--color-text-main) h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold flex items-center gap-2 text-(--color-text-main)">
              <Scissors className="w-5 h-5 text-blue-500" />
              PDF 文档拆分与提取
            </h2>
            <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-semibold">
              当前文档: {totalPages} 页
            </span>
          </div>
          <p className="text-xs text-(--color-text-muted) leading-relaxed">
            支持按页码范围自定义提取、拆分为每页独立文档、或按固定页数间隔分卷打包。全流程在浏览器中高速执行，无需上传服务器。
          </p>

          {/* Mode Selector */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
            <button
              onClick={() => setSplitMode('custom')}
              className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all ${splitMode === 'custom' ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500' : 'border-(--color-border-subtle) hover:bg-(--color-bg-hover) text-(--color-text-main)'}`}
            >
              <div className="font-semibold text-xs flex items-center gap-1.5 mb-1">
                <Scissors className="w-3.5 h-3.5" /> 自定义页码提取
              </div>
              <p className="text-[11px] text-(--color-text-muted)">
                自由输入页码范围或在下方缩略图中点选，合并导出为一个新 PDF
              </p>
            </button>

            <button
              onClick={() => setSplitMode('single')}
              className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all ${splitMode === 'single' ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500' : 'border-(--color-border-subtle) hover:bg-(--color-bg-hover) text-(--color-text-main)'}`}
            >
              <div className="font-semibold text-xs flex items-center gap-1.5 mb-1">
                <Layers className="w-3.5 h-3.5" /> 拆分为单页独立文件
              </div>
              <p className="text-[11px] text-(--color-text-muted)">
                将文档的每一页拆分为单独的 PDF 文件，并一键打包为 ZIP 下载
              </p>
            </button>

            <button
              onClick={() => setSplitMode('interval')}
              className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all ${splitMode === 'interval' ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500' : 'border-(--color-border-subtle) hover:bg-(--color-bg-hover) text-(--color-text-main)'}`}
            >
              <div className="font-semibold text-xs flex items-center gap-1.5 mb-1">
                <Sparkles className="w-3.5 h-3.5" /> 按固定页数分卷
              </div>
              <p className="text-[11px] text-(--color-text-muted)">
                例如每 2 页、5 页自动分卷切分为一个子 PDF，自动归档 ZIP
              </p>
            </button>
          </div>
        </div>

        {/* Mode Specific Settings */}
        {splitMode === 'custom' && (
          <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <label className="text-xs font-bold text-(--color-text-main) block mb-1">
                  提取页码范围 (如: 1-3, 5, 8 或在下方点击页面)
                </label>
                <div className="text-[11px] text-(--color-text-muted)">
                  已选中 <span className="font-bold text-blue-600 dark:text-blue-400">{selectedPages.length}</span> / {totalPages} 页
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={selectAll}
                  className="px-2.5 py-1 text-[11px] font-medium rounded border border-(--color-border-subtle) hover:bg-(--color-bg-hover) cursor-pointer"
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={selectOdd}
                  className="px-2.5 py-1 text-[11px] font-medium rounded border border-(--color-border-subtle) hover:bg-(--color-bg-hover) cursor-pointer"
                >
                  仅奇数页
                </button>
                <button
                  type="button"
                  onClick={selectEven}
                  className="px-2.5 py-1 text-[11px] font-medium rounded border border-(--color-border-subtle) hover:bg-(--color-bg-hover) cursor-pointer"
                >
                  仅偶数页
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="px-2.5 py-1 text-[11px] font-medium rounded border border-(--color-border-subtle) hover:bg-(--color-bg-hover) text-red-500 cursor-pointer"
                >
                  清空
                </button>
              </div>
            </div>

            <input
              type="text"
              value={rangeInput}
              onChange={(e) => handleRangeInputChange(e.target.value)}
              placeholder="例如: 1-3, 5 或 1, 2, 4"
              className="w-full p-2.5 text-xs font-mono rounded-lg border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />

            {/* Visual Page Thumbnails Grid */}
            <div className="pt-2">
              <div className="text-xs font-semibold mb-2.5 text-(--color-text-muted) flex items-center justify-between">
                <span>可视化页面选板</span>
                {loadingThumbnails && (
                  <span className="text-[10px] text-blue-500 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> 加载页面预览中...
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5 max-h-72 overflow-y-auto p-2 bg-(--color-canvas) rounded-lg border border-(--color-border-subtle) custom-scrollbar">
                {Array.from({ length: totalPages }).map((_, idx) => {
                  const isChecked = selectedPages.includes(idx);
                  const thumb = thumbnails[idx];

                  return (
                    <div
                      key={idx}
                      onClick={() => togglePageSelection(idx)}
                      className={`relative group rounded border cursor-pointer p-1 transition-all flex flex-col items-center justify-between bg-white dark:bg-slate-900 ${isChecked ? 'border-blue-500 ring-2 ring-blue-500/50 shadow-sm' : 'border-gray-200 dark:border-gray-800 opacity-60 hover:opacity-100'}`}
                    >
                      {/* Checkbox indicator */}
                      <div className="absolute top-1.5 right-1.5 z-10">
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 bg-white dark:bg-slate-900 rounded" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-400 group-hover:text-gray-600 rounded" />
                        )}
                      </div>

                      {/* Thumbnail or placeholder */}
                      <div className="w-full aspect-3/4 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center overflow-hidden mb-1">
                        {thumb ? (
                          <img src={thumb} alt={`Page ${idx + 1}`} className="w-full h-full object-contain" />
                        ) : (
                          <FileText className="w-6 h-6 text-gray-300 dark:text-gray-600" />
                        )}
                      </div>

                      <span className="text-[10px] font-semibold text-(--color-text-main)">
                        第 {idx + 1} 页
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {splitMode === 'single' && (
          <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-(--color-text-main)">单页提取说明</h3>
            <p className="text-xs text-(--color-text-muted) leading-relaxed">
              系统将把当前文档（共 {totalPages} 页）的每一页，单独生成一个名为 <code className="bg-(--color-canvas) px-1 py-0.5 rounded text-blue-600 font-mono">第XXX页.pdf</code> 的文件，并自动压缩为 ZIP 打包归档方便批量管理。
            </p>
          </div>
        )}

        {splitMode === 'interval' && (
          <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-(--color-text-main)">设置分卷间隔</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-(--color-text-muted)">每个子文档包含页数:</span>
              <input
                type="number"
                min={1}
                max={Math.max(1, totalPages)}
                value={intervalPages}
                onChange={(e) => setIntervalPages(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 p-2 text-xs font-semibold rounded-lg border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) text-center focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
              <span className="text-xs text-(--color-text-muted)">页</span>
            </div>
            <p className="text-[11px] text-(--color-text-muted)">
              文档共 {totalPages} 页，将拆分为约 {Math.ceil(totalPages / intervalPages)} 个子文件。
            </p>
          </div>
        )}

        {/* Action Button */}
        <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm space-y-3">
          <button
            onClick={handleSplit}
            disabled={isProcessing}
            className="w-full relative overflow-hidden flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg font-medium transition-colors disabled:cursor-not-allowed cursor-pointer shadow-md"
          >
            {isProcessing && (
              <div
                className="absolute left-0 top-0 bottom-0 bg-blue-500 opacity-50 z-0 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2 text-xs font-semibold">
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  正在处理拆分... {progress > 0 ? `${progress}%` : ''}
                </>
              ) : status.includes('成功') || status.includes('完成') ? (
                <>
                  <CheckCircle className="w-4 h-4 text-emerald-300" />
                  {status}
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  {splitMode === 'custom' ? `开始提取选中的 ${selectedPages.length} 页 PDF` : splitMode === 'single' ? `开始拆解并导出单页 ZIP 压缩包` : `开始分卷拆分并导出 ZIP 压缩包`}
                </>
              )}
            </span>
          </button>

          {status && (
            <p className="text-xs text-center text-(--color-text-muted) animate-pulse font-medium">
              {status}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
