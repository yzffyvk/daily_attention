"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import "./record-source-picker.css";
import { requestApi } from "@/features/checkins/api";
import type { CheckInRecord } from "@/features/checkins/types";

function sourceHost(url:string) { try{return new URL(url).hostname;}catch{return "资料链接";} }

type RecordPage = { records: CheckInRecord[]; nextCursor: string | null };
export function RecordSourcePicker({ userId, selectedIds, onChange, initialAlbumId, disabled }: {
  userId: string; selectedIds: string[]; onChange: (ids: string[]) => void;
  initialAlbumId?: string | null; disabled: boolean;
}) {
  const [album, setAlbum] = useState(initialAlbumId === null ? "unfiled" : initialAlbumId ?? "all");
  const albums = useQuery({ queryKey: ["learning-albums", userId], queryFn: () => requestApi<Array<{id:string;name:string}>>("/api/albums") });
  const records = useInfiniteQuery({
    queryKey: ["narrative-record-sources", userId, album], initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ status: "completed", limit: "50" });
      if (album === "unfiled") query.set("unfiled", "true");
      else if (album !== "all") query.set("albumId", album);
      if (pageParam) query.set("cursor", pageParam);
      return requestApi<RecordPage>(`/api/records?${query}`);
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  const selected = useQuery({
    queryKey: ["narrative-selected-records", userId, selectedIds], enabled: selectedIds.length > 0,
    queryFn: () => Promise.all(selectedIds.map(id => requestApi<CheckInRecord>(`/api/records/${encodeURIComponent(id)}`))),
  });
  const all = records.data?.pages.flatMap(page => page.records) ?? [];
  function toggle(id: string) {
    if (disabled) return;
    onChange(selectedIds.includes(id) ? selectedIds.filter(item => item !== id) : selectedIds.length < 14 ? [...selectedIds, id].sort() : selectedIds);
  }
  return <section className="record-source-picker" aria-label="选择学习记录">
    <label>按专辑筛选<select aria-label="来源专辑" value={album} onChange={event => setAlbum(event.target.value)} disabled={disabled}>
      <option value="all">全部专辑</option><option value="unfiled">未归类</option>
      {albums.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {albums.isError ? <p role="alert">专辑读取失败，仍可从全部记录选择。<button type="button" onClick={()=>void albums.refetch()}>重试专辑</button></p> : null}
    {selectedIds.length ? <div className="knowledge-selected-records"><h4>已选记录（{selectedIds.length}）</h4>
      {selected.isPending ? <p role="status">正在读取已选记录…</p> : null}
      {selected.isError ? <p role="alert">部分已选记录已删除或暂时无法读取。<button type="button" onClick={()=>void selected.refetch()}>重试</button><button type="button" disabled={disabled} onClick={()=>onChange([])}>清空选择</button></p> : null}
      <ul>{selected.data?.map(record => <li key={record.id}><span>{record.date} · {record.attention}</span><button type="button" disabled={disabled} aria-label={`移除 ${record.attention}`} onClick={()=>toggle(record.id)}>移除</button></li>)}</ul>
    </div> : null}
    {records.isPending ? <p role="status">正在读取已完成记录…</p> : null}
    {records.isError ? <p role="alert">读取记录失败。<button type="button" onClick={()=>void records.refetch()}>重试</button></p> : null}
    {!records.isPending && !records.isError && !all.length ? <p>这里还没有已完成记录，确认学习内容后即可参与串联。</p> : null}
    <ul className="knowledge-record-options">{all.map((record,index) => <li key={record.id}>
      {(index === 0 || all[index-1].date !== record.date) ? <h4><time>{record.date}</time></h4> : null}
      <label><input type="checkbox" checked={selectedIds.includes(record.id)} disabled={disabled || (!selectedIds.includes(record.id) && selectedIds.length >= 14)} onChange={()=>toggle(record.id)} />
        <span><strong>{record.attention}</strong><small>{record.entryMode === "ai" ? "AI 提炼" : "手动记录"}{record.sourceUrl ? ` · ${sourceHost(record.sourceUrl)}` : ""}</small></span>
      </label>
    </li>)}</ul>
    {records.hasNextPage ? <button className="secondary-button" type="button" disabled={records.isFetchingNextPage} onClick={()=>void records.fetchNextPage()}>{records.isFetchingNextPage ? "正在读取…" : "加载更多记录"}</button> : null}
  </section>;
}
