import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { KnowledgeMapReader } from '@/features/knowledge-narratives/knowledge-map-reader';
import type { KnowledgeNarrative } from '@/lib/domain/knowledge-narrative';
afterEach(cleanup);
it('renders both original snapshots when their learning date is identical', () => {
  const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
  const result={schemaVersion:3 as const,mode:'source_records' as const,title:'同一天',reason:'mixed_topics' as const,sourceRecordIds:ids};
  const narrative:KnowledgeNarrative={id:ids[0],title:'同一天',dates:['2026-10-14'],question:'',status:'succeeded',createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z',error:null,changedDates:[],result,
    sources:ids.map((id,i)=>({id,date:'2026-10-14',attention:['产品访谈','网球训练'][i],summary:['访谈原文','训练原文'][i],inspiration:'',version:1,sourceUrl:'',hasImage:false}))};
  render(<KnowledgeMapReader narrative={narrative} result={result}/>);
  expect(screen.getByText('访谈原文')).toBeInTheDocument();
  expect(screen.getByText('训练原文')).toBeInTheDocument();
});
