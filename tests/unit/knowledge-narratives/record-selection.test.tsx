import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { KnowledgeWorkspace } from '@/features/knowledge-narratives/knowledge-workspace';
import { TestQueryProvider } from '@/tests/helpers/test-query-provider';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('submits same-day mixed-mode records by ID instead of losing them to date selection',async()=>{
 const records=ids.map((id,i)=>({id,date:'2026-10-14',attention:['产品访谈','AI 访谈整理'][i],entryMode:i?'ai':'manual',sourceUrl:'',summary:'资料',inspiration:'',version:1,status:'completed'}));
 let sent:Record<string,unknown>|undefined;
 vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
  const url=String(input);
  let data:unknown=[];
  if(url.startsWith('/api/records?')) data={records,nextCursor:null};
  else if(url.startsWith('/api/records/')) data=records.find(record=>url.endsWith(record.id));
  else if(url==='/api/knowledge-narratives'&&init?.method==='POST'){
   sent=JSON.parse(init.body);data={id:ids[0],title:'脉络',dates:['2026-10-14'],sources:records,status:'queued',changedDates:[],question:'',createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z'};
  }
  else if(url.startsWith('/api/knowledge-narratives/')) data={id:ids[0],title:'脉络',dates:['2026-10-14'],sources:records,status:'queued',changedDates:[],question:''};
  return Response.json({ok:true,data,requestId:'test'});
 }));
 render(<TestQueryProvider><KnowledgeWorkspace userId='owner' today='2026-10-15' initialRecordIds={ids} onClose={vi.fn()}/></TestQueryProvider>);
 const user=userEvent.setup();
 await screen.findByRole('checkbox',{name:/产品访谈/});
 await user.click(screen.getByRole('button',{name:'生成知识脉络'}));
 await waitFor(()=>expect(sent).toMatchObject({recordIds:ids}));
 expect(sent).not.toHaveProperty('dates');expect(sent).not.toHaveProperty('entryMode');
});
