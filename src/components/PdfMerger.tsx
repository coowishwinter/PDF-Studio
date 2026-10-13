import React, { useState, useId } from 'react';
import { FileItem } from '../App';
import { mergePdfs, parsePageRange } from '../lib/pdf-ops';
import { loadPdf } from '../lib/pdf-utils';
import { saveAs } from 'file-saver';
import { Combine, ArrowUp, ArrowDown, Trash2, Plus, Download, Loader2, CheckCircle, FileText, ExternalLink } from 'lucide-react';

interface MergeItem {
  id: string;
  file: File;
  numPages: number;
  pageRange: string;
}

export default function PdfMerger({
  files,
  onAddMergedFile,
  onFilesAdded,
}: {
  files: FileItem[];
  onAddMergedFile: (file: File) => void;
  onFilesAdded: (files: FileList | null) => void;
}) {
  const fileInputId = useId();
  // Initialize merge list with current files
  const [mergeList, setMergeList] = useState<MergeItem[]>(() =>
    files.map(f => ({
      id: f.id,
      file: f.file,
      numPages: f.numPages || 1,
      pageRange: '',
    }))
  );

  const [outputFileName, setOutputFileName] = useState('合并文档.pdf');
  const [isMerging, setIsMerging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  // Sync if new files are added externally
  // Let's allow users to add from current files if they aren't in mergeList
  const addExistingFileToMerge = (fileItem: FileItem) => {
    if (mergeList.some(m => m.id === fileItem.id)) return;
    setMergeList(prev => [
      ...prev,
      {
        id: fileItem.id,
        file: fileItem.file,
        numPages: fileItem.numPages || 1,
        pageRange: '',
      },
    ]);
  };

  const handleLocalFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const uploadedList = e.target.files;
    // Also notify App
    onFilesAdded(uploadedList);

    // Add to merge list
    const newItems: MergeItem[] = [];
    for (let i = 0; i < uploadedList.length; i++) {
      const file = uploadedList[i];
      if (!file.name.toLowerCase().endsWith('.pdf')) continue;
      const id = Math.random().toString(36).substring(7);
      try {
        const proxy = await loadPdf(file);
        newItems.push({
          id,
          file,
          numPages: proxy.numPages,
          pageRange: '',
        });
      } catch (err) {
        newItems.push({
          id,
          file,
          numPages: 1,
          pageRange: '',
        });
      }
    }
    setMergeList(prev => [...prev, ...newItems]);
    e.target.value = '';
  };

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= mergeList.length) return;
    const updated = [...mergeList];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);
    setMergeList(updated);
  };

  const removeItem = (id: string) => {
    setMergeList(prev => prev.filter(item => item.id !== id));
  };

  const updateRange = (id: string, range: string) => {
    setMergeList(prev =>
      prev.map(item => (item.id === id ? { ...item, pageRange: range } : item))
    );
  };

  // Calculate total pages that will be in the merged PDF
  const totalMergedPages = mergeList.reduce((acc, item) => {
    const pages = parsePageRange(item.pageRange, item.numPages);
    return acc + pages.length;
  }, 0);

  const handleStartMerge = async (autoAddToList = false) => {
    if (mergeList.length === 0) {
      alert('请至少添加 1 个 PDF 文档进行合并');
      return;
    }
    if (isMerging) return;

    setIsMerging(true);
    setProgress(0);
    setStatus('准备合并文档...');

    try {
      const mergedBlob = await mergePdfs(
        mergeList.map(item => ({
          file: item.file,
          pageRange: item.pageRange,
        })),
        (p, s) => {
          setProgress(p);
          setStatus(s);
        }
      );

      const finalName = outputFileName.trim().toLowerCase().endsWith('.pdf')
        ? outputFileName.trim()
        : `${outputFileName.trim() || '合并文档'}.pdf`;

      // Save to disk
      saveAs(mergedBlob, finalName);

      // If user wants to open it directly in the app
      if (autoAddToList) {
        const mergedFileObj = new File([mergedBlob], finalName, {
          type: 'application/pdf',
        });
        onAddMergedFile(mergedFileObj);
        setStatus('合并成功！已自动保存并加载至工作台文档列表。');
      } else {
        setStatus('合并成功！文件已开始下载。');
      }
    } catch (err) {
      console.error(err);
      setStatus('合并过程中发生错误，请检查文档是否加密或受损。');
    } finally {
      setIsMerging(false);
      setTimeout(() => {
        if (status.includes('成功')) {
          setStatus('');
          setProgress(0);
        }
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
              <Combine className="w-5 h-5 text-blue-500" />
              PDF 多文档自由合并
            </h2>
            <div className="flex items-center gap-2">
              <label 
                htmlFor={fileInputId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" /> 添加新 PDF
              </label>
              <input
                id={fileInputId}
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={handleLocalFilesUpload}
              />
            </div>
          </div>
          <p className="text-xs text-(--color-text-muted) leading-relaxed">
            将多个 PDF 文件任意排序合并为一个完整的文档。支持针对每一个文件单独指定所需合并的页码范围（如只合并某些章节或单页）。
          </p>
        </div>

        {/* Merge items table / list */}
        <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-(--color-text-main) flex items-center gap-2">
              待合并文件列表 ({mergeList.length})
            </h3>
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              预计合并后总页数: {totalMergedPages} 页
            </span>
          </div>

          {mergeList.length === 0 ? (
            <div className="border border-dashed border-(--color-border-subtle) p-8 rounded-xl text-center text-xs text-(--color-text-muted)">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-30 text-blue-500" />
              暂无待合并文件，请点击上方“添加新 PDF”或在左侧栏导入。
            </div>
          ) : (
            <div className="space-y-2.5">
              {mergeList.map((item, idx) => {
                const effectivePages = parsePageRange(item.pageRange, item.numPages);

                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-lg border border-(--color-border-subtle) bg-(--color-canvas) gap-3 transition-colors"
                  >
                    {/* Index & File info */}
                    <div className="flex items-center gap-3 overflow-hidden flex-1">
                      <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold text-[11px] flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="overflow-hidden">
                        <div className="text-xs font-semibold text-(--color-text-main) truncate max-w-xs md:max-w-md">
                          {item.file.name}
                        </div>
                        <div className="text-[10px] text-(--color-text-muted) flex items-center gap-2 mt-0.5">
                          <span>原文档: {item.numPages} 页</span>
                          <span>•</span>
                          <span>大小: {(item.file.size / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                      </div>
                    </div>

                    {/* Page Range Setting */}
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-(--color-text-muted)">合并页码范围 (默认全部)</span>
                        <input
                          type="text"
                          placeholder={`全部 (1-${item.numPages})`}
                          value={item.pageRange}
                          onChange={(e) => updateRange(item.id, e.target.value)}
                          className="px-2.5 py-1 text-xs font-mono rounded border border-(--color-border-subtle) bg-(--color-panel) text-(--color-text-main) w-36 focus:border-blue-500 outline-none"
                        />
                      </div>
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 rounded shrink-0">
                        贡献 {effectivePages.length} 页
                      </span>
                    </div>

                    {/* Order & Remove actions */}
                    <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                      <button
                        onClick={() => moveItem(idx, 'up')}
                        disabled={idx === 0}
                        className="p-1.5 rounded hover:bg-(--color-bg-hover) disabled:opacity-30 text-(--color-text-main) cursor-pointer"
                        title="上移"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveItem(idx, 'down')}
                        disabled={idx === mergeList.length - 1}
                        className="p-1.5 rounded hover:bg-(--color-bg-hover) disabled:opacity-30 text-(--color-text-main) cursor-pointer"
                        title="下移"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-500 dark:hover:bg-red-950/40 cursor-pointer"
                        title="从合并列表中移除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quick add unselected files */}
          {files.filter(f => !mergeList.some(m => m.id === f.id)).length > 0 && (
            <div className="pt-2 border-t border-(--color-border-subtle) flex items-center gap-2 flex-wrap text-xs">
              <span className="text-(--color-text-muted) text-[11px]">快速追加左侧已有文档:</span>
              {files
                .filter(f => !mergeList.some(m => m.id === f.id))
                .map(f => (
                  <button
                    key={f.id}
                    onClick={() => addExistingFileToMerge(f)}
                    className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-600 text-(--color-text-main) cursor-pointer transition-colors"
                  >
                    + {f.file.name.slice(0, 16)}...
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Output Options and Trigger */}
        <div className="bg-(--color-panel) p-6 rounded-xl border border-(--color-border-subtle) shadow-sm space-y-4">
          <div>
            <label className="text-xs font-bold text-(--color-text-main) block mb-1">
              合并后文件名
            </label>
            <input
              type="text"
              value={outputFileName}
              onChange={(e) => setOutputFileName(e.target.value)}
              className="w-full p-2.5 text-xs rounded-lg border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => handleStartMerge(false)}
              disabled={isMerging || mergeList.length === 0}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg font-semibold text-xs transition-colors disabled:cursor-not-allowed cursor-pointer shadow-md"
            >
              {isMerging ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  正在合并... {progress}%
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  开始合并并直接下载
                </>
              )}
            </button>

            <button
              onClick={() => handleStartMerge(true)}
              disabled={isMerging || mergeList.length === 0}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white p-3 rounded-lg font-semibold text-xs transition-colors disabled:cursor-not-allowed cursor-pointer shadow-md"
            >
              <ExternalLink className="w-4 h-4" />
              合并并加入工作台预览
            </button>
          </div>

          {status && (
            <div className="flex items-center justify-center gap-2 text-xs font-semibold text-center text-blue-600 dark:text-blue-400 pt-2">
              {status.includes('成功') ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{status}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
