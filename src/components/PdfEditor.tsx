import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { saveAs } from 'file-saver';
import { PDFDocument } from 'pdf-lib';
import {
  MousePointer2, Type, Image as ImageIcon, Highlighter, Square, Eraser, Crop, Scan,
  Undo2, Redo2, Download, ZoomIn, ZoomOut, RotateCw, RotateCcw, Trash2,
  ArrowUp, ArrowDown, Plus, Loader2, Bold, FileText, Layers, CheckCircle, X,
} from 'lucide-react';
import { FileItem } from '../App';
import { renderPageToCanvas } from '../lib/pdf-utils';
import {
  createDefaultState, displaySize, exportEditedPdf, measureTextBlock,
  renderTextToCanvas, fontString,
  type EditPage, type EditOverlay, type EditorState, type OverlayType,
  type WatermarkConfig, type PageNumberConfig, type CropRect,
} from '../lib/pdf-editor';

/* --------------------------------- 基础工具 -------------------------------- */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const uid = () => Math.random().toString(36).slice(2, 10);
const normalizeAngle = (value: number) => {
  let angle = value % 360;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
  return angle;
};

type Tool = 'select' | OverlayType | 'extract';

type PendingImage = { dataUrl: string; mime: string; width: number; height: number };

const TOOL_HINTS: Record<Tool, string> = {
  select: '点击选中元素拖动移动；图片可点左上角剪刀或双击裁剪，顶部圆点旋转。',
  text: '在页面上点击即可插入文字，输入完成后点击空白处确认。',
  image: '已选择图片，点击页面即可放置。',
  highlight: '在页面上拖拽绘制高亮区域（不拖拽则生成默认大小）。',
  rect: '在页面上拖拽绘制矩形边框。',
  whiteout: '在页面上拖拽涂抹掉指定区域（白色覆盖）。',
  extract: '在页面上框选 PDF 中原有的图片/内容，转为可裁剪的图片图层（区域内文字会一并栅格化）。',
};

const TOOL_META: { key: Tool; label: string; icon: any }[] = [
  { key: 'select', label: '选择', icon: MousePointer2 },
  { key: 'text', label: '文字', icon: Type },
  { key: 'image', label: '图片/签名', icon: ImageIcon },
  { key: 'extract', label: '剪裁原图', icon: Scan },
  { key: 'highlight', label: '高亮', icon: Highlighter },
  { key: 'rect', label: '矩形', icon: Square },
  { key: 'whiteout', label: '涂白', icon: Eraser },
];

const PANEL_BTN =
  'flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-(--color-border-subtle) bg-(--color-panel) text-[11px] font-semibold text-(--color-text-main) hover:bg-(--color-bg-hover) disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-colors';

function shapeDefaults(type: OverlayType): Partial<EditOverlay> {
  if (type === 'highlight') return { color: '#fde047', opacity: 0.35 };
  if (type === 'rect') return { color: '#2563eb', opacity: 1, strokeWidth: 2 };
  if (type === 'whiteout') return { color: '#ffffff', opacity: 1 };
  return {};
}

/* --------------------------------- 页面画布 -------------------------------- */

