import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import type { Database } from '@/lib/supabase/database.types';
import { createLearningRepository } from '@/server/learning/repository';

it('applies literal partial title search with ownership and pagination in the database request',async()=>{
 const requests:URL[]=[];
 const client=createClient<Database>('https://database.test','test-key',{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:async input=>{requests.push(new URL(String(input)));return Response.json([]);}},
 });
 const time='2026-09-01T00:00:00Z';const id='00000000-0000-4000-8000-000000000001';
 await createLearningRepository(client).list('owner',{search:'50%_复盘',limit:50,cursor:`${time}|${id}`});
 const params=requests[0].searchParams;
 expect(params.get('attention')).toBe('ilike.%50\\%\\_复盘%');
 expect(params.get('user_id')).toBe('eq.owner');
 expect(params.get('limit')).toBe('51');
 expect(params.get('order')).toBe('created_at.desc,id.desc');
 expect(params.get('or')).toContain(`created_at.lt.${time}`);
 expect(params.has('summary')).toBe(false);
});
