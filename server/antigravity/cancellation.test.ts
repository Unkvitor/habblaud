import {it,expect} from 'vitest';
import {ManagedAntigravity} from './managed';

it('cancels only an active managed turn and keeps its partial answer for review',async()=>{
 let started=0;
 const manager=new ManagedAntigravity({workspace:process.cwd(),launch:(_session,_text,onChunk,_meta,signal)=>{
  started++;onChunk?.('partial');
  return new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
 }});
 const first=manager.create(),second=manager.create();
 const turn=manager.send(first.id,'short');
 expect(()=>manager.cancel(second.id)).toThrow();
 manager.cancel(first.id);
 await expect(turn).rejects.toThrow();
 expect(manager.list().find(s=>s.id===first.id)?.status).toBe('error');
 expect(manager.history(first.id).at(-1)).toMatchObject({text:'partial',complete:false});
 expect(started).toBe(1);
 expect(()=>manager.cancel(first.id)).toThrow();
});
