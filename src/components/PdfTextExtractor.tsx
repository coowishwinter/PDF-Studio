import { useState, useEffect } from 'react';
import { FileItem } from '../App';
import { extractTextFromPdf } from '../lib/pdf-utils';
import { Copy, CheckCircle, Loader2 } from 'lucide-react';

export default function PdfTextExtractor({ fileItem }: { fileItem: FileItem }) {
  const [text, setText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setText('');
    setCopied(false);

    const extract = async () => {
      if (!fileItem.pdfProxy) return;
      setIsExtracting(true);
      try {
        const fullText = await extractTextFromPdf(fileItem.pdfProxy);
        if (active) {
          if (!fullText.trim()) {
            setText("未能检测到可编辑文本字符。如果该 PDF 文档是由纸张直接扫描而来的图片页面，可能需要使用专业的带 OCR 自动文字识别系统的工具。");
          } else {
            setText(fullText);
          }
        }
      } catch (err) {
        if (active) setText("提取文字失败，或该文档受加密保护或不包含数字文本编码。若是纯扫描文档，请在此处转换为图片，然后使用本地 OCR 识别。");
      } finally {
        if (active) setIsExtracting(false);
      }
    };

    extract();
    return () => { active = false; };
  }, [fileItem]);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-(--color-canvas)">
      <div className="flex items-center justify-between p-3 border-b border-(--color-border-subtle) bg-(--color-panel) shrink-0">
        <h3 className="font-semibold text-xs text-(--color-text-main)">提取到的文本大纲</h3>
        <button 
          onClick={handleCopy}
          disabled={!text || isExtracting}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold cursor-pointer bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {copied ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? '已复制到剪贴板' : '一键复制文本'}
        </button>
      </div>
      
      <div className="flex-1 p-4 relative">
        {isExtracting && (
          <div className="absolute inset-0 z-10 bg-(--color-canvas)/80 flex flex-col items-center justify-center text-(--color-text-muted)">
            <Loader2 className="w-8 h-8 animate-spin mb-2 text-blue-500" />
            <p className="text-xs">正在深度解析 PDF 字符布局，请稍后...</p>
          </div>
        )}
        <textarea
          value={text}
          readOnly
          className="w-full h-full p-4 rounded-lg bg-(--color-panel) text-(--color-text-main) border border-(--color-border-subtle) outline-none focus:ring-2 focus:ring-blue-500 font-sans text-xs leading-relaxed resize-none custom-scrollbar shadow-inner"
          placeholder="提取出的可编辑文字内容将呈现于此..."
        />
      </div>
    </div>
  );
}
