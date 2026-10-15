'use client';
import { useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialogFocus } from '@/features/checkins/dirty-switch-dialog';
import type { LearningAlbum } from '@/lib/domain/learning-record';
export function LearningDialog({ title, onClose, children, busy = false }: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    busy?: boolean;
}) {
    const ref = useRef<HTMLElement>(null);
    const close = useRef<HTMLButtonElement>(null);
    useDialogFocus({ dialogRef: ref, initialFocusRef: close, onClose: () => { if (!busy)
            onClose(); } });
    return <div className="dialog-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-label={title} className="switch-dialog learning-dialog"><div className="learning-dialog-heading"><h2>{title}</h2><button ref={close} type="button" className="icon-button" aria-label="关闭对话框" disabled={busy} onClick={onClose}><X size={18}/></button></div>{children}</section></div>;
}
export function AlbumDialog({ album, busy, error, onClose, onSave }: {
    album: LearningAlbum | null;
    busy: boolean;
    error: string;
    onClose: () => void;
    onSave: (name: string, description: string) => void;
}) {
    const [name, setName] = useState(album?.name ?? '');
    const [description, setDescription] = useState(album?.description ?? '');
    return <LearningDialog title={album ? '编辑专辑' : '新建专辑'} onClose={onClose} busy={busy}><form className="checkin-form" onSubmit={e => { e.preventDefault(); onSave(name.trim(), description.trim()); }}><label>专辑名称<input autoComplete="off" required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="例如：AI 产品设计"/></label><label>专辑简介（选填）<textarea maxLength={500} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="你想在这个主题里学到什么？"/></label>{error ? <p role="alert" className="learning-error">{error}</p> : null}<div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy || !name.trim()}>{busy ? '正在保存…' : '保存专辑'}</button></div></form></LearningDialog>;
}
