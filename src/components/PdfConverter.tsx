import { useState } from 'react';
import { FileItem } from '../App';
import { renderPageToCanvas, canvasToBlob } from '../lib/pdf-utils';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Download, CheckCircle, Loader2, ShieldAlert } from 'lucide-react';

export default function PdfConverter({ fileItem }: { fileItem: FileItem }) {
  const [format, setFormat] = useState('image/png');
  const [scale, setScale] = useState(2.0); // 2.0 is high def
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  const numPages = fileItem.numPages || 0;

  const handleConvert = async () => {
    if (!fileItem.pdfProxy || isConverting) return;
    
    setIsConverting(true);
    setProgress(0);
    setStatus('正在初始化转换任务...');
    
    try {
      const zip = new JSZip();
      const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
      const baseName = fileItem.file.name.replace(/\.pdf$/i, '');
      
      const folderName = `${baseName}_高清图片`;
      const imgFolder = zip.folder(folderName);
      
      if (!imgFolder) throw new Error("无法创建临时的 ZIP 归档文件夹");

      for (let i = 1; i <= numPages; i++) {
        setStatus(`正在渲染第 ${i} / ${numPages} 页...`);
        const { canvas } = await renderPageToCanvas(fileItem.pdfProxy, i, scale);
        
        setStatus(`正在编码封装第 ${i} / ${numPages} 页图片...`);
        const blob = await canvasToBlob(canvas, format, 0.92);
        
        // Ensure padded numbering e.g., 001, 002
        const padLen = numPages.toString().length;
        const paddedIndex = i.toString().padStart(padLen, '0');
        
        imgFolder.file(`page_${paddedIndex}.${ext}`, blob);
        
        setProgress(Math.round((i / numPages) * 100));
      }
      
      setStatus('正在打包并生成下载压缩包...');
      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setStatus(`正在生成 ZIP 压缩包: 已完成 ${Math.round(metadata.percent)}%`);
      });
      
      saveAs(zipBlob, `${folderName}.zip`);
      setStatus('转换成功！');
    } catch (err) {
      console.error(err);
      setStatus('转换过程中不幸发生错误。');
    } finally {
      setIsConverting(false);
      setTimeout(() => {
         if (status === '转换成功！') setStatus('');
         setProgress(0);
      }, 5000);
    }
  };

  return (
    <div className="flex-1 p-8 bg-(--color-canvas) text-(--color-text-main) h-full overflow-y-auto">
      <div className="max-w-xl mx-auto bg-(--color-panel) rounded-xl border border-(--color-border-subtle) shadow-sm p-6 mt-10">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
          <Download className="w-5 h-5 text-blue-500" />
          批量转换文档为图片
        </h2>
        
        <p className="text-(--color-text-muted) mb-8 text-sm leading-relaxed">
          将本地 PDF 文档 <span className="font-semibold text-blue-600 dark:text-blue-400 font-mono text-xs">{fileItem.file.name}</span> 的所有页面转换为高分辨率图片并一键打包下载。所有提取与处理任务完全在您本地浏览器中进行，安全可靠。
        </p>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold mb-2 text-(--color-text-main)">输出图片格式</label>
            <div className="flex gap-4">
              {['image/png', 'image/jpeg', 'image/webp'].map(fmt => {
                const label = fmt === 'image/jpeg' ? 'JPEG (压缩率好)' : fmt === 'image/webp' ? 'WEBP (现代且高效)' : 'PNG (无损画质)';
                return (
                  <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="radio" 
                      name="format" 
                      value={fmt} 
                      checked={format === fmt} 
                      onChange={(e) => setFormat(e.target.value)}
                      className="text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-xs font-semibold">{label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2 text-(--color-text-main)">自定义缩放画质/分辨率</label>
            <select 
              value={scale} 
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="w-full p-2.5 rounded-md border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer text-xs font-semibold"
            >
              <option value={1.0}>1x - 标准流畅画质 (生成极速，适合简单预览)</option>
              <option value={1.5}>1.5x - 高清画质 (细节良好)</option>
              <option value={2.0}>2x - 超高清画质 (推荐，大图高精锐度细节)</option>
              <option value={3.0}>3x - 极佳打印级画质 (精细排版，消耗内存和时间)</option>
            </select>
          </div>

          <button 
            onClick={handleConvert}
            disabled={isConverting}
            className="w-full relative overflow-hidden flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg font-medium transition-colors disabled:cursor-not-allowed cursor-pointer"
          >
            {isConverting && (
              <div 
                className="absolute left-0 top-0 bottom-0 bg-blue-500 opacity-50 z-0 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {isConverting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  正在处理中... {progress}%
                </>
              ) : status === '转换成功！' ? (
                 <>
                   <CheckCircle className="w-5 h-5 text-emerald-300" />
                   已成功打包并保存！
                 </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  开始转换并导出 ZIP 打包
                </>
              )}
            </span>
          </button>
          
          {status && status !== '转换成功！' && (
            <p className="text-xs text-center text-(--color-text-muted) animate-pulse">
              {status}
            </p>
          )}

          <div className="bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 p-4 rounded-lg text-xs border border-amber-200 dark:border-amber-850 flex items-start gap-2 leading-relaxed">
            <ShieldAlert className="w-5 h-5 shrink-0 text-amber-500" />
            <div>
              <strong>隐私与设备性能提示：</strong> 所有 PDF 渲染与解包、编码处理完全运行在您本地电脑的浏览器沙盒中，不会上传到任何服务器。由于全部计算由您的内存及浏览器占用，若 PDF 文件过大，请谨慎使用 3x 超高清，防止浏览器出现偶发性响应慢。建议选择默认 2x 清晰度，速度与画质兼顾。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