function PageCanvas({
  pdfProxy, srcIndex, rotation, zoom, dpr,
}: {
  pdfProxy: any;
  srcIndex: number | null;
  rotation: number;
  zoom: number;
  dpr: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '800px' }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || srcIndex === null || !pdfProxy) return;
    let active = true;
    setRendering(true);
    (async () => {
      try {
        const { canvas } = await renderPageToCanvas(pdfProxy, srcIndex + 1, zoom * dpr, rotation);
        if (!active) return;
        const target = canvasRef.current;
        if (!target) return;
        target.width = canvas.width;
        target.height = canvas.height;
        const ctx = target.getContext('2d');
        if (ctx) ctx.drawImage(canvas, 0, 0);
      } catch (error) {
        console.error('渲染 PDF 页面失败:', error);
      } finally {
        if (active) setRendering(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [visible, pdfProxy, srcIndex, rotation, zoom, dpr]);

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden bg-white">
      <canvas ref={canvasRef} className="block w-full h-full pointer-events-none" />
      {rendering && !canvasRef.current?.width && (
        <div className="absolute inset-0 flex items-center justify-center bg-white">
          <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------- 文字元素渲染 ------------------------------- */

function TextBlockCanvas({
  overlay, pageWidthPts, zoom, dpr,
}: {
  overlay: EditOverlay;
  pageWidthPts: number;
  zoom: number;
  dpr: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const text = overlay.text ?? '';
  const fontSize = overlay.fontSize ?? 16;
  const widthPts = Math.max(8, overlay.width * pageWidthPts);

  useEffect(() => {
    const rendered = renderTextToCanvas({
      text: text || ' ',
      fontSize,
      widthPts,
      bold: overlay.bold,
      color: overlay.color ?? '#111827',
      scale: zoom * dpr,
    });
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = rendered.canvas.width;
    canvas.height = rendered.canvas.height;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(rendered.canvas, 0, 0);
  }, [text, fontSize, widthPts, overlay.bold, overlay.color, zoom, dpr]);

  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-full pointer-events-none"
      style={{ opacity: overlay.opacity ?? 1 }}
    />
  );
}

/* --------------------------------- 图片渲染 -------------------------------- */

function ImageOverlayView({ overlay }: { overlay: EditOverlay }) {
  const crop = overlay.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const rotation = overlay.rotation ?? 0;

  return (
    <div
      className="w-full h-full pointer-events-none"
      style={{
        transform: 'rotate(' + rotation + 'deg)',
        transformOrigin: 'center',
        opacity: overlay.opacity ?? 1,
      }}
    >
      <div className="relative w-full h-full overflow-hidden">
        <img
          src={overlay.dataUrl}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: -(crop.x / crop.w) * 100 + '%',
            top: -(crop.y / crop.h) * 100 + '%',
            width: 100 / crop.w + '%',
            height: 100 / crop.h + '%',
            objectFit: 'fill',
            maxWidth: 'none',
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------- 行内文字编辑 ------------------------------- */

function InlineTextEditor({
  overlay, zoom, onChange, onBlur,
}: {
  overlay: EditOverlay;
  zoom: number;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // 延后聚焦：避免浏览器在 pointerdown 默认行为中把焦点移走，导致刚插入的文字立即失焦被删除
    const timer = window.setTimeout(() => {
      const element = ref.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }, 160);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <textarea
      ref={ref}
      value={overlay.text ?? ''}
      onPointerDown={event => event.stopPropagation()}
      onChange={event => onChange(event.target.value)}
      onBlur={onBlur}
      spellCheck={false}
      className="block w-full h-full resize-none outline-none bg-white/85"
      style={{
        font: fontString((overlay.fontSize ?? 16) * zoom, overlay.bold),
        color: overlay.color ?? '#111827',
        lineHeight: 1.35,
        padding: 0,
        border: '1px dashed #2563eb',
        overflow: 'hidden',
      }}
    />
  );
}

/* --------------------------------- 裁剪弹窗 -------------------------------- */

type CropMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

function CropDialog({
  overlay,
  onCancel,
  onApply,
}: {
  overlay: EditOverlay;
  onCancel: () => void;
  onApply: (crop: CropRect) => void;
}) {
  const [crop, setCrop] = useState<CropRect>(overlay.crop ?? { x: 0, y: 0, w: 1, h: 1 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: CropMode;
    startX: number;
    startY: number;
    origin: CropRect;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setNatural({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    };
    image.src = overlay.dataUrl || '';
    return () => {
      active = false;
    };
  }, [overlay.dataUrl]);

  const MAX_WIDTH = 620;
  const MAX_HEIGHT = 430;
  const scale =
    natural.width > 0
      ? Math.min(MAX_WIDTH / natural.width, MAX_HEIGHT / natural.height)
      : 0;
  const displayWidth = Math.max(140, Math.round(natural.width * scale));
  const displayHeight = Math.max(100, Math.round(natural.height * scale));

  const pointFromEvent = (event: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const begin = (event: React.PointerEvent, mode: CropMode) => {
    event.stopPropagation();
    event.preventDefault();
    dragRef.current = {
      mode,
      startX: pointFromEvent(event).x,
      startY: pointFromEvent(event).y,
      origin: crop,
    };
    try {
      containerRef.current?.setPointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
  };

  const move = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointFromEvent(event);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    const origin = drag.origin;
    const MIN = 0.06;

    if (drag.mode === 'move') {
      setCrop({
        x: clamp(origin.x + dx, 0, 1 - origin.w),
        y: clamp(origin.y + dy, 0, 1 - origin.h),
        w: origin.w,
        h: origin.h,
      });
      return;
    }

    let left = origin.x;
    let top = origin.y;
    let right = origin.x + origin.w;
    let bottom = origin.y + origin.h;

    if (drag.mode.includes('w')) left = clamp(origin.x + dx, 0, right - MIN);
    if (drag.mode.includes('e')) right = clamp(origin.x + origin.w + dx, left + MIN, 1);
    if (drag.mode.includes('n')) top = clamp(origin.y + dy, 0, bottom - MIN);
    if (drag.mode.includes('s')) bottom = clamp(origin.y + origin.h + dy, top + MIN, 1);

    setCrop({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const end = (event: React.PointerEvent) => {
    dragRef.current = null;
    try {
      containerRef.current?.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
  };

  const handles: { mode: CropMode; style: React.CSSProperties }[] = [
    { mode: 'nw', style: { left: -7, top: -7, cursor: 'nwse-resize' } },
    { mode: 'ne', style: { right: -7, top: -7, cursor: 'nesw-resize' } },
    { mode: 'sw', style: { left: -7, bottom: -7, cursor: 'nesw-resize' } },
    { mode: 'se', style: { right: -7, bottom: -7, cursor: 'nwse-resize' } },
    { mode: 'n', style: { left: '50%', top: -7, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
    { mode: 's', style: { left: '50%', bottom: -7, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
    { mode: 'w', style: { top: '50%', left: -7, transform: 'translateY(-50%)', cursor: 'ew-resize' } },
    { mode: 'e', style: { top: '50%', right: -7, transform: 'translateY(-50%)', cursor: 'ew-resize' } },
  ];

  const updateEdge = (edge: 'left' | 'top' | 'right' | 'bottom', percent: number) => {
    const value = clamp(percent, 0, 100) / 100;
    const MIN = 0.04;
    const right = crop.x + crop.w;
    const bottom = crop.y + crop.h;
    if (edge === 'left') {
      const x = Math.min(value, right - MIN);
      setCrop({ ...crop, x, w: right - x });
      return;
    }
    if (edge === 'top') {
      const y = Math.min(value, bottom - MIN);
      setCrop({ ...crop, y, h: bottom - y });
      return;
    }
    if (edge === 'right') {
      setCrop({ ...crop, w: Math.max(value, crop.x + MIN) - crop.x });
      return;
    }
    setCrop({ ...crop, h: Math.max(value, crop.y + MIN) - crop.y });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div className="bg-(--color-panel) border border-(--color-border-subtle) rounded-xl shadow-2xl p-4 max-w-[95vw] max-h-[92vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-(--color-text-main) flex items-center gap-2">
            <Crop className="w-4 h-4 text-blue-500" /> 剪裁图片
          </h3>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-(--color-bg-hover) text-(--color-text-muted) cursor-pointer"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          ref={containerRef}
          className="relative mx-auto bg-black/5 overflow-hidden rounded-md select-none touch-none"
          style={{ width: displayWidth, height: displayHeight }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <img
            src={overlay.dataUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ objectFit: 'fill' }}
          />
          <div
            className="absolute border-2 border-blue-500"
            style={{
              left: crop.x * 100 + '%',
              top: crop.y * 100 + '%',
              width: crop.w * 100 + '%',
              height: crop.h * 100 + '%',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
              cursor: 'move',
            }}
            onPointerDown={event => begin(event, 'move')}
          >
            {handles.map(handle => (
              <div
                key={handle.mode}
                onPointerDown={event => begin(event, handle.mode)}
                className="absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-sm"
                style={handle.style}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 mt-3">
          {([
            ['left', '左 %'],
            ['top', '上 %'],
            ['right', '右 %'],
            ['bottom', '下 %'],
          ] as const).map(([edge, label]) => {
            const current =
              edge === 'left'
                ? crop.x
                : edge === 'top'
                  ? crop.y
                  : edge === 'right'
                    ? crop.x + crop.w
                    : crop.y + crop.h;
            return (
              <label key={edge} className="flex flex-col gap-1 text-[10px] text-(--color-text-muted)">
                {label}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(current * 100)}
                  onChange={event => updateEdge(edge, parseInt(event.target.value, 10) || 0)}
                  className="w-full p-1.5 text-xs text-center rounded-md border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) outline-none focus:border-blue-500"
                />
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-4 mt-3">
          <span className="text-[11px] text-(--color-text-muted)">
            拖动框内移动，拖动四角或四边调整裁剪范围，也可直接输入百分比
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCrop({ x: 0, y: 0, w: 1, h: 1 })}
              className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-(--color-border-subtle) text-(--color-text-muted) hover:bg-(--color-bg-hover) cursor-pointer"
            >
              重置
            </button>
            <button
              onClick={onCancel}
              className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-(--color-border-subtle) text-(--color-text-main) hover:bg-(--color-bg-hover) cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={() => onApply(crop)}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white shadow-sm cursor-pointer"
            >
              应用裁剪
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- 单页卡片 -------------------------------- */

type DragState =
  | { kind: 'create'; id: string; start: { x: number; y: number } }
  | { kind: 'move'; id: string; start: { x: number; y: number }; originX: number; originY: number }
  | { kind: 'resize'; id: string; start: { x: number; y: number }; originX: number; originY: number }
  | {
      kind: 'rotate';
      id: string;
      startAngle: number;
      originRotation: number;
      centerX: number;
      centerY: number;
    }
  | { kind: 'extract'; start: { x: number; y: number } };

function PageCard({
  page, index, total, zoom, dpr, pdfProxy, tool, overlays,
  selectedId, editingId, pendingImage, active, watermark, pageNumber,
  isFirst, isLast,
  onActivate, onSelectOverlay, onBeginEdit, onEndEdit, onAddOverlay,
  onUpdateOverlay, onPatchText, onGestureStart, onPageOps, onToolChange,
  onConsumePendingImage, onRequestCrop, onRemoveOverlay, onExtractImage,
}: {
  key?: React.Key;
  page: EditPage;
  index: number;
  total: number;
  zoom: number;
  dpr: number;
  pdfProxy: any;
  tool: Tool;
  overlays: EditOverlay[];
  selectedId: string | null;
  editingId: string | null;
  pendingImage: PendingImage | null;
  active: boolean;
  watermark: WatermarkConfig;
  pageNumber: PageNumberConfig;
  isFirst: boolean;
  isLast: boolean;
  onActivate: () => void;
  onSelectOverlay: (id: string | null) => void;
  onBeginEdit: (id: string) => void;
  onEndEdit: () => void;
  onAddOverlay: (overlay: EditOverlay) => void;
  onUpdateOverlay: (id: string, patch: Partial<EditOverlay>) => void;
  onPatchText: (id: string, patch: Partial<EditOverlay>) => void;
  onGestureStart: () => void;
  onPageOps: (action: 'rotate-cw' | 'rotate-ccw' | 'delete' | 'up' | 'down' | 'insert') => void;
  onToolChange: (tool: Tool) => void;
  onConsumePendingImage: () => void;
  onRequestCrop: (id: string) => void;
  onRemoveOverlay: (id: string) => void;
  onExtractImage: (rect: { x: number; y: number; w: number; h: number }) => void;
}) {
  const dims = displaySize(page);
  const pageWidthPx = dims.width * zoom;
  const pageHeightPx = dims.height * zoom;

  const pageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [extractRect, setExtractRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const pointFromEvent = (event: React.PointerEvent) => {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const capture = (event: React.PointerEvent) => {
    try {
      pageRef.current?.setPointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
  };

  const release = (event: React.PointerEvent) => {
    try {
      pageRef.current?.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
  };

  const handlePagePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    onActivate();
    const point = pointFromEvent(event);

    if (tool === 'select') {
      onSelectOverlay(null);
      return;
    }

    if (tool === 'extract') {
      dragRef.current = { kind: 'extract', start: point };
      setExtractRect({ x: point.x, y: point.y, w: 0, h: 0 });
      capture(event);
      return;
    }

    if (tool === 'text') {
      const fontSize = 16;
      const width = 0.45;
      const widthPts = width * dims.width;
      const height = measureTextBlock('', fontSize, widthPts).height / dims.height;
      const id = uid();
      onAddOverlay({
        id,
        pageUid: page.uid,
        type: 'text',
        x: clamp(point.x, 0, 1 - width),
        y: clamp(point.y, 0, 1 - height),
        width,
        height,
        text: '',
        fontSize,
        bold: false,
        color: '#111827',
        opacity: 1,
      });
      onSelectOverlay(id);
      onBeginEdit(id);
      onToolChange('select');
      return;
    }

    if (tool === 'image') {
      if (!pendingImage) return;
      const ratio = pendingImage.height / pendingImage.width;
      let width = 0.35;
      let height = (width * dims.width * ratio) / dims.height;
      if (height > 0.92) {
        height = 0.92;
        width = (height * dims.height) / (ratio * dims.width);
      }
      const id = uid();
      onAddOverlay({
        id,
        pageUid: page.uid,
        type: 'image',
        x: clamp(point.x, 0, 1 - width),
        y: clamp(point.y, 0, 1 - height),
        width,
        height,
        dataUrl: pendingImage.dataUrl,
        mime: pendingImage.mime,
        opacity: 1,
        rotation: 0,
        crop: { x: 0, y: 0, w: 1, h: 1 },
        naturalWidth: pendingImage.width,
        naturalHeight: pendingImage.height,
      });
      onSelectOverlay(id);
      onConsumePendingImage();
      onToolChange('select');
      return;
    }

    // 形状：拖拽创建（创建动作本身会记录一次历史，拖拽过程不再重复记录）
    const id = uid();
    onAddOverlay({
      id,
      pageUid: page.uid,
      type: tool,
      x: point.x,
      y: point.y,
      width: 0.001,
      height: 0.001,
      ...shapeDefaults(tool),
    });
    onSelectOverlay(id);
    dragRef.current = { kind: 'create', id, start: point };
    capture(event);
  };

  const handlePagePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointFromEvent(event);

    if (drag.kind === 'extract') {
      setExtractRect({
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        w: Math.abs(point.x - drag.start.x),
        h: Math.abs(point.y - drag.start.y),
      });
      return;
    }

    const overlay = overlays.find(item => item.id === drag.id);
    if (!overlay) return;

    if (drag.kind === 'rotate') {
      const rect = pageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const angle =
        (Math.atan2(
          event.clientY - rect.top - drag.centerY,
          event.clientX - rect.left - drag.centerX
        ) *
          180) /
        Math.PI;
      let rotation = drag.originRotation + (angle - drag.startAngle);
      rotation = normalizeAngle(rotation);
      const step = event.shiftKey ? 15 : 90;
      const snapped = Math.round(rotation / step) * step;
      if (Math.abs(rotation - snapped) <= (event.shiftKey ? 2 : 4)) rotation = snapped;
      onUpdateOverlay(drag.id, { rotation });
      return;
    }

    if (drag.kind === 'create') {
      onUpdateOverlay(drag.id, {
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        width: Math.abs(point.x - drag.start.x),
        height: Math.abs(point.y - drag.start.y),
      });
      return;
    }

    if (drag.kind === 'move') {
      onUpdateOverlay(drag.id, {
        x: clamp(drag.originX + (point.x - drag.start.x), 0, 1 - overlay.width),
        y: clamp(drag.originY + (point.y - drag.start.y), 0, 1 - overlay.height),
      });
      return;
    }

    const width = clamp(point.x - overlay.x, 0.03, 1 - overlay.x);
    const height = clamp(point.y - overlay.y, 0.02, 1 - overlay.y);
    if (overlay.type === 'text') {
      onPatchText(overlay.id, { width });
    } else {
      onUpdateOverlay(overlay.id, { width, height });
    }
  };

  const handlePagePointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    release(event);

    if (drag.kind === 'extract') {
      const point = pointFromEvent(event);
      const rect = {
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        w: Math.abs(point.x - drag.start.x),
        h: Math.abs(point.y - drag.start.y),
      };
      setExtractRect(null);
      if (rect.w > 0.01 && rect.h > 0.01) onExtractImage(rect);
      return;
    }

    if (drag.kind === 'create') {
      const overlay = overlays.find(item => item.id === drag.id);
      if (!overlay) return;
      if (overlay.width < 0.01 || overlay.height < 0.008) {
        const defaultWidth = 0.2;
        const defaultHeight = overlay.type === 'highlight' ? 0.035 : 0.08;
        onUpdateOverlay(overlay.id, {
          x: clamp(overlay.x, 0, 1 - defaultWidth),
          y: clamp(overlay.y, 0, 1 - defaultHeight),
          width: defaultWidth,
          height: defaultHeight,
        });
      }
    }
  };

  const handleOverlayPointerDown = (event: React.PointerEvent, overlay: EditOverlay) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onActivate();
    onSelectOverlay(overlay.id);
    if (tool !== 'select') return;
    // 文字元素：再次点击已选中的文字直接进入编辑，避免与拖动手势冲突
    if (overlay.type === 'text' && selectedId === overlay.id) {
      onBeginEdit(overlay.id);
      return;
    }
    onGestureStart();
    dragRef.current = {
      kind: 'move',
      id: overlay.id,
      start: pointFromEvent(event),
      originX: overlay.x,
      originY: overlay.y,
    };
    capture(event);
  };

  const handleRotatePointerDown = (event: React.PointerEvent, overlay: EditOverlay) => {
    event.stopPropagation();
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = (overlay.x + overlay.width / 2) * rect.width;
    const centerY = (overlay.y + overlay.height / 2) * rect.height;
    const angle =
      (Math.atan2(event.clientY - rect.top - centerY, event.clientX - rect.left - centerX) * 180) /
      Math.PI;
    onActivate();
    onSelectOverlay(overlay.id);
    onGestureStart();
    dragRef.current = {
      kind: 'rotate',
      id: overlay.id,
      startAngle: angle,
      originRotation: overlay.rotation ?? 0,
      centerX,
      centerY,
    };
    capture(event);
  };

  const handleResizePointerDown = (event: React.PointerEvent, overlay: EditOverlay) => {
    event.stopPropagation();
    onActivate();
    onSelectOverlay(overlay.id);
    onGestureStart();
    dragRef.current = {
      kind: 'resize',
      id: overlay.id,
      start: pointFromEvent(event),
      originX: overlay.x,
      originY: overlay.y,
    };
    capture(event);
  };

  const watermarkSize =
    watermark.size > 0 ? watermark.size : Math.max(18, Math.min(dims.width, dims.height) * 0.07);
  const pageNumberLabel = pageNumber.format
    .replace(/\{n\}/g, String(pageNumber.start + index))
    .replace(/\{total\}/g, String(total));

  return (
    <div className="flex flex-col shrink-0">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <button
          onClick={onActivate}
          className={clsx(
            'text-[11px] font-semibold transition-colors cursor-pointer',
            active ? 'text-blue-600 dark:text-blue-400' : 'text-(--color-text-muted) hover:text-(--color-text-main)'
          )}
        >
          第 {index + 1} / {total} 页
        </button>
        <div className="flex items-center gap-0.5">
          <PageOpButton title="上移一页" disabled={isFirst} onClick={() => onPageOps('up')}>
            <ArrowUp className="w-3.5 h-3.5" />
          </PageOpButton>
          <PageOpButton title="下移一页" disabled={isLast} onClick={() => onPageOps('down')}>
            <ArrowDown className="w-3.5 h-3.5" />
          </PageOpButton>
          <PageOpButton title="向左旋转 90°" onClick={() => onPageOps('rotate-ccw')}>
            <RotateCcw className="w-3.5 h-3.5" />
          </PageOpButton>
          <PageOpButton title="向右旋转 90°" onClick={() => onPageOps('rotate-cw')}>
            <RotateCw className="w-3.5 h-3.5" />
          </PageOpButton>
          <PageOpButton title="在此页后插入空白页" onClick={() => onPageOps('insert')}>
            <Plus className="w-3.5 h-3.5" />
          </PageOpButton>
          <PageOpButton title="删除此页" danger onClick={() => onPageOps('delete')}>
            <Trash2 className="w-3.5 h-3.5" />
          </PageOpButton>
        </div>
      </div>

      <div
        ref={pageRef}
        data-page-index={index}
        onPointerDown={handlePagePointerDown}
        onPointerMove={handlePagePointerMove}
        onPointerUp={handlePagePointerUp}
        onPointerCancel={handlePagePointerUp}
        className={clsx(
          'relative bg-white shadow-lg select-none touch-none',
          active ? 'ring-2 ring-blue-500/70' : 'ring-1 ring-black/5'
        )}
        style={{ width: pageWidthPx, height: pageHeightPx, cursor: tool === 'select' ? 'default' : 'crosshair' }}
      >
        {page.srcIndex === null ? (
          <div className="absolute inset-0 bg-white" />
        ) : (
          <PageCanvas
            pdfProxy={pdfProxy}
            srcIndex={page.srcIndex}
            rotation={dims.rotation}
            zoom={zoom}
            dpr={dpr}
          />
        )}

        {overlays.map(overlay => {
          const isSelected = overlay.id === selectedId;
          const isEditing = overlay.id === editingId;
          const blockHeightPts =
            overlay.type === 'text'
              ? measureTextBlock(
                  overlay.text ?? '',
                  overlay.fontSize ?? 16,
                  Math.max(8, overlay.width * dims.width),
                  overlay.bold
                ).height
              : overlay.height * dims.height;
          const boxStyle: React.CSSProperties = {
            position: 'absolute',
            left: overlay.x * pageWidthPx,
            top: overlay.y * pageHeightPx,
            width: overlay.width * pageWidthPx,
            height: (overlay.type === 'text' ? blockHeightPts * zoom : overlay.height * pageHeightPx),
          };

          return (
            <div
              key={overlay.id}
              style={boxStyle}
              onPointerDown={event => handleOverlayPointerDown(event, overlay)}
              onDoubleClick={event => {
                if (overlay.type === 'text') {
                  event.stopPropagation();
                  onBeginEdit(overlay.id);
                  return;
                }
                if (overlay.type === 'image') {
                  event.stopPropagation();
                  onRequestCrop(overlay.id);
                }
              }}
              className={clsx(
                'group',
                tool === 'select' ? 'cursor-move' : 'cursor-default',
                isSelected && 'outline outline-2 outline-blue-500 outline-offset-1'
              )}
              title={overlay.type === 'text' ? '双击编辑文字' : undefined}
            >
              {overlay.type === 'text' &&
                (isEditing ? (
                  <InlineTextEditor
                    overlay={overlay}
                    zoom={zoom}
                    onChange={value => onPatchText(overlay.id, { text: value })}
                    onBlur={onEndEdit}
                  />
                ) : (
                  <TextBlockCanvas
                    overlay={overlay}
                    pageWidthPts={dims.width}
                    zoom={zoom}
                    dpr={dpr}
                  />
                ))}

              {overlay.type === 'image' && overlay.dataUrl && (
                <ImageOverlayView overlay={overlay} />
              )}

              {(overlay.type === 'highlight' || overlay.type === 'whiteout' || overlay.type === 'rect') && (
                <div
                  className="w-full h-full pointer-events-none"
                  style={
                    overlay.type === 'rect'
                      ? {
                          border: String(overlay.strokeWidth ?? 2) + 'px solid ' + (overlay.color ?? '#2563eb'),
                          opacity: overlay.opacity ?? 1,
                          background: 'transparent',
                        }
                      : {
                          background: overlay.color ?? '#fde047',
                          opacity: overlay.opacity ?? (overlay.type === 'highlight' ? 0.35 : 1),
                        }
                  }
                />
              )}

              {isSelected && tool === 'select' && !isEditing && overlay.type === 'image' && (
                <div
                  className="absolute -left-2 -top-2 flex items-center gap-0.5"
                  onPointerDown={event => event.stopPropagation()}
                >
                  <button
                    onClick={event => {
                      event.stopPropagation();
                      onRequestCrop(overlay.id);
                    }}
                    className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow"
                    title="剪裁图片"
                  >
                    <Crop className="w-3 h-3" />
                  </button>
                  <button
                    onClick={event => {
                      event.stopPropagation();
                      onRemoveOverlay(overlay.id);
                    }}
                    className="w-6 h-6 rounded-full bg-white border border-(--color-border-subtle) text-red-500 flex items-center justify-center shadow"
                    title="删除图片"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}

              {isSelected && tool === 'select' && !isEditing && overlay.type === 'image' && (
                <div
                  onPointerDown={event => handleRotatePointerDown(event, overlay)}
                  className="absolute left-1/2 -top-7 -translate-x-1/2 w-6 h-6 rounded-full bg-white border-2 border-blue-500 flex items-center justify-center cursor-grab shadow-sm"
                  title="拖动旋转（按住 Shift 以 15° 吸附）"
                >
                  <RotateCw className="w-3 h-3 text-blue-600" />
                </div>
              )}

              {isSelected && tool === 'select' && !isEditing && (
                <div
                  onPointerDown={event => handleResizePointerDown(event, overlay)}
                  className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-nwse-resize"
                  title="拖动调整大小"
                />
              )}
            </div>
          );
        })}

        {extractRect && extractRect.w > 0.002 && extractRect.h > 0.002 && (
          <div
            className="absolute border-2 border-dashed border-blue-500 bg-blue-500/10 pointer-events-none"
            style={{
              left: extractRect.x * pageWidthPx,
              top: extractRect.y * pageHeightPx,
              width: extractRect.w * pageWidthPx,
              height: extractRect.h * pageHeightPx,
            }}
          />
        )}

        {watermark.enabled && watermark.text.trim() && (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
            <div
              style={{
                transform: 'rotate(-45deg)',
                fontSize: watermarkSize * zoom,
                color: watermark.color,
                opacity: watermark.opacity,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {watermark.text}
            </div>
          </div>
        )}

        {pageNumber.enabled && pageNumberLabel.trim() && (
          <div className="absolute left-0 right-0 pointer-events-none" style={{ bottom: 24 * zoom }}>
            <div
              style={{
                fontSize: pageNumber.fontSize * zoom,
                color: pageNumber.color,
                textAlign:
                  pageNumber.position === 'bottom-left'
                    ? 'left'
                    : pageNumber.position === 'bottom-right'
                      ? 'right'
                      : 'center',
                paddingLeft: pageNumber.position === 'bottom-left' ? 24 * zoom : 0,
                paddingRight: pageNumber.position === 'bottom-right' ? 24 * zoom : 0,
              }}
            >
              {pageNumberLabel}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PageOpButton({
  children, title, onClick, disabled, danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'p-1 rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed',
        danger
          ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
          : 'text-(--color-text-muted) hover:text-(--color-text-main) hover:bg-(--color-bg-hover)'
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------- 主编辑器 -------------------------------- */

export default function PdfEditor({ fileItem }: { fileItem: FileItem }) {
  const [state, setState] = useState<EditorState>(createDefaultState);
  const stateRef = useRef(state);
  const pastRef = useRef<EditorState[]>([]);
  const futureRef = useRef<EditorState[]>([]);
  const [, forceRender] = useState(0);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(1);
  const [activePageUid, setActivePageUid] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [imageError, setImageError] = useState('');
  const [extracting, setExtracting] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

  const apply = useCallback((updater: (current: EditorState) => EditorState, record = true) => {
    const previous = stateRef.current;
    if (record) {
      pastRef.current = [...pastRef.current.slice(-49), previous];
      futureRef.current = [];
    }
    const next = updater(previous);
    stateRef.current = next;
    setState(next);
    forceRender(value => value + 1);
  }, []);

  const pushHistory = useCallback(() => {
    pastRef.current = [...pastRef.current.slice(-49), stateRef.current];
    futureRef.current = [];
    forceRender(value => value + 1);
  }, []);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current = [...futureRef.current, stateRef.current];
    stateRef.current = previous;
    setState(previous);
    setSelectedId(null);
    setEditingId(null);
    forceRender(value => value + 1);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current = [...pastRef.current, stateRef.current];
    stateRef.current = next;
    setState(next);
    setSelectedId(null);
    setEditingId(null);
    forceRender(value => value + 1);
  }, []);

  // 载入文档：从 pdf-lib 读取每页尺寸与原始旋转角
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    (async () => {
      if (!fileItem.pdfProxy) return;
      try {
        const bytes = await fileItem.file.arrayBuffer();
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages: EditPage[] = doc.getPages().map((page, index) => {
          const angle = page.getRotation().angle;
          return {
            uid: 'page-' + index + '-' + Math.random().toString(36).slice(2, 7),
            srcIndex: index,
            rotation: ((angle % 360) + 360) % 360,
            rotDelta: 0,
            width: page.getWidth(),
            height: page.getHeight(),
          };
        });
        if (!active) return;
        const next: EditorState = { ...createDefaultState(), pages };
        stateRef.current = next;
        pastRef.current = [];
        futureRef.current = [];
        setState(next);
        setActivePageUid(pages[0]?.uid ?? null);
        setSelectedId(null);
        setEditingId(null);
        setTool('select');
      } catch (error: any) {
        console.error('载入编辑文档失败:', error);
        if (active) setLoadError(error?.message || '解析 PDF 文档失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fileItem.id, fileItem.pdfProxy]);

  const addOverlay = useCallback((overlay: EditOverlay) => {
    apply(current => ({ ...current, overlays: [...current.overlays, overlay] }));
  }, [apply]);

  const addOverlays = useCallback((items: EditOverlay[]) => {
    apply(current => ({ ...current, overlays: [...current.overlays, ...items] }));
  }, [apply]);

  const updateOverlay = useCallback((id: string, patch: Partial<EditOverlay>) => {
    apply(current => ({
      ...current,
      overlays: current.overlays.map(item => (item.id === id ? { ...item, ...patch } : item)),
    }), false);
  }, [apply]);

  const patchText = useCallback((id: string, patch: Partial<EditOverlay>) => {
    apply(current => {
      const overlay = current.overlays.find(item => item.id === id);
      if (!overlay) return current;
      const page = current.pages.find(item => item.uid === overlay.pageUid);
      const next = { ...overlay, ...patch };
      if (page) {
        const dims = displaySize(page);
        const widthPts = Math.max(8, next.width * dims.width);
        const block = measureTextBlock(
          next.text ?? '',
          next.fontSize ?? 16,
          widthPts,
          next.bold
        );
        next.height = block.height / dims.height;
      }
      return {
        ...current,
        overlays: current.overlays.map(item => (item.id === id ? next : item)),
      };
    }, false);
  }, [apply]);

  const removeOverlay = useCallback((id: string) => {
    apply(current => ({
      ...current,
      overlays: current.overlays.filter(item => item.id !== id),
    }));
    setSelectedId(null);
    setEditingId(null);
    setCropTargetId(current => (current === id ? null : current));
  }, [apply]);

  const applyCrop = useCallback((id: string, crop: CropRect) => {
    apply(current => {
      const overlay = current.overlays.find(item => item.id === id);
      if (!overlay) return current;
      const page = current.pages.find(item => item.uid === overlay.pageUid);
      const next: EditOverlay = { ...overlay, crop };

      if (overlay.trueCrop) {
        // 页面取图：保持原始内容和比例，按裁剪区域“就地”缩放外框
        const previous = overlay.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        const fullWidth = overlay.width / Math.max(0.0001, previous.w);
        const fullHeight = overlay.height / Math.max(0.0001, previous.h);
        const fullX = overlay.x - previous.x * fullWidth;
        const fullY = overlay.y - previous.y * fullHeight;
        next.x = clamp(fullX + crop.x * fullWidth, 0, 1);
        next.y = clamp(fullY + crop.y * fullHeight, 0, 1);
        next.width = Math.max(0.003, Math.min(1 - next.x, crop.w * fullWidth));
        next.height = Math.max(0.003, Math.min(1 - next.y, crop.h * fullHeight));
      } else if (page && overlay.naturalWidth && overlay.naturalHeight) {
        // 普通插入图片：外框大小不变，裁剪内容拉伸填满，保持宽高比
        const dims = displaySize(page);
        const widthPts = overlay.width * dims.width;
        const croppedAspect =
          (overlay.naturalWidth * crop.w) / (overlay.naturalHeight * crop.h);
        const heightPts = widthPts / croppedAspect;
        next.height = Math.min(0.98, heightPts / dims.height);
        next.y = Math.min(overlay.y, Math.max(0, 1 - next.height));
      }

      return {
        ...current,
        overlays: current.overlays.map(item => (item.id === id ? next : item)),
      };
    });
    setCropTargetId(null);
  }, [apply]);

  // 在页面上框选一块区域，渲染成高分辨率图片，并用同色矩形覆盖原区域，形成可继续裁剪/旋转/移动的图片图层
  const extractImageFromPage = useCallback(async (
    page: EditPage,
    rect: { x: number; y: number; w: number; h: number }
  ) => {
    if (!fileItem.pdfProxy || page.srcIndex === null) return;
    setExtracting(true);
    setStatus('正在从页面取图...');
    try {
      const dims = displaySize(page);
      const scale = Math.min(4, 4000 / Math.max(dims.width, dims.height));
      const { canvas } = await renderPageToCanvas(
        fileItem.pdfProxy,
        page.srcIndex + 1,
        scale,
        dims.rotation
      );

      const clamped = {
        x: clamp(rect.x, 0, 1),
        y: clamp(rect.y, 0, 1),
        w: clamp(rect.w, 0.005, 1 - clamp(rect.x, 0, 1)),
        h: clamp(rect.h, 0.005, 1 - clamp(rect.y, 0, 1)),
      };
      const sx = Math.round(clamped.x * canvas.width);
      const sy = Math.round(clamped.y * canvas.height);
      const sw = Math.max(1, Math.round(clamped.w * canvas.width));
      const sh = Math.max(1, Math.round(clamped.h * canvas.height));

      const cropped = document.createElement('canvas');
      cropped.width = sw;
      cropped.height = sh;
      const ctx = cropped.getContext('2d');
      if (!ctx) throw new Error('无法创建取图画布');
      ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const dataUrl = cropped.toDataURL('image/png');

      // 取页面角落颜色作为覆盖色（适配非纯白背景）
      let coverColor = '#ffffff';
      const pageCtx = canvas.getContext('2d');
      if (pageCtx) {
        const point = pageCtx.getImageData(
          Math.min(3, canvas.width - 1),
          Math.min(3, canvas.height - 1),
          1,
          1
        ).data;
        if (point[3] > 128) {
          coverColor =
            '#' +
            [point[0], point[1], point[2]]
              .map(value => value.toString(16).padStart(2, '0'))
              .join('');
        }
      }

      const cover: EditOverlay = {
        id: uid(),
        pageUid: page.uid,
        type: 'whiteout',
        x: clamped.x,
        y: clamped.y,
        width: clamped.w,
        height: clamped.h,
        color: coverColor,
        opacity: 1,
      };
      const image: EditOverlay = {
        id: uid(),
        pageUid: page.uid,
        type: 'image',
        x: clamped.x,
        y: clamped.y,
        width: clamped.w,
        height: clamped.h,
        dataUrl,
        mime: 'image/png',
        opacity: 1,
        rotation: 0,
        crop: { x: 0, y: 0, w: 1, h: 1 },
        naturalWidth: sw,
        naturalHeight: sh,
        trueCrop: true,
        fromPage: true,
      };

      addOverlays([cover, image]);
      setSelectedId(image.id);
      setTool('select');
      setStatus('已取图：可点左上角剪刀或双击图片继续裁剪');
    } catch (error: any) {
      console.error('页面取图失败:', error);
      setStatus('取图失败：' + (error?.message || '未知错误'));
    } finally {
      setExtracting(false);
    }
  }, [fileItem.pdfProxy, addOverlays]);

  const endEdit = useCallback(() => {
    const id = editingId;
    setEditingId(null);
    if (!id) return;
    const overlay = stateRef.current.overlays.find(item => item.id === id);
    if (overlay && overlay.type === 'text' && !(overlay.text || '').trim()) {
      removeOverlay(id);
    }
  }, [editingId, removeOverlay]);

  const mutatePage = useCallback((pageUid: string, mutator: (page: EditPage) => EditPage) => {
    apply(current => ({
      ...current,
      pages: current.pages.map(page => (page.uid === pageUid ? mutator(page) : page)),
    }));
  }, [apply]);

  const rotatePage = useCallback((pageUid: string, delta: number) => {
    mutatePage(pageUid, page => ({ ...page, rotDelta: page.rotDelta + delta }));
  }, [mutatePage]);

  const deletePage = useCallback((pageUid: string) => {
    if (stateRef.current.pages.length <= 1) return;
    apply(current => {
      const index = current.pages.findIndex(page => page.uid === pageUid);
      const pages = current.pages.filter(page => page.uid !== pageUid);
      return {
        ...current,
        pages,
        overlays: current.overlays.filter(overlay => overlay.pageUid !== pageUid),
      };
    });
    const currentPages = stateRef.current.pages;
    setActivePageUid(currentPages[0]?.uid ?? null);
    setSelectedId(null);
    setEditingId(null);
  }, [apply]);

  const movePage = useCallback((pageUid: string, direction: -1 | 1) => {
    apply(current => {
      const index = current.pages.findIndex(page => page.uid === pageUid);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.pages.length) return current;
      const pages = [...current.pages];
      const [moved] = pages.splice(index, 1);
      pages.splice(target, 0, moved);
      return { ...current, pages };
    });
  }, [apply]);

  const insertBlankAfter = useCallback((pageUid: string) => {
    apply(current => {
      const index = current.pages.findIndex(page => page.uid === pageUid);
      const source = current.pages[index] ?? current.pages[current.pages.length - 1];
      const blank: EditPage = {
        uid: 'blank-' + uid(),
        srcIndex: null,
        rotation: 0,
        rotDelta: 0,
        width: source?.width ?? 595,
        height: source?.height ?? 842,
      };
      const pages = [...current.pages];
      pages.splice(Math.max(0, index) + 1, 0, blank);
      return { ...current, pages };
    });
  }, [apply]);

  const handlePageOps = useCallback((
    pageUid: string,
    action: 'rotate-cw' | 'rotate-ccw' | 'delete' | 'up' | 'down' | 'insert'
  ) => {
    if (action === 'rotate-cw') rotatePage(pageUid, 90);
    else if (action === 'rotate-ccw') rotatePage(pageUid, -90);
    else if (action === 'delete') deletePage(pageUid);
    else if (action === 'up') movePage(pageUid, -1);
    else if (action === 'down') movePage(pageUid, 1);
    else if (action === 'insert') insertBlankAfter(pageUid);
  }, [rotatePage, deletePage, movePage, insertBlankAfter]);

  // 键盘快捷键
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && !typing) {
        event.preventDefault();
        removeOverlay(selectedId);
        return;
      }
      if (
        selectedId &&
        !typing &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        const overlay = stateRef.current.overlays.find(item => item.id === selectedId);
        if (overlay) {
          event.preventDefault();
          const step = event.shiftKey ? 0.02 : 0.004;
          const deltaX = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const deltaY = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          updateOverlay(overlay.id, {
            x: clamp(overlay.x + deltaX, 0, 1 - overlay.width),
            y: clamp(overlay.y + deltaY, 0, 1 - overlay.height),
          });
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === 'Escape') {
        if (cropTargetId) {
          setCropTargetId(null);
          return;
        }
        setSelectedId(null);
        setEditingId(null);
        setTool('select');
        setPendingImage(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedId, removeOverlay, redo, undo, updateOverlay, cropTargetId]);

  // 图片读取
  const handleImageFile = async (file: File | undefined | null) => {
    if (!file) return;
    setImageError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('无法解析该图片'));
        img.src = dataUrl;
      });
      const mime = file.type || '';
      let finalDataUrl = dataUrl;
      let finalMime = mime;
      if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/jpg') {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || 1;
        canvas.height = image.naturalHeight || 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法处理该图片');
        ctx.drawImage(image, 0, 0);
        finalDataUrl = canvas.toDataURL('image/png');
        finalMime = 'image/png';
      }
      setPendingImage({
        dataUrl: finalDataUrl,
        mime: finalMime,
        width: image.naturalWidth || 1,
        height: image.naturalHeight || 1,
      });
      setTool('image');
    } catch (error: any) {
      setImageError(error?.message || '图片处理失败');
    }
  };

  const handleExport = async () => {
    if (exporting || !state.pages.length) return;
    setExporting(true);
    setProgress(0);
    setStatus('正在准备导出...');
    try {
      const blob = await exportEditedPdf(fileItem.file, stateRef.current, (percent, message) => {
        setProgress(percent);
        setStatus(message);
      });
      const baseName = fileItem.file.name.replace(/\.pdf$/i, '');
      saveAs(blob, baseName + '_已编辑.pdf');
      setStatus('导出成功，已开始下载');
    } catch (error: any) {
      console.error('导出失败:', error);
      setStatus('导出失败：' + (error?.message || '未知错误'));
    } finally {
      setExporting(false);
    }
  };

  const resetAll = () => {
    if (!window.confirm('确定要清空所有编辑内容（文字、图形、水印等）吗？')) return;
    apply(current => ({
      ...createDefaultState(),
      pages: current.pages.map(page => ({ ...page, rotDelta: 0 })),
    }));
    setSelectedId(null);
    setEditingId(null);
  };

  const selectedOverlay = state.overlays.find(item => item.id === selectedId) || null;
  const cropTarget = state.overlays.find(item => item.id === cropTargetId) || null;
  const activePage = state.pages.find(page => page.uid === activePageUid) || state.pages[0] || null;
  const activePageIndex = activePage ? state.pages.findIndex(page => page.uid === activePage.uid) : -1;

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-(--color-text-muted) gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <div className="text-xs animate-pulse">正在解析文档结构，准备编辑器...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-(--color-text-muted) gap-3 p-8 text-center">
        <FileText className="w-10 h-10 text-red-400" />
        <div className="text-sm font-semibold text-red-500">无法打开该文档进行编辑</div>
        <div className="text-xs">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 工具栏 */}
        <div className="border-b border-(--color-border-subtle) bg-(--color-panel) px-3 py-2 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {TOOL_META.map(item => {
              const Icon = item.icon;
              const isActive = tool === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    if (item.key === 'image') {
                      setTool('image');
                      if (!pendingImage) imageInputRef.current?.click();
                      return;
                    }
                    setTool(item.key);
                    setPendingImage(null);
                    if (item.key !== 'select') setEditingId(null);
                  }}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer',
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main)'
                  )}
                  title={item.label}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}

            <div className="w-px h-5 bg-(--color-border-subtle) mx-1" />

            <button
              onClick={undo}
              disabled={pastRef.current.length === 0}
              className="p-1.5 rounded-md text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main) disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title="撤销 (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={redo}
              disabled={futureRef.current.length === 0}
              className="p-1.5 rounded-md text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main) disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title="重做 (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </button>

            <div className="w-px h-5 bg-(--color-border-subtle) mx-1" />

            <button
              onClick={() => setZoom(value => Math.max(0.4, Math.round((value - 0.1) * 10) / 10))}
              className="p-1.5 rounded-md text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main) cursor-pointer"
              title="缩小"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-semibold w-10 text-center text-(--color-text-muted)">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(value => Math.min(2.5, Math.round((value + 0.1) * 10) / 10))}
              className="p-1.5 rounded-md text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main) cursor-pointer"
              title="放大"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="flex-1" />

            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {exporting ? '导出中 ' + progress + '%' : '导出 PDF'}
            </button>
          </div>

          <div className="mt-1.5 text-[11px] text-(--color-text-muted) flex items-center gap-2">
            <Layers className="w-3 h-3 shrink-0" />
            <span>
              {tool === 'image' && !pendingImage
                ? '点击「图片/签名」从本地选择图片，选择后再点击页面放置。'
                : TOOL_HINTS[tool]}
            </span>
            {imageError && <span className="text-red-500">· {imageError}</span>}
          </div>

          {status && (
            <div className="mt-1.5 text-[11px] flex items-center gap-1.5 text-(--color-text-muted)">
              {status.includes('成功') ? (
                <CheckCircle className="w-3 h-3 text-emerald-500" />
              ) : (
                <Loader2 className={clsx('w-3 h-3 text-blue-500', exporting && 'animate-spin')} />
              )}
              <span>{status}</span>
            </div>
          )}
        </div>

        {/* 页面列表 */}
        <div className="flex-1 overflow-auto p-6 bg-(--color-canvas) custom-scrollbar">
          <div className="flex flex-col items-center gap-6">
            {state.pages.map((page, index) => (
              <PageCard
                key={page.uid}
                page={page}
                index={index}
                total={state.pages.length}
                zoom={zoom}
                dpr={dpr}
                pdfProxy={fileItem.pdfProxy}
                tool={tool}
                overlays={state.overlays.filter(overlay => overlay.pageUid === page.uid)}
                selectedId={selectedId}
                editingId={editingId}
                pendingImage={pendingImage}
                active={activePage?.uid === page.uid}
                watermark={state.watermark}
                pageNumber={state.pageNumber}
                isFirst={index === 0}
                isLast={index === state.pages.length - 1}
                onActivate={() => setActivePageUid(page.uid)}
                onSelectOverlay={setSelectedId}
                onBeginEdit={id => {
                  setSelectedId(id);
                  setEditingId(id);
                }}
                onEndEdit={endEdit}
                onAddOverlay={addOverlay}
                onUpdateOverlay={updateOverlay}
                onPatchText={patchText}
                onGestureStart={pushHistory}
                onPageOps={action => handlePageOps(page.uid, action)}
                onToolChange={setTool}
                onConsumePendingImage={() => setPendingImage(null)}
                onRequestCrop={setCropTargetId}
                onRemoveOverlay={removeOverlay}
                onExtractImage={rect => extractImageFromPage(page, rect)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 右侧属性面板 */}
      <aside className="w-72 shrink-0 border-l border-(--color-border-subtle) bg-(--color-panel) overflow-y-auto custom-scrollbar">
        <div className="p-3 space-y-4">
          <section>
            <h3 className="text-[11px] font-bold text-(--color-text-muted) uppercase tracking-wider mb-2">
              选中元素
            </h3>
            {!selectedOverlay && (
              <div className="text-[11px] text-(--color-text-muted) leading-relaxed bg-(--color-canvas) border border-dashed border-(--color-border-subtle) rounded-lg p-3">
                使用上方工具在页面上添加文字、图片或标记；点击已有元素可调整属性。
              </div>
            )}

            {selectedOverlay && (
              <div className="space-y-2.5 bg-(--color-canvas) border border-(--color-border-subtle) rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-(--color-text-main)">
                    {selectedOverlay.type === 'text'
                      ? '文字'
                      : selectedOverlay.type === 'image'
                        ? '图片 / 签名'
                        : selectedOverlay.type === 'highlight'
                          ? '高亮'
                          : selectedOverlay.type === 'rect'
                            ? '矩形'
                            : '涂白'}
                  </span>
                  <button
                    onClick={() => removeOverlay(selectedOverlay.id)}
                    className="text-red-500 hover:text-red-600 text-[11px] font-semibold cursor-pointer"
                  >
                    删除
                  </button>
                </div>

                {selectedOverlay.type === 'text' && (
                  <>
                    <textarea
                      value={selectedOverlay.text ?? ''}
                      onChange={event => patchText(selectedOverlay.id, { text: event.target.value })}
                      rows={3}
                      placeholder="输入文字内容..."
                      className="w-full p-2 text-xs rounded-md border border-(--color-border-subtle) bg-(--color-panel) text-(--color-text-main) outline-none focus:border-blue-500 resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-(--color-text-muted) w-12 shrink-0">字号</label>
                      <input
                        type="number"
                        min={8}
                        max={96}
                        value={selectedOverlay.fontSize ?? 16}
                        onChange={event => patchText(selectedOverlay.id, { fontSize: Math.max(8, parseInt(event.target.value, 10) || 16) })}
                        className="flex-1 p-1.5 text-xs rounded-md border border-(--color-border-subtle) bg-(--color-panel) text-(--color-text-main) outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={() => patchText(selectedOverlay.id, { bold: !selectedOverlay.bold })}
                        className={clsx(
                          'p-1.5 rounded-md border cursor-pointer transition-colors',
                          selectedOverlay.bold
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-(--color-border-subtle) text-(--color-text-muted) hover:text-(--color-text-main)'
                        )}
                        title="加粗"
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}

                {(selectedOverlay.type === 'text' || selectedOverlay.type === 'rect') && (
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-(--color-text-muted) w-12 shrink-0">颜色</label>
                    <input
                      type="color"
                      value={selectedOverlay.color ?? '#111827'}
                      onChange={event =>
                        selectedOverlay.type === 'text'
                          ? patchText(selectedOverlay.id, { color: event.target.value })
                          : updateOverlay(selectedOverlay.id, { color: event.target.value })
                      }
                      className="w-8 h-7 p-0 border border-(--color-border-subtle) rounded cursor-pointer bg-transparent"
                    />
                    {selectedOverlay.type === 'rect' && (
                      <>
                        <label className="text-[11px] text-(--color-text-muted)">线宽</label>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={selectedOverlay.strokeWidth ?? 2}
                          onChange={event => updateOverlay(selectedOverlay.id, { strokeWidth: Math.max(1, parseInt(event.target.value, 10) || 2) })}
                          className="w-14 p-1 text-xs rounded-md border border-(--color-border-subtle) bg-(--color-panel) text-(--color-text-main) outline-none"
                        />
                      </>
                    )}
                  </div>
                )}

                {(selectedOverlay.type === 'highlight' || selectedOverlay.type === 'whiteout') && (
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-(--color-text-muted) w-12 shrink-0">颜色</label>
                    <input
                      type="color"
                      value={selectedOverlay.color ?? '#fde047'}
                      onChange={event => updateOverlay(selectedOverlay.id, { color: event.target.value })}
                      className="w-8 h-7 p-0 border border-(--color-border-subtle) rounded cursor-pointer bg-transparent"
                    />
                  </div>
                )}

                {selectedOverlay.type !== 'rect' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-(--color-text-muted)">不透明度</label>
                      <span className="text-[11px] font-mono text-(--color-text-muted)">
                        {Math.round((selectedOverlay.opacity ?? 1) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={selectedOverlay.opacity ?? 1}
                      onChange={event => updateOverlay(selectedOverlay.id, { opacity: parseFloat(event.target.value) })}
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                  </div>
                )}

                {selectedOverlay.type === 'image' && (
                  <div className="space-y-2 pt-2 border-t border-(--color-border-subtle)">
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-(--color-text-muted) w-12 shrink-0">旋转</label>
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        value={Math.round(selectedOverlay.rotation ?? 0)}
                        onChange={event =>
                          updateOverlay(selectedOverlay.id, {
                            rotation: normalizeAngle(parseInt(event.target.value, 10) || 0),
                          })
                        }
                        className="flex-1 p-1.5 text-xs rounded-md border border-(--color-border-subtle) bg-(--color-panel) text-(--color-text-main) outline-none focus:border-blue-500"
                      />
                      <span className="text-[10px] text-(--color-text-muted)">°</span>
                    </div>

                    <div className="flex gap-1.5">
                      <button
                        onClick={() =>
                          updateOverlay(selectedOverlay.id, {
                            rotation: normalizeAngle((selectedOverlay.rotation ?? 0) - 90),
                          })
                        }
                        className={clsx(PANEL_BTN, 'flex-1')}
                        title="逆时针旋转 90°"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> -90°
                      </button>
                      <button
                        onClick={() =>
                          updateOverlay(selectedOverlay.id, {
                            rotation: normalizeAngle((selectedOverlay.rotation ?? 0) + 90),
                          })
                        }
                        className={clsx(PANEL_BTN, 'flex-1')}
                        title="顺时针旋转 90°"
                      >
                        <RotateCw className="w-3.5 h-3.5" /> +90°
                      </button>
                      <button
                        onClick={() => updateOverlay(selectedOverlay.id, { rotation: 0 })}
                        className={clsx(PANEL_BTN, 'flex-1')}
                        title="重置旋转"
                      >
                        重置
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => setCropTargetId(selectedOverlay.id)}
                        className={PANEL_BTN}
                      >
                        <Crop className="w-3.5 h-3.5" /> 剪裁
                      </button>
                      <button
                        onClick={() =>
                          updateOverlay(selectedOverlay.id, { crop: { x: 0, y: 0, w: 1, h: 1 } })
                        }
                        className={PANEL_BTN}
                        disabled={
                          !selectedOverlay.crop ||
                          (selectedOverlay.crop.x <= 0.001 &&
                            selectedOverlay.crop.y <= 0.001 &&
                            selectedOverlay.crop.w >= 0.999 &&
                            selectedOverlay.crop.h >= 0.999)
                        }
                        title="恢复完整图片"
                      >
                        重置剪裁
                      </button>
                    </div>

                    {selectedOverlay.fromPage && (
                      <p className="text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
                        来自「剪裁原图」页面取图，区域内文字已栅格化。
                      </p>
                    )}

                    <p className="text-[10px] leading-relaxed text-(--color-text-muted)">
                      拖动图片可移动，方向键微调位置；右下角手柄缩放，顶部圆形手柄旋转。
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-[11px] font-bold text-(--color-text-muted) uppercase tracking-wider mb-2">
              页面
            </h3>
            <div className="bg-(--color-canvas) border border-(--color-border-subtle) rounded-lg p-3 space-y-2">
              {activePage ? (
                <>
                  <div className="flex items-center justify-between text-[11px] text-(--color-text-muted)">
                    <span>第 {activePageIndex + 1} / {state.pages.length} 页</span>
                    <span className="font-mono">
                      {Math.round(displaySize(activePage).width)} × {Math.round(displaySize(activePage).height)} pt
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={() => rotatePage(activePage.uid, -90)} className={PANEL_BTN}>
                      <RotateCcw className="w-3.5 h-3.5" /> 左转
                    </button>
                    <button onClick={() => rotatePage(activePage.uid, 90)} className={PANEL_BTN}>
                      <RotateCw className="w-3.5 h-3.5" /> 右转
                    </button>
                    <button onClick={() => movePage(activePage.uid, -1)} disabled={activePageIndex <= 0} className={PANEL_BTN}>
                      <ArrowUp className="w-3.5 h-3.5" /> 上移
                    </button>
                    <button onClick={() => movePage(activePage.uid, 1)} disabled={activePageIndex >= state.pages.length - 1} className={PANEL_BTN}>
                      <ArrowDown className="w-3.5 h-3.5" /> 下移
                    </button>
                    <button onClick={() => insertBlankAfter(activePage.uid)} className={PANEL_BTN}>
                      <Plus className="w-3.5 h-3.5" /> 插空白页
                    </button>
                    <button
                      onClick={() => deletePage(activePage.uid)}
                      disabled={state.pages.length <= 1}
                      className={clsx(PANEL_BTN, 'text-red-500 hover:text-red-600')}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> 删除页
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-(--color-text-muted)">暂无页面</div>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold text-(--color-text-muted) uppercase tracking-wider">
                水印
              </h3>
              <input
                type="checkbox"
                checked={state.watermark.enabled}
                onChange={event => apply(current => ({
                  ...current,
                  watermark: { ...current.watermark, enabled: event.target.checked },
                }))}
                className="accent-blue-600 cursor-pointer"
              />
            </div>
            <div className={clsx('space-y-2', !state.watermark.enabled && 'opacity-60')}>
              <input
                type="text"
                value={state.watermark.text}
                onChange={event => apply(current => ({
                  ...current,
                  watermark: { ...current.watermark, text: event.target.value },
                }), false)}
                placeholder="水印文字"
                className="w-full p-2 text-xs rounded-md border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) outline-none focus:border-blue-500"
              />
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={state.watermark.color}
                  onChange={event => apply(current => ({
                    ...current,
                    watermark: { ...current.watermark, color: event.target.value },
                  }), false)}
                  className="w-8 h-7 p-0 border border-(--color-border-subtle) rounded cursor-pointer bg-transparent"
                />
                <div className="flex-1">
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={state.watermark.opacity}
                    onChange={event => apply(current => ({
                      ...current,
                      watermark: { ...current.watermark, opacity: parseFloat(event.target.value) },
                    }), false)}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>
                <span className="text-[10px] font-mono text-(--color-text-muted) w-8 text-right">
                  {Math.round(state.watermark.opacity * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-(--color-text-muted) shrink-0">字号</label>
                <input
                  type="number"
                  min={0}
                  max={160}
                  value={state.watermark.size}
                  onChange={event => apply(current => ({
                    ...current,
                    watermark: { ...current.watermark, size: Math.max(0, parseInt(event.target.value, 10) || 0) },
                  }), false)}
                  className="w-16 p-1.5 text-xs rounded-md border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) outline-none"
                />
                <span className="text-[10px] text-(--color-text-muted)">0 = 自动</span>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold text-(--color-text-muted) uppercase tracking-wider">
                页码
              </h3>
              <input
                type="checkbox"
                checked={state.pageNumber.enabled}
                onChange={event => apply(current => ({
                  ...current,
                  pageNumber: { ...current.pageNumber, enabled: event.target.checked },
                }))}
                className="accent-blue-600 cursor-pointer"
              />
            </div>
            <div className={clsx('space-y-2', !state.pageNumber.enabled && 'opacity-60')}>
              <input
                type="text"
                value={state.pageNumber.format}
                onChange={event => apply(current => ({
                  ...current,
                  pageNumber: { ...current.pageNumber, format: event.target.value },
                }), false)}
                placeholder="第 {n} 页 / 共 {total} 页"
                className="w-full p-2 text-xs font-mono rounded-md border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) outline-none focus:border-blue-500"
              />
              <div className="flex items-center gap-2">
                <select
                  value={state.pageNumber.position}
                  onChange={event => apply(current => ({
                    ...current,
                    pageNumber: { ...current.pageNumber, position: event.target.value as PageNumberConfig['position'] },
                  }))}
                  className="flex-1 p-1.5 text-xs rounded-md border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) outline-none cursor-pointer"
                >
                  <option value="bottom-left">左下角</option>
                  <option value="bottom-center">底部居中</option>
                  <option value="bottom-right">右下角</option>
                </select>
                <input
                  type="number"
                  min={0}
                  value={state.pageNumber.start}
                  onChange={event => apply(current => ({
                    ...current,
                    pageNumber: { ...current.pageNumber, start: parseInt(event.target.value, 10) || 0 },
                  }), false)}
                  className="w-14 p-1.5 text-xs rounded-md border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) outline-none"
                  title="起始页码"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={state.pageNumber.color}
                  onChange={event => apply(current => ({
                    ...current,
                    pageNumber: { ...current.pageNumber, color: event.target.value },
                  }), false)}
                  className="w-8 h-7 p-0 border border-(--color-border-subtle) rounded cursor-pointer bg-transparent"
                />
                <label className="text-[11px] text-(--color-text-muted) shrink-0">字号</label>
                <input
                  type="number"
                  min={6}
                  max={24}
                  value={state.pageNumber.fontSize}
                  onChange={event => apply(current => ({
                    ...current,
                    pageNumber: { ...current.pageNumber, fontSize: Math.max(6, parseInt(event.target.value, 10) || 10) },
                  }), false)}
                  className="w-14 p-1.5 text-xs rounded-md border border-(--color-border-subtle) bg-(--color-canvas) text-(--color-text-main) outline-none"
                />
              </div>
            </div>
          </section>

          <button onClick={resetAll} className="w-full py-2 rounded-md border border-(--color-border-subtle) text-[11px] font-semibold text-(--color-text-muted) hover:text-red-500 hover:border-red-300 cursor-pointer transition-colors">
            清空所有编辑
          </button>

          <div className="text-[10px] text-(--color-text-muted) leading-relaxed pt-1">
            所有编辑与渲染均在本地浏览器完成，不上传任何文件；文字以矢量位图形式嵌入导出 PDF，支持中文与 emoji。
          </div>
        </div>
      </aside>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        className="hidden"
        onChange={event => {
          handleImageFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {cropTarget && (
        <CropDialog
          overlay={cropTarget}
          onCancel={() => setCropTargetId(null)}
          onApply={crop => applyCrop(cropTarget.id, crop)}
        />
      )}
    </div>
  );
}
