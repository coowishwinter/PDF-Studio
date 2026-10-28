import { PDFDocument, degrees, rgb, type PDFImage } from 'pdf-lib';

/* ---------------------------------- 类型 ---------------------------------- */

export type OverlayType = 'text' | 'image' | 'highlight' | 'rect' | 'whiteout';

export interface EditPage {
  uid: string;
  srcIndex: number | null; // null = 插入的空白页
  rotation: number;        // 原始页面旋转角度 (0/90/180/270)
  rotDelta: number;        // 编辑器中额外旋转的角度（可负）
  width: number;           // MediaBox 宽（未旋转）
  height: number;          // MediaBox 高（未旋转）
}

export interface CropRect {
  x: number; // 相对原图的归一化裁剪区域（左上原点）
  y: number;
  w: number;
  h: number;
}

export interface EditOverlay {
  id: string;
  pageUid: string;
  type: OverlayType;
  x: number;               // 归一化左上角
  y: number;
  width: number;           // 归一化宽高
  height: number;
  text?: string;
  fontSize?: number;       // pt
  bold?: boolean;
  color?: string;          // #RRGGBB
  opacity?: number;
  strokeWidth?: number;    // pt
  dataUrl?: string;
  mime?: string;
  // 图片专用
  rotation?: number;       // 屏幕方向顺时针角度（-180 ~ 180）
  crop?: CropRect;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  color: string;
  opacity: number;
  size: number; // 0 = 自动
}

export interface PageNumberConfig {
  enabled: boolean;
  format: string; // 支持 {n} 与 {total}
  position: 'bottom-left' | 'bottom-center' | 'bottom-right';
  start: number;
  fontSize: number;
  color: string;
}

export interface EditorState {
  pages: EditPage[];
  overlays: EditOverlay[];
  watermark: WatermarkConfig;
  pageNumber: PageNumberConfig;
}

export const createDefaultState = (): EditorState => ({
  pages: [],
  overlays: [],
  watermark: { enabled: false, text: '内部资料 请勿外传', color: '#ef4444', opacity: 0.22, size: 0 },
  pageNumber: {
    enabled: false,
    format: '第 {n} 页 / 共 {total} 页',
    position: 'bottom-center',
    start: 1,
    fontSize: 10,
    color: '#6b7280',
  },
});

/* --------------------------------- 文本排版 -------------------------------- */

export const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

export const fontString = (fontSize: number, bold?: boolean) =>
  (bold ? '600 ' : '400 ') + fontSize + 'px ' + FONT_STACK;

const LINE_HEIGHT = 1.35;

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  if (!measureCtx) throw new Error('无法创建文本测量画布');
  return measureCtx;
}

/**
 * 按字符 / 单词混合断行，兼容中文与英文，不使用 DOM 布局以保证与导出渲染一致。
 */
export function wrapText(text: string, fontSize: number, maxWidth: number, bold = false): string[] {
  const ctx = getMeasureCtx();
  ctx.font = fontString(fontSize, bold);
  const safeWidth = Math.max(8, maxWidth);
  const lines: string[] = [];

  const pushToken = (token: string) => {
    // 超长不可断 token（长英文单词/URL）按字符硬切
    let buf = '';
    for (const ch of token) {
      const test = buf + ch;
      if (buf && ctx.measureText(test).width > safeWidth) {
        lines.push(buf);
        buf = ch;
      } else {
        buf = test;
      }
    }
    if (buf) lines.push(buf);
  };

  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    const tokens = paragraph.match(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]|[^\s\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]+|\s+/g) ?? [];
    let current = '';

    for (const token of tokens) {
      const isSpace = /^\s+$/.test(token);
      if (!current && isSpace) continue;

      if (ctx.measureText(token).width > safeWidth) {
        if (current.trim()) {
          lines.push(current.trimEnd());
          current = '';
        }
        pushToken(token.trim());
        continue;
      }

      const test = current + token;
      if (current && ctx.measureText(test).width > safeWidth) {
        lines.push(current.trimEnd());
        current = isSpace ? '' : token;
      } else {
        current = test;
      }
    }
    lines.push(current.trimEnd());
  }

  return lines.length ? lines : [''];
}

