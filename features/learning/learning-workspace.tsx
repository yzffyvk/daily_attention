'use client';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CalendarDays, Check, Coins, Layers3, Link2, List, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccountProfile } from '@/server/auth/ports';
import { normalizeLearningSourceUrl, type LearningAlbum, type LearningRecord } from '@/lib/domain/learning-record';
import { MonthCalendar } from '@/features/calendar/month-calendar';
import { AppHeader } from '@/features/profile/app-header';
import { CurrentLearningPersona } from '@/features/profile/learning-persona';
import { DailyTakeawayEntry } from '@/features/daily-takeaways/daily-takeaway-entry';
import { DailyEchoCompanion } from '@/features/checkins/daily-echo-companion';
import { DailyEchoDialog } from '@/features/checkins/daily-echo-dialog';
import { useDailyEchoReceipt } from '@/features/checkins/use-daily-echo-receipt';
import { KnowledgeWorkspace } from '@/features/knowledge-narratives/knowledge-workspace';
import { ApiError, requestApi, uploadCheckInImage } from '@/features/checkins/api';
import { checkInKeys, useMonthCheckIns } from '@/features/checkins/queries';
import { formatDate, getTodayKey, millisecondsUntilNextLocalMidnight } from '@/features/checkins/dates';
import { createAlbum, createRecord, deleteAlbum, deleteRecord, getAlbums, getRecord, getRecords, moveRecords, updateAlbum, updateRecord, type RecordContent, type RecordFilters } from './api';
import { listLearningDrafts, migrateLegacyDrafts, removeLearningDraft, saveLearningDraft } from './drafts';
import { draftForEditing, makeLearningDraft, matchesRecordTitle, recordStateLabel, recordsForView, sourceHost, type LearningDraft, type LearningView } from './model';
import { LearningRecordDetail, type LearningSaveFeedback } from './record-detail';
import { AlbumDialog, LearningDialog } from './dialogs';
import { AlbumLibrary } from './album-library';
import './learning.css';
type Props = {
    initialDate: string;
    initialToday?: string;
    initialProfile?: AccountProfile | null;
    userId: string;
};
const learningKeys = { all: ['learning'] as const, records: ['learning', 'records'] as const, record: (id: string) => ['learning', 'record', id] as const, albums: ['learning', 'albums'] as const };
function errorText(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请稍后重试'; }
function playLearningChime() {
    if (!window.AudioContext) return;
    try {
        const audio = new AudioContext();
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.0001, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.45);
        gain.connect(audio.destination);
        [784, 1174].forEach((frequency, index) => {
            const tone = audio.createOscillator();
            tone.frequency.value = frequency;
            tone.connect(gain);
            tone.start(audio.currentTime + index * 0.08);
            tone.stop(audio.currentTime + 0.42);
        });
        window.setTimeout(() => void audio.close().catch(() => undefined), 600);
    } catch { /* A muted or unavailable device must not interrupt saving. */ }
}

