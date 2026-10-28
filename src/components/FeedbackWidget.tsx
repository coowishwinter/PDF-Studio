import React, { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, X, Send, CheckCircle2, Loader2, Lightbulb, Bug, Sparkles } from 'lucide-react';

const API_URL = '/pdf-api/feedback';

type FeedbackType = 'suggestion' | 'bug' | 'experience';

const TYPES: { key: FeedbackType; label: string; icon: React.ReactNode }[] = [
  { key: 'suggestion', label: '功能建议', icon: <Lightbulb className="w-3.5 h-3.5" /> },
  { key: 'bug', label: '问题反馈', icon: <Bug className="w-3.5 h-3.5" /> },
  { key: 'experience', label: '使用体验', icon: <Sparkles className="w-3.5 h-3.5" /> },
];

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('suggestion');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [website, setWebsite] = useState(''); // 蜜罐
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const openedAt = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const start = () => {
    setOpen(true);
    setDone(false);
    setError('');
    openedAt.current = Date.now();
  };

  const close = () => {
    if (sending) return;
    setOpen(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || done) return;
    if (content.trim().length < 2) {
      setError('请先写下你的建议或问题');
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          content: content.trim(),
          contact: contact.trim(),
          page: location.pathname + location.search,
          website,
          elapsedMs: Date.now() - openedAt.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.message || '提交失败，请稍后再试');
      }
      setDone(true);
      setContent('');
      setContact('');
      setType('suggestion');
    } catch (err: any) {
      setError(err?.message || '网络异常，请稍后再试');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        onClick={start}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-(--color-text-muted) hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
        title="给我们提建议或反馈问题"
      >
        <MessageSquarePlus className="w-3.5 h-3.5" />
        建议反馈
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={close} />
          <div className="relative w-full max-w-md bg-(--color-panel) border border-(--color-border-subtle) rounded-2xl shadow-2xl p-5 text-(--color-text-main)">
            <button
              onClick={close}
              className="absolute top-3.5 right-3.5 p-1 rounded-md text-(--color-text-muted) hover:bg-(--color-bg-hover) hover:text-(--color-text-main) transition-colors cursor-pointer"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>

            {done ? (
              <div className="py-8 flex flex-col items-center text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
                <p className="text-sm font-bold">已经收到了，谢谢！</p>
                <p className="text-xs text-(--color-text-muted) mt-1.5 leading-relaxed">
                  你的建议会帮我们把简页做得更好。
                </p>
                <div className="flex gap-2 mt-5">
                  <button
                    onClick={() => { setDone(false); }}
                    className="px-3.5 py-2 rounded-lg border border-(--color-border-subtle) text-xs font-semibold hover:bg-(--color-bg-hover) transition-colors cursor-pointer"
                  >
                    再写一条
                  </button>
                  <button
                    onClick={close}
                    className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    关闭
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit}>
                <h2 className="text-sm font-bold">建议与反馈</h2>
                <p className="text-[11px] text-(--color-text-muted) mt-0.5">
                  功能建议、问题反馈、使用体验都可以说，我们会认真看。
                </p>

                <div className="grid grid-cols-3 gap-1.5 mt-3.5">
                  {TYPES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setType(t.key)}
                      className={`flex items-center justify-center gap-1 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                        type === t.key
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                          : 'border-(--color-border-subtle) text-(--color-text-muted) hover:bg-(--color-bg-hover)'
                      }`}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>

                <textarea
                  value={content}
                  onChange={(e) => { setContent(e.target.value); if (error) setError(''); }}
                  maxLength={2000}
                  rows={5}
                  placeholder="想增加什么功能？哪里用着不顺手？出了问题可以描述一下操作步骤……"
                  className="mt-3 w-full resize-none rounded-lg border border-(--color-border-subtle) bg-(--color-canvas) px-3 py-2.5 text-xs leading-relaxed outline-none focus:border-blue-500 placeholder:text-(--color-text-muted)/70"
                  autoFocus
                />
                <div className="flex justify-end text-[10px] text-(--color-text-muted) mt-0.5">{content.length}/2000</div>

                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  maxLength={120}
                  autoComplete="email"
                  placeholder="邮箱（选填，方便我们回复你）"
                  type="email"
                  className="mt-1 w-full rounded-lg border border-(--color-border-subtle) bg-(--color-canvas) px-3 py-2 text-xs outline-none focus:border-blue-500 placeholder:text-(--color-text-muted)/70"
                />

                {/* 蜜罐字段，正常用户不可见 */}
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="hidden"
                  aria-hidden="true"
                />

                {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}

                <div className="flex items-center justify-between gap-3 mt-4">
                  <p className="text-[10px] text-(--color-text-muted) leading-snug">
                    只发送你填写的文字<br />不会上传任何 PDF 内容
                  </p>
                  <button
                    type="submit"
                    disabled={sending}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
                  >
                    {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    {sending ? '发送中…' : '提交建议'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