export function measureTextBlock(text: string, fontSize: number, widthPts: number, bold = false) {
  const lines = wrapText(text, fontSize, widthPts, bold);
  return { lines, height: Math.max(LINE_HEIGHT, lines.length * LINE_HEIGHT) * fontSize };
}

export interface RenderedText {
  canvas: HTMLCanvasElement;
  widthPts: number;
  heightPts: number;
}

/**
 * 将文字栅格化为透明 PNG 画布（用于预览与导出，保证所见即所得，且完美支持中文/emoji）。
 */
export function renderTextToCanvas(opts: {
  text: string;
  fontSize: number;
  widthPts: number;
  bold?: boolean;
  color?: string;
  scale: number;
}): RenderedText {
  const { text, fontSize, widthPts, bold = false, color = '#111827', scale } = opts;
  const { lines, height } = measureTextBlock(text, fontSize, widthPts, bold);
  const width = Math.max(1, widthPts);
  const heightPts = Math.max(1, height);
  const pxScale = Math.max(1, scale);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * pxScale));
  canvas.height = Math.max(1, Math.ceil(heightPts * pxScale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建文字渲染画布');

  ctx.scale(pxScale, pxScale);
  ctx.font = fontString(fontSize, bold);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';

  lines.forEach((line, index) => {
    ctx.fillText(line, 0, fontSize * 0.98 + index * fontSize * LINE_HEIGHT);
  });

  return { canvas, widthPts: width, heightPts };
}

/** 单行文本的渲染尺寸（用于水印/页码） */
export function measureSingleLine(text: string, fontSize: number, bold = false) {
  const ctx = getMeasureCtx();
  ctx.font = fontString(fontSize, bold);
  return { width: Math.max(1, ctx.measureText(text).width), height: fontSize * LINE_HEIGHT };
}

/* ---------------------------------- 几何 ---------------------------------- */

/** 页面旋转后的显示尺寸（点） */
export function displaySize(page: EditPage) {
  const rot = ((page.rotation + page.rotDelta) % 360 + 360) % 360;
  return rot % 180 === 0
    ? { width: page.width, height: page.height, rotation: rot }
    : { width: page.height, height: page.width, rotation: rot };
}

/** 显示坐标（左上原点、y 向下）→ PDF 用户坐标（左下原点、y 向上） */
export function displayToPdf(dx: number, dy: number, width: number, height: number, rotation: number) {
  const rot = ((rotation % 360) + 360) % 360;
  switch (rot) {
    case 90:
      return { x: dy, y: dx };
    case 180:
      return { x: width - dx, y: dy };
    case 270:
      return { x: width - dy, y: height - dx };
    default:
      return { x: dx, y: height - dy };
  }
}

/* --------------------------------- 颜色工具 -------------------------------- */

export function hexToRgb(hex: string) {
  let value = (hex || '#000000').replace('#', '').trim();
  if (value.length === 3) value = value.split('').map(c => c + c).join('');
  const num = parseInt(value, 16);
  if (Number.isNaN(num)) return rgb(0, 0, 0);
  return rgb(((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255);
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ---------------------------------- 导出 ---------------------------------- */

const TEXT_EXPORT_SCALE = 3; // 约 216 DPI

export async function exportEditedPdf(
  file: File,
  state: EditorState,
  onProgress?: (percent: number, status: string) => void
): Promise<Blob> {
  const sourceBytes = await file.arrayBuffer();
  const source = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const imageCache = new Map<string, PDFImage>();

  const embedImage = async (key: string, dataUrl: string, mime: string) => {
    const cached = imageCache.get(key);
    if (cached) return cached;
    const bytes = dataUrlToBytes(dataUrl);
    const image = /jpe?g/i.test(mime) ? await out.embedJpg(bytes) : await out.embedPng(bytes);
    imageCache.set(key, image);
    return image;
  };

  const loadImageElement = (dataUrl: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('图片解码失败'));
      element.src = dataUrl;
    });

  // 有裁剪时，先在本地按原图分辨率裁出一张新图再嵌入，避免质量损失与坐标误差
  const buildImagePayload = async (overlay: EditOverlay) => {
    const crop = overlay.crop;
    const isFullCrop =
      !crop ||
      (crop.x <= 0.0001 && crop.y <= 0.0001 && crop.w >= 0.9999 && crop.h >= 0.9999);
    if (isFullCrop) {
      return { key: overlay.id, dataUrl: overlay.dataUrl || '', mime: overlay.mime || 'image/png' };
    }
    const element = await loadImageElement(overlay.dataUrl || '');
    const naturalWidth = element.naturalWidth || 1;
    const naturalHeight = element.naturalHeight || 1;
    const sx = Math.round(crop.x * naturalWidth);
    const sy = Math.round(crop.y * naturalHeight);
    const sw = Math.max(1, Math.round(crop.w * naturalWidth));
    const sh = Math.max(1, Math.round(crop.h * naturalHeight));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建图片裁剪画布');
    ctx.drawImage(element, sx, sy, sw, sh, 0, 0, sw, sh);

    return {
      key:
        overlay.id +
        ':' +
        [crop.x, crop.y, crop.w, crop.h].map(value => value.toFixed(4)).join(','),
      dataUrl: canvas.toDataURL('image/png'),
      mime: 'image/png',
    };
  };

  const pages = state.pages;
  const total = pages.length;

  for (let index = 0; index < total; index++) {
    const page = pages[index];
    onProgress?.(
      Math.round((index / Math.max(1, total)) * 90),
      '正在合成页面 ' + (index + 1) + ' / ' + total + ' ...'
    );

    let outPage;
    if (page.srcIndex === null) {
      outPage = out.addPage([page.width, page.height]);
    } else {
      const [copied] = await out.copyPages(source, [page.srcIndex]);
      outPage = out.addPage(copied);
    }

    const finalRotation = (((page.rotation + page.rotDelta) % 360) + 360) % 360;
    outPage.setRotation(degrees(finalRotation));

    const { width: mediaWidth, height: mediaHeight } = outPage.getSize();
    const displayWidth = finalRotation % 180 === 0 ? mediaWidth : mediaHeight;
    const displayHeight = finalRotation % 180 === 0 ? mediaHeight : mediaWidth;
    const rotation = finalRotation;

    // 叠加元素
    const pageOverlays = state.overlays.filter(item => item.pageUid === page.uid);
    for (const overlay of pageOverlays) {
      const boxWidth = Math.max(1, overlay.width * displayWidth);
      const boxHeight = Math.max(1, overlay.height * displayHeight);

      if (overlay.type === 'text') {
        const text = overlay.text ?? '';
        if (!text.trim()) continue;
        const rendered = renderTextToCanvas({
          text,
          fontSize: overlay.fontSize ?? 14,
          widthPts: boxWidth,
          bold: overlay.bold,
          color: overlay.color ?? '#111827',
          scale: TEXT_EXPORT_SCALE,
        });
        const image = await out.embedPng(rendered.canvas.toDataURL('image/png'));
        const anchor = displayToPdf(
          overlay.x * displayWidth,
          overlay.y * displayHeight + rendered.heightPts,
          mediaWidth,
          mediaHeight,
          rotation
        );
        outPage.drawImage(image, {
          x: anchor.x,
          y: anchor.y,
          width: rendered.widthPts,
          height: rendered.heightPts,
          rotate: degrees(rotation),
          opacity: overlay.opacity ?? 1,
        });
        continue;
      }

      if (overlay.type === 'image') {
        if (!overlay.dataUrl) continue;
        const payload = await buildImagePayload(overlay);
        const image = await embedImage(payload.key, payload.dataUrl, payload.mime);

        // 图片自身旋转（屏幕顺时针为正）叠加页面旋转：PDF 中逆时针为正，故取 rotation - imageRotation
        const imageRotation = overlay.rotation ?? 0;
        const pdfRotation = rotation - imageRotation;
        const theta = (pdfRotation * Math.PI) / 180;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);

        const center = displayToPdf(
          (overlay.x + overlay.width / 2) * displayWidth,
          (overlay.y + overlay.height / 2) * displayHeight,
          mediaWidth,
          mediaHeight,
          rotation
        );
        // 以图片中心为旋转锚点
        const anchorX = center.x - (boxWidth / 2) * cos + (boxHeight / 2) * sin;
        const anchorY = center.y - (boxWidth / 2) * sin - (boxHeight / 2) * cos;

        outPage.drawImage(image, {
          x: anchorX,
          y: anchorY,
          width: boxWidth,
          height: boxHeight,
          rotate: degrees(pdfRotation),
          opacity: overlay.opacity ?? 1,
        });
        continue;
      }

      // 矩形 / 高亮 / 涂白
      const anchor = displayToPdf(
        overlay.x * displayWidth,
        (overlay.y + overlay.height) * displayHeight,
        mediaWidth,
        mediaHeight,
        rotation
      );
      const color = hexToRgb(overlay.color ?? (overlay.type === 'whiteout' ? '#ffffff' : '#fde047'));
      const isStroke = overlay.type === 'rect';
      outPage.drawRectangle({
        x: anchor.x,
        y: anchor.y,
        width: boxWidth,
        height: boxHeight,
        rotate: degrees(rotation),
        color: isStroke ? undefined : color,
        borderColor: isStroke ? color : undefined,
        borderWidth: isStroke ? overlay.strokeWidth ?? 2 : 0,
        opacity: isStroke ? 1 : overlay.opacity ?? (overlay.type === 'highlight' ? 0.35 : 1),
      });
    }

    // 页码
    if (state.pageNumber.enabled) {
      const config = state.pageNumber;
      const label = config.format
        .replace(/\{n\}/g, String(config.start + index))
        .replace(/\{total\}/g, String(total));
      if (label.trim()) {
        const fontSize = config.fontSize || 10;
        const single = measureSingleLine(label, fontSize);
        const rendered = renderTextToCanvas({
          text: label,
          fontSize,
          widthPts: single.width + 2,
          color: config.color,
          scale: TEXT_EXPORT_SCALE,
        });
        const margin = 24;
        let left = margin;
        if (config.position === 'bottom-center') left = (displayWidth - rendered.widthPts) / 2;
        if (config.position === 'bottom-right') left = displayWidth - margin - rendered.widthPts;
        const anchor = displayToPdf(
          left,
          displayHeight - margin,
          mediaWidth,
          mediaHeight,
          rotation
        );
        const image = await out.embedPng(rendered.canvas.toDataURL('image/png'));
        outPage.drawImage(image, {
          x: anchor.x,
          y: anchor.y,
          width: rendered.widthPts,
          height: rendered.heightPts,
          rotate: degrees(rotation),
        });
      }
    }

    // 水印（置顶、斜向 45°）
    if (state.watermark.enabled && state.watermark.text.trim()) {
      const config = state.watermark;
      const autoSize = Math.max(18, Math.min(displayWidth, displayHeight) * 0.07);
      const fontSize = config.size > 0 ? config.size : autoSize;
      const single = measureSingleLine(config.text, fontSize, true);
      const rendered = renderTextToCanvas({
        text: config.text,
        fontSize,
        widthPts: single.width + 4,
        bold: true,
        color: config.color,
        scale: TEXT_EXPORT_SCALE,
      });
      const image = await out.embedPng(rendered.canvas.toDataURL('image/png'));

      const theta = ((rotation + 45) * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const center = displayToPdf(
        displayWidth / 2,
        displayHeight / 2,
        mediaWidth,
        mediaHeight,
        rotation
      );
      const anchorX = center.x - (rendered.widthPts / 2) * cos + (rendered.heightPts / 2) * sin;
      const anchorY = center.y - (rendered.widthPts / 2) * sin - (rendered.heightPts / 2) * cos;

      outPage.drawImage(image, {
        x: anchorX,
        y: anchorY,
        width: rendered.widthPts,
        height: rendered.heightPts,
        rotate: degrees(rotation + 45),
        opacity: config.opacity,
      });
    }
  }

  onProgress?.(94, '正在写入 PDF 文件...');
  const bytes = await out.save();
  onProgress?.(100, '导出完成！');
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}