export function LearningWorkspace({ initialDate, initialToday = initialDate, initialProfile = null, userId }: Props) {
    const queryClient = useQueryClient();
    const [today, setToday] = useState(initialToday);
    const [view, setView] = useState<LearningView>({ kind: 'date', date: initialDate > initialToday ? initialToday : initialDate });
    const [month, setMonth] = useState(initialDate.slice(0, 7));
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [recordOpenRequest, requestRecordOpen] = useState(0);
    const recordContentRef = useRef<HTMLDivElement>(null);
    const [drafts, setDrafts] = useState<Record<string, LearningDraft>>({});
    const draftsRef = useRef(drafts);
    const draftWrites = useRef<Promise<unknown>>(Promise.resolve());
    const [draftsReady, setDraftsReady] = useState(false);
    const [storageError, setStorageError] = useState(false);
    const [offline, setOffline] = useState(false);
    const [message, setMessage] = useState('');
    const [saveFeedback, setSaveFeedback] = useState<(LearningSaveFeedback & { recordId: string }) | null>(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [duplicateSource, setDuplicateSource] = useState('');
    const [dialogError, setDialogError] = useState('');
    const [albumDialog, setAlbumDialog] = useState<{
        album: LearningAlbum | null;
        assign: boolean;
    } | null>(null);
    const [confirm, setConfirm] = useState<{
        title: string;
        description: string;
        action: () => Promise<void>;
    } | null>(null);
    const [conflict, setConflict] = useState<LearningRecord | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const activeSearch = view.kind === 'all' ? search : '';
    const searchPending = view.kind === 'all' && searchInput.trim() !== search;
    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [searchInput]);
    const [calendarOpen, setCalendarOpen] = useState(true);
    const [knowledge, setKnowledge] = useState<{
        ids: string[];
        albumId?: string | null;
    } | null>(null);
    const knowledgeGuard = useRef<((leave: () => void) => void) | null>(null);
    const knowledgeNavigation = useRef<(() => void) | null>(null);
    const [echoDate, setEchoDate] = useState<string | null>(null);
    const echo = useDailyEchoReceipt(userId, today);
    const [muted, setMuted] = useState(false);
    const [celebrating, setCelebrating] = useState(false);
    const albumsQuery = useQuery({ queryKey: learningKeys.albums, queryFn: getAlbums });
    const albums = albumsQuery.data ?? [];
    const selectedAlbum = view.kind === 'album' ? albums.find(a => a.id === view.albumId) : null;
    const filters: RecordFilters = view.kind === 'date' ? { date: view.date } : view.kind === 'album' ? { albumId: view.albumId } : view.kind === 'unfiled' ? { unfiled: true } : view.kind === 'pending' ? { pending: true } : activeSearch ? { search: activeSearch } : {};
    const recordsQuery = useInfiniteQuery({ queryKey: [...learningKeys.records, filters], queryFn: ({ pageParam }) => getRecords({ ...filters, limit: 50, ...(pageParam ? { cursor: pageParam } : {}) }), enabled: view.kind !== 'albums' && !searchPending, initialPageParam: null as string | null, getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: query => query.state.data?.pages.some(page => page.records.some(r => r.activeAiJobId)) ? 5000 : false });
    const cloudRecords = useMemo(() => recordsQuery.data?.pages.flatMap(page => page.records) ?? [], [recordsQuery.data]);
    const monthQuery = useMonthCheckIns(month);
    const localSelected = selectedId ? drafts[selectedId] : null;
    const detailQuery = useQuery({ queryKey: learningKeys.record(selectedId ?? ''), queryFn: () => getRecord(selectedId!), enabled: Boolean(selectedId) && !localSelected?.localOnly, initialData: () => cloudRecords.find(r => r.id === selectedId), refetchInterval: query => query.state.data?.activeAiJobId ? 2500 : false });
    const selectedRecord = localSelected?.localOnly ? null : detailQuery.data ?? null;
    const draft = selectedRecord ? draftForEditing(selectedRecord, localSelected) : localSelected;
    const recordContentReady = Boolean(draft && draftsReady);
    useEffect(() => {
        if (!selectedId || !recordContentReady) return;
        const frame = requestAnimationFrame(() => {
            const content = recordContentRef.current;
            content?.focus({ preventScroll: true });
            content?.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                block: 'start',
                inline: 'nearest',
            });
        });
        return () => cancelAnimationFrame(frame);
    }, [selectedId, recordContentReady, recordOpenRequest]);
    const sourceToCheck = draft?.localOnly ? draft.sourceUrl.trim() : '';
    useEffect(() => {
        const timer = window.setTimeout(() => {
            try {
                const url = new URL(sourceToCheck);
                setDuplicateSource(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? normalizeLearningSourceUrl(sourceToCheck) : '');
            } catch { setDuplicateSource(''); }
        }, 400);
        return () => window.clearTimeout(timer);
    }, [sourceToCheck]);
    let currentSource = '';
    try { currentSource = normalizeLearningSourceUrl(sourceToCheck); } catch { /* Incomplete links are expected while typing. */ }
    const duplicatesQuery = useQuery({ queryKey: ['learning', 'duplicates', duplicateSource], queryFn: () => getRecords({ sourceUrl: duplicateSource, limit: 10 }), enabled: Boolean(duplicateSource) && duplicateSource === currentSource, retry: false });
    const duplicates = duplicateSource && duplicateSource === currentSource ? (duplicatesQuery.data?.records ?? []).filter(record => record.id !== selectedId) : [];
    const localRecords = Object.values(drafts).filter(d => d.localOnly).map(d => ({ ...d, status: 'pending' as const, aiCandidate: null, activeAiJobId: null, aiStatus: null, createdAt: d.createdAt??d.updatedAt, version: 0, imagePath: d.uploadedImagePath, imageName: d.imageFile?.name ?? '', imageUrl: null, completedAt: null, aiError: null }));
    const visibleRecords = [...recordsForView(localRecords, view).filter(record => matchesRecordTitle(record, activeSearch)), ...cloudRecords.filter(r => !drafts[r.id]?.localOnly)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const filteredRecords = visibleRecords.filter(r => statusFilter === 'all' || (statusFilter === 'completed' ? r.status === 'completed' : recordStateLabel(r) === statusFilter));
    const completeCount = visibleRecords.filter(r => r.status === 'completed').length;
    const title = view.kind === 'all' ? '全部记录' : view.kind === 'date' ? formatDate(view.date) : view.kind === 'pending' ? '待处理' : view.kind === 'unfiled' ? '未归类' : selectedAlbum?.name ?? '专辑';
    useEffect(() => { let live = true; void (async () => { try {
        await migrateLegacyDrafts(userId);
        const restored = await listLearningDrafts(userId);
        if (live) {
            const next = Object.fromEntries(restored.map(item => [item.id, item]));
            draftsRef.current = next;
            setDrafts(next);
        }
    }
    catch {
        if (live)
            setStorageError(true);
    }
    finally {
        if (live)
            setDraftsReady(true);
    } })(); return () => { live = false; }; }, [userId]);
    useEffect(() => { const handle = () => { setToday(getTodayKey()); }; const timer = window.setTimeout(handle, millisecondsUntilNextLocalMidnight() + 100); window.addEventListener('focus', handle); return () => { clearTimeout(timer); window.removeEventListener('focus', handle); }; }, [today]);
    useEffect(() => { const frame = requestAnimationFrame(() => { try {
        setMuted(localStorage.getItem('attention-journal-muted') === 'true');
        setCalendarOpen(localStorage.getItem('aura-calendar-collapsed') !== 'true');
    }
    catch { /* Preferences are optional. */ } }); return () => cancelAnimationFrame(frame); }, []);
    useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (Object.keys(draftsRef.current).length) {
        event.preventDefault();
        event.returnValue = '';
    } }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, []);
    useEffect(()=>{const update=()=>setOffline(!navigator.onLine);const frame=requestAnimationFrame(update);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{cancelAnimationFrame(frame);window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
    function setLocal(next: LearningDraft) { const nextMap = { ...draftsRef.current, [next.id]: next }; draftsRef.current = nextMap; setDrafts(nextMap); draftWrites.current = draftWrites.current.catch(() => undefined).then(() => saveLearningDraft(userId, next)).then(() => setStorageError(false)).catch(() => setStorageError(true)); }
    async function clearLocal(id: string) { const next = { ...draftsRef.current }; delete next[id]; draftsRef.current = next; setDrafts(next); await draftWrites.current; try {
        await removeLearningDraft(userId, id);
    }
    catch {
        setStorageError(true);
    } }
    function refresh() { void queryClient.invalidateQueries({ queryKey: learningKeys.all }); void queryClient.invalidateQueries({ queryKey: checkInKeys.all }); }
    function selectView(next: LearningView) { setView(next); setSelectedId(null); setSelectedIds([]); setStatusFilter('all'); setSearchInput(''); setSearch(''); setMessage(''); setConflict(null); if (next.kind === 'date')
        setMonth(next.date.slice(0, 7)); }
    function selectRecord(id: string) { setSelectedId(id); requestRecordOpen(current => current + 1); }
    function openRecord(record: LearningRecord) { selectRecord(record.id); queryClient.setQueryData(learningKeys.record(record.id), record); setMessage(''); setConflict(null); }
    function beginRecord() {
        if (!draftsReady || savingRef.current) return;
        const next = makeLearningDraft(view.kind === 'date' ? view.date : today, view.kind === 'album' ? view.albumId : null, 'manual');
        setLocal(next);
        setSelectedId(next.id);
        setConflict(null);
        setMessage('');
    }
    async function recoverAmbiguousCreate(current: LearningDraft, error: unknown, requestedStatus: 'pending' | 'completed') {
        if (!(error instanceof ApiError) || !(error.status === 0 || error.status >= 500 || ['IDEMPOTENCY_CONFLICT', 'MALFORMED_RESPONSE', 'NETWORK_ERROR'].includes(error.code))) return false;
        try {
            const cloud = await getRecord(current.id);
            // Keep every local edit. A durable review flag prevents a reload from silently rebasing it.
            setLocal({ ...current, localOnly: false, baseVersion: cloud.version, needsCloudReview: true, recoveredCreate: true, pendingSaveStatus: requestedStatus });
            queryClient.setQueryData(learningKeys.record(cloud.id), cloud);
            setSelectedId(cloud.id);
            setConflict(cloud);
            setMessage('这条记录已存在于云端，本地修改已保留。请先选择如何处理两个版本。');
            refresh();
            return true;
        } catch { return false; }
    }
    async function save(status: 'pending' | 'completed', options?: {entryMode?:'ai'; acceptCloudVersion?:number}): Promise<LearningRecord | null> { if (!draft || savingRef.current)
        return null; const current = draft; savingRef.current = true; setSaving(true); setMessage('');
        const feedback = (kind: LearningSaveFeedback['kind'], text: string) => setSaveFeedback({ recordId: current.id, status, kind, message: text });
        feedback('progress', status === 'completed' ? '正在确认…' : '正在保存草稿…');
        let uploaded = current.uploadedImagePath; try {
        if (current.needsCloudReview && options?.acceptCloudVersion === undefined) {
            setLocal({ ...current, pendingSaveStatus: status });
            const cloud = await getRecord(current.id);
            queryClient.setQueryData(learningKeys.record(cloud.id), cloud);
            setConflict(cloud);
            setMessage('本地修改已保留，请先选择采用本地内容、载入云端或另存为新记录。');
            feedback('error', '记录尚未完成保存，请先处理云端版本冲突。本地内容已保留。');
            return null;
        }
        if (current.imageFile && !uploaded) {
            uploaded = await uploadCheckInImage(current.date, current.imageFile);
            setLocal({ ...current, uploadedImagePath: uploaded });
        }
        const content: RecordContent = { entryMode: options?.entryMode ?? (current.candidateJobId ? 'ai' : current.entryMode), attention: current.attention.trim(), sourceUrl: current.sourceUrl.trim(), summary: current.summary.trim(), inspiration: current.inspiration.trim(), userPrompt: current.userPrompt ?? '', aiGenerationContext: current.aiGenerationContext ?? null, imagePath: current.removeImage ? null : uploaded ?? selectedRecord?.imagePath ?? null, imageName: current.removeImage ? '' : current.imageFile?.name ?? selectedRecord?.imageName ?? '', status };
        const saved = current.localOnly ? await createRecord({ ...content, id: current.id, date: current.date, albumId: current.albumId }) : await updateRecord(current.id, { ...content, ...(options?.acceptCloudVersion !== undefined && current.recoveredCreate ? { albumId: current.albumId } : {}), version: options?.acceptCloudVersion ?? current.baseVersion ?? selectedRecord!.version, ...(current.candidateJobId ? { candidateJobId: current.candidateJobId } : {}) });
        queryClient.setQueryData(learningKeys.record(saved.id), saved);
        await clearLocal(current.id);
        const successMessage = saved.status === 'completed' ? '这条记录已完成并保存到云端。' : '草稿已保存，随时回来继续编辑。';
        setMessage(successMessage);
        feedback('success', successMessage);
        setConflict(null);
        refresh();
        if (saved.status === 'completed' && selectedRecord?.status !== 'completed' && saved.date === today && !echo.hasReceived(today)) {
            if (!muted) playLearningChime();
            echo.receive(today);
            setEchoDate(today);
            setCelebrating(true);
            window.setTimeout(() => setCelebrating(false), 1500);
        }
        return saved;
    }
    catch (error) {
        if (current.localOnly && await recoverAmbiguousCreate({ ...current, uploadedImagePath: uploaded }, error, status)) {
            feedback('error', '已找到云端记录，请先处理两个版本。本地内容已保留。');
            return null;
        }
        if (error instanceof ApiError && error.code === 'VERSION_CONFLICT' && error.current) {
            setLocal({ ...current, uploadedImagePath: uploaded, needsCloudReview: true, pendingSaveStatus: status });
            setConflict(error.current as LearningRecord);
        }
        setMessage(errorText(error));
        feedback('error', `保存失败：${errorText(error)}。本地内容已保留，请重试。`);
        return null;
    }
    finally {
        savingRef.current = false;
        setSaving(false);
    } }
    async function move(ids: string[], albumId: string | null) { if (savingRef.current)
        return; savingRef.current = true; setSaving(true); try {
        const local = ids.filter(id => draftsRef.current[id]?.localOnly);
        const remote = ids.filter(id => !local.includes(id));
        if (remote.length)
            await moveRecords(remote, albumId);
        for (const id of ids) {
            const item = draftsRef.current[id];
            if (item)
                setLocal({ ...item, albumId });
            const cloud = queryClient.getQueryData<LearningRecord>(learningKeys.record(id));
            if (cloud)
                queryClient.setQueryData(learningKeys.record(id), { ...cloud, albumId });
        }
        setMessage(`已移动 ${ids.length} 条记录`);
        setSelectedIds([]);
        refresh();
    }
    catch (error) {
        setMessage(errorText(error));
    }
    finally {
        savingRef.current = false;
        setSaving(false);
    } }
    function requestDelete(record: LearningRecord) {
        setDialogError('');
        setConfirm({ title: '删除这条记录？', description: `「${record.attention || '未命名记录'}」的内容会被删除。已有知识串联保留来源快照，学习天数会重新计算。`, action: async () => {
            if (!draftsRef.current[record.id]?.localOnly) {
                const cached = queryClient.getQueryData<LearningRecord>(learningKeys.record(record.id));
                await deleteRecord(record.id, cached?.version ?? record.version);
            }
            await clearLocal(record.id);
            if (selectedId === record.id) { setSelectedId(null); setConflict(null); }
            setSelectedIds(ids => ids.filter(id => id !== record.id));
            queryClient.removeQueries({ queryKey: learningKeys.record(record.id), exact: true });
            setMessage('记录已删除。');
            refresh();
        } });
    }
    async function cancelEditing() {
        if (!draft || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setSaveFeedback(null);
        try {
            if (selectedRecord?.aiCandidate) {
                const saved = await updateRecord(selectedRecord.id, { version: selectedRecord.version, discardCandidate: true });
                queryClient.setQueryData(learningKeys.record(saved.id), saved);
            }
            await clearLocal(draft.id);
            setSelectedId(null);
            setConflict(null);
            setMessage('已取消，本次未保存修改已放弃。');
            refresh();
        } catch (error) {
            setSaveFeedback({ recordId: draft.id, status: selectedRecord?.status ?? 'pending', kind: 'error', message: `取消失败：${errorText(error)}。内容已保留，请重试。` });
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }
    async function saveAlbum(name: string, description: string) { if (!albumDialog || savingRef.current)
        return; savingRef.current = true; setSaving(true); setDialogError(''); try {
        const result = albumDialog.album ? await updateAlbum(albumDialog.album.id, { name, description }) : await createAlbum({ name, description });
        await queryClient.invalidateQueries({ queryKey: learningKeys.albums });
        if (albumDialog.assign) {
            if (draft) {
                if (draft.localOnly)
                    setLocal({ ...draft, albumId: result.id });
                else {
                    await moveRecords([draft.id], result.id);
                    refresh();
                }
            }
        }
        setAlbumDialog(null);
    }
    catch (error) {
        setDialogError(errorText(error));
    }
    finally {
        savingRef.current = false;
        setSaving(false);
    } }
    function requestDeleteAlbum(album: LearningAlbum) { setConfirm({ title: `删除专辑「${album.name}」？`, description: '其中所有记录都会移入未归类，内容与学习完成状态保留。', action: async () => { await deleteAlbum(album.id); for (const item of Object.values(draftsRef.current))
            if (item.albumId === album.id)
                setLocal({ ...item, albumId: null }); selectView({ kind: 'all' }); refresh(); } }); }
    async function runConfirmation() { if (!confirm || savingRef.current)
        return; savingRef.current = true; setSaving(true); setDialogError(''); try {
        await confirm.action();
        setConfirm(null);
    }
    catch (error) {
        setDialogError(errorText(error));
    }
    finally {
        savingRef.current = false;
        setSaving(false);
    } }
    function enterKnowledge(ids: string[] = selectedIds) { setKnowledge({ ids, albumId: view.kind === 'album' ? view.albumId : undefined }); }
    function withKnowledgeGuard(action: () => void) { if (knowledgeGuard.current)
        knowledgeGuard.current(action);
    else
        action(); }
    async function logout() { await draftWrites.current; try {
        await requestApi('/api/auth/logout', { method: 'POST', body: '{}' });
        window.location.assign('/login');
    }
    catch (error) {
        setMessage(errorText(error));
    } }
    const selectedComplete = selectedIds.length >= 2 && selectedIds.length <= 14 && selectedIds.every(id => cloudRecords.some(r => r.id === id && r.status === 'completed'));
    return <main className="app-page"><section className="page-shell learning-shell">
  <AppHeader initialProfile={initialProfile} today={today} isCelebrating={celebrating} isMuted={muted} isBusy={saving} onSelectToday={() => withKnowledgeGuard(() => { setKnowledge(null); selectView({ kind: 'date', date: today }); })} onToggleMuted={() => { setMuted(!muted); try {
        localStorage.setItem('attention-journal-muted', String(!muted));
    }
    catch { /* Optional. */ } }} onRequestLogout={() => withKnowledgeGuard(() => { if (storageError && Object.keys(draftsRef.current).length) {
        setMessage('草稿未能保存，请先保存记录到云端后退出。');
        return;
    } void logout(); })} knowledgeOpen={Boolean(knowledge)} onOpenKnowledge={() => { if (knowledge)
        knowledgeNavigation.current?.();
    else
        enterKnowledge([]); }}/>
  {!knowledge ? <nav className="learning-navigation" aria-label="学习内容导航"><button aria-pressed={view.kind === 'date'} onClick={() => selectView({ kind: 'date', date: today })} type="button"><CalendarDays size={17}/>每日记录</button><button aria-pressed={view.kind === 'all'} onClick={() => selectView({ kind: 'all' })} type="button"><List size={17}/>全部记录</button><button aria-pressed={view.kind === 'albums' || view.kind === 'album'} onClick={() => selectView({ kind: 'albums' })} type="button"><BookOpen size={17}/>专辑</button><Link href="/credits" aria-disabled={saving || undefined} onClick={event => { if (saving) event.preventDefault(); }}><Coins size={17} aria-hidden="true"/>AI 额度</Link><div className="learning-nav-spacer"/>{view.kind !== 'albums' ? <button aria-expanded={calendarOpen} onClick={() => { setCalendarOpen(!calendarOpen); try {
        localStorage.setItem('aura-calendar-collapsed', String(calendarOpen));
    }
    catch { /* Optional. */ } }} type="button">{calendarOpen ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={17}/>}日历</button> : null}</nav> : null}
  {view.kind !== 'albums' ? <DailyEchoCompanion date={today} onOpen={echo.receivedDate === today ? () => setEchoDate(today) : undefined}/> : null}
  {knowledge ? <KnowledgeWorkspace today={today} entryMode="manual" initialRecordIds={knowledge.ids} initialAlbumId={knowledge.albumId} userId={userId} emptyIllustration={<CurrentLearningPersona initialProfile={initialProfile}/>} leaveGuardRef={knowledgeGuard} listNavigationRef={knowledgeNavigation} onClose={() => setKnowledge(null)}/> : null}
  <div hidden={Boolean(knowledge)}>{view.kind !== 'albums' ? <DailyTakeawayEntry userId={userId}/> : null}

   {message && !selectedId ? <p className="learning-workspace-message" role="status">{message}</p> : null}
   {offline?<p className="learning-workspace-message" role="status">{storageError?'离线且浏览器草稿保存失败，请保持页面开启。':'离线，修改已保存在此浏览器，联网后可继续保存。'}</p>:null}
   {storageError ? <p className="learning-workspace-message learning-error" role="alert">浏览器草稿保存不可用，请及时将修改保存到云端。</p> : null}
   {view.kind === 'albums' ? <AlbumLibrary albums={albums} loading={albumsQuery.isPending} error={albumsQuery.isError ? errorText(albumsQuery.error) : ''} busy={saving} onCreate={() => { setDialogError(''); setAlbumDialog({ album: null, assign: false }); }} onOpen={album => selectView({ kind: 'album', albumId: album.id })} onRetry={() => void albumsQuery.refetch()}/> : <div className={`learning-layout${calendarOpen ? '' : ' rail-collapsed'}${selectedId ? ' has-detail' : ''}`}>
    <aside className="learning-rail" hidden={!calendarOpen}><MonthCalendar month={month} today={today} selectedDate={view.kind === 'date' ? view.date : ''} summaries={monthQuery.data} isLoading={monthQuery.isPending} errorMessage={monthQuery.isError ? errorText(monthQuery.error) : ''} onRetry={() => void monthQuery.refetch()} onMonthChange={setMonth} onSelectDate={date => selectView({ kind: 'date', date })} onSelectToday={() => selectView({ kind: 'date', date: today })} onSelectRecord={selectRecord}/>
    </aside>
    <div className={`learning-main${view.kind === 'all' && !selectedId ? ' learning-main-overview' : ''}`}><section className="learning-list-pane" aria-label="学习记录列表"><header className="learning-list-heading"><div><p className="eyebrow">{view.kind === 'all' ? 'ALL NOTES' : view.kind === 'date' ? 'DAILY NOTES' : view.kind === 'album' ? 'LEARNING ALBUM' : 'LEARNING LIBRARY'}</p><h1>{title}</h1>{view.kind === 'all' ? <p>汇总所有日期和专辑中的记录，按创建时间从新到旧排列。</p> : null}<p>{activeSearch ? '搜索结果 · ' : ''}{recordsQuery.hasNextPage ? '已加载' : '共'} {visibleRecords.length} 条 · 已完成 {completeCount} 条 · 待完成 {visibleRecords.length - completeCount} 条</p>{selectedAlbum?.description ? <p>{selectedAlbum.description}</p> : null}</div><button className="primary-button" type="button" disabled={!draftsReady || saving} onClick={beginRecord}><Plus size={17}/>新增记录</button></header>
      {selectedAlbum ? <div className="learning-album-tools"><button type="button" onClick={() => { setDialogError(''); setAlbumDialog({ album: selectedAlbum, assign: false }); }}><Settings2 size={15}/>编辑专辑</button><button type="button" onClick={() => requestDeleteAlbum(selectedAlbum)}>删除专辑</button><button type="button" onClick={() => enterKnowledge([])}><Layers3 size={15}/>串联知识</button></div> : null}
      {view.kind === 'all' ? <div className="learning-search" role="search" aria-label="搜索学习记录"><Search size={18} aria-hidden="true"/><input type="search" aria-label="搜索学习主题" placeholder="输入主题名称，支持模糊搜索" maxLength={120} value={searchInput} onChange={event => { setSearchInput(event.target.value); setSelectedIds([]); }}/>{searchInput ? <button type="button" onClick={() => setSearchInput('')}>清空搜索</button> : null}</div> : null}
      <div className="learning-list-filters"><label>学习状态<select aria-label="筛选学习状态" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">全部状态</option><option value="待整理">待整理</option><option value="排队中">排队中</option><option value="提炼中">提炼中</option><option value="待保存">待保存</option><option value="提炼失败">提炼失败</option><option value="completed">已完成</option></select></label>{view.kind === 'date' && completeCount > 0 ? <button type="button" onClick={() => setEchoDate(view.date)}>今日回响</button> : null}</div>
      {selectedIds.length ? <div className="learning-bulk" aria-label="批量整理"><span>已选择 {selectedIds.length} 条</span><select aria-label="批量移动到专辑" value="" disabled={saving} onChange={e => { if (e.target.value)
        void move(selectedIds, e.target.value === 'unfiled' ? null : e.target.value); }}><option value="" disabled>移动到…</option><option value="unfiled">未归类</option>{albums.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><button type="button" disabled={!selectedComplete} onClick={() => enterKnowledge()}>串联知识</button><button type="button" onClick={() => setSelectedIds([])}>取消选择</button><small>每次最多整理 100 条；串联请选择 2–14 条已完成记录</small></div> : null}
      {recordsQuery.isError ? <p className="learning-error" role="alert">{errorText(recordsQuery.error)} <button type="button" onClick={() => void recordsQuery.refetch()}>重试加载</button></p> : null}
      {searchPending || recordsQuery.isPending || !draftsReady ? <p className="learning-empty" role="status">{searchPending || activeSearch ? '正在搜索学习主题…' : '正在读取学习记录…'}</p> : filteredRecords.length ? <ul className={`learning-records${view.kind === 'all' ? ' list-view' : ''}`}>{filteredRecords.map(record => <li className={`learning-record-card${selectedId === record.id ? ' selected' : ''}`} key={record.id}><input type="checkbox" aria-label={`选择记录 ${record.attention || '未命名记录'}`} checked={selectedIds.includes(record.id)} disabled={saving || (!selectedIds.includes(record.id) && selectedIds.length >= 100)} onChange={e => setSelectedIds(current => e.target.checked ? [...current, record.id] : current.filter(id => id !== record.id))}/><button className="learning-record-open" type="button" aria-label={`打开记录 ${record.attention || '未命名记录'}`} onClick={() => openRecord(record)}><span className="learning-card-meta"><span className={`learning-state ${record.status === 'completed' ? 'complete' : ''}`}>{drafts[record.id]?.localOnly ? '浏览器草稿' : recordStateLabel(record)}</span><time>{record.date}</time></span><strong>{record.attention || sourceHost(record.sourceUrl) || '未命名记录'}</strong><span className="learning-card-source"><Link2 size={12}/>{sourceHost(record.sourceUrl) || '手动笔记'} · {record.entryMode === 'ai' ? 'AI 提炼' : '手动记录'}</span>{record.summary ? <p>{record.summary.replace(/[#*`]/g, '').slice(0, 90)}</p> : null}<span className="learning-card-album">{albums.find(album => album.id === record.albumId)?.name ?? '未归类'}{drafts[record.id] && !drafts[record.id].localOnly ? ' · 有未保存修改' : ''}</span></button><button className="learning-record-delete" type="button" aria-label={`删除记录 ${record.attention || '未命名记录'}`} title="删除记录" disabled={saving} onClick={() => requestDelete(record)}><Trash2 size={16}/></button></li>)}</ul> : <div className="learning-empty"><BookOpen size={30}/><h3>{activeSearch ? '没有找到匹配的记录' : statusFilter === 'all' ? '从一条记录开始' : '这个状态下还没有记录'}</h3><p>{activeSearch ? '试试更短的主题关键词，或清空搜索查看全部记录。' : view.kind === 'pending' ? '未整理的资料和待保存的 AI 结果会出现在这里。' : '手动写下学习收获，或用 AI 提炼资料链接。'}</p>{statusFilter === 'all' && !activeSearch ? <button className="secondary-button" type="button" onClick={beginRecord}>新增记录</button> : null}</div>}
      {!searchPending && recordsQuery.hasNextPage ? <button className="secondary-button learning-load-more" type="button" disabled={recordsQuery.isFetchingNextPage} onClick={() => void recordsQuery.fetchNextPage()}>{recordsQuery.isFetchingNextPage ? '正在加载…' : '加载更多记录'}</button> : null}
     </section>
     {selectedId ? <div className="learning-detail-pane" role="group" aria-label="学习记录内容" tabIndex={-1} ref={recordContentRef}>{conflict ? <div className="learning-conflict" role="alert"><strong>云端记录已更新，本地修改已保留</strong><p>云端版本 {conflict.version} · 主题：{conflict.attention}</p><p>{conflict.summary.slice(0, 200)}</p><p>云端个人收获：{conflict.inspiration || '未填写'}</p><p>云端专辑：{albums.find(album=>album.id===conflict.albumId)?.name??'未归类'} · 本地专辑：{albums.find(album=>album.id===draft?.albumId)?.name??'未归类'}</p><button type="button" disabled={saving} onClick={() => void save(draft?.pendingSaveStatus??conflict.status, { acceptCloudVersion: conflict.version })}>使用本地修改更新云端</button><button type="button" disabled={saving} onClick={() => { queryClient.setQueryData(learningKeys.record(conflict.id), conflict); void clearLocal(conflict.id); setConflict(null); setMessage('已载入云端版本。'); }}>放弃本地修改并载入云端</button><button type="button" disabled={saving} onClick={() => { if (draft) {
        const copy = { ...draft, id: crypto.randomUUID(), localOnly: true, baseVersion: null, candidateJobId: undefined, needsCloudReview: false };
        setLocal(copy);
        setSelectedId(copy.id);
        setConflict(null);
        setMessage('本地修改已保留为新的独立草稿。');
    } }}>将本地修改另存为新记录</button></div> : null}{draft && draftsReady ? <LearningRecordDetail key={draft.id} record={selectedRecord} draft={draft} albums={albums} saving={saving} storageError={storageError} message={message} saveFeedback={saveFeedback?.recordId === draft.id ? saveFeedback : null} duplicates={duplicates} onOpenRecord={record => { selectView({ kind: 'date', date: record.date }); openRecord(record); }} onChange={change => { setSaveFeedback(null); setMessage(''); setLocal({ ...draft, ...change, updatedAt: new Date().toISOString() }); }} onSave={save} onRefresh={refresh} onMove={albumId => { if (draft.localOnly)
        setLocal({ ...draft, albumId });
    else
        void move([draft.id], albumId); }} onBack={() => setSelectedId(null)} onNewLink={beginRecord} onCreateAlbum={() => { setDialogError(''); setAlbumDialog({ album: null, assign: true }); }} onCancel={() => void cancelEditing()}/> : <div className="learning-empty"><p role={detailQuery.isError ? 'alert' : 'status'}>{detailQuery.isError ? errorText(detailQuery.error) : '正在打开记录…'}</p><button type="button" onClick={() => setSelectedId(null)}>返回列表</button>{detailQuery.isError ? <button type="button" onClick={() => void detailQuery.refetch()}>重试</button> : null}</div>}</div> : view.kind === 'all' ? null : <div className="learning-detail-placeholder"><CurrentLearningPersona initialProfile={initialProfile}/><BookOpen size={34}/><h2>把每次学习，放在自己的位置</h2><p>选择一条记录继续阅读，或直接创建新的学习记录。</p><p>日历回看每天的收获，专辑串起长期的主题。</p></div>}
    </div>
   </div>}
  </div>
 </section>
 {albumDialog ? <AlbumDialog key={albumDialog.album?.id ?? 'new'} album={albumDialog.album} busy={saving} error={dialogError} onClose={() => { setAlbumDialog(null); setDialogError(''); }} onSave={(name, description) => void saveAlbum(name, description)}/> : null}
 {confirm ? <LearningDialog title={confirm.title} busy={saving} onClose={() => setConfirm(null)}><p>{confirm.description}</p>{dialogError ? <p role="alert">{dialogError}</p> : null}<div className="dialog-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setConfirm(null)}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={() => void runConfirmation()}>{saving ? '正在处理…' : '确认'}</button></div></LearningDialog> : null}
 {echoDate ? <DailyEchoDialog date={echoDate} onClose={() => setEchoDate(null)}/> : null}
 {celebrating && !echoDate ? <div className="celebration-banner" role="status"><Check size={18}/>这一天的学习收获已收下</div> : null}
 </main>;
}
