'use client';

import { ArrowUpRight, BookOpen, Plus } from 'lucide-react';
import type { LearningAlbum } from '@/lib/domain/learning-record';

export function AlbumLibrary({ albums, loading, error, busy, onCreate, onOpen, onRetry }: {
    albums: LearningAlbum[];
    loading: boolean;
    error: string;
    busy: boolean;
    onCreate: () => void;
    onOpen: (album: LearningAlbum) => void;
    onRetry: () => void;
}) {
    return <section className="learning-album-library" aria-label="专辑列表">
        <header className="learning-album-library-heading">
            <div><p className="eyebrow">LEARNING ALBUMS</p><h1>我的专辑</h1><p>按学习主题整理，随时接着上次的进度。</p></div>
            <button className="primary-button" type="button" disabled={busy} onClick={onCreate}><Plus size={17}/>新建专辑</button>
        </header>
        {loading ? <p className="learning-empty" role="status">正在读取专辑…</p> : error ? <div className="learning-error" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={onRetry}>重试加载</button></div> : albums.length ? <>
            <p className="learning-album-library-count">共 {albums.length} 个专辑</p>
            <ul className="learning-album-grid">{albums.map(album => <li key={album.id}>
                <button className="learning-album-card" type="button" aria-label={`打开专辑 ${album.name}`} onClick={() => onOpen(album)}>
                    <span className="learning-album-card-top"><BookOpen size={26}/><ArrowUpRight size={18}/></span>
                    <strong>{album.name}</strong>
                    {album.description ? <span className="learning-album-card-description">{album.description}</span> : null}
                    <span className="learning-album-card-count">{album.recordCount} 条记录 · 已完成 {album.completedCount} 条</span>
                    <span className="learning-album-card-action">查看记录 <ArrowUpRight size={14}/></span>
                </button>
            </li>)}</ul>
        </> : <div className="learning-empty"><BookOpen size={36}/><h2>创建你的第一个专辑</h2><p>把相似主题的学习记录放在一起，逐步积累自己的知识。</p></div>}
    </section>;
}
