import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ManagedAntigravity} from './managed';
it('persists the native conversation ID and complete history without rerunning the CLI',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agy-history-'));const storeFile=join(root,'state.json');let calls=0;
 try{
  const m=new ManagedAntigravity({workspace:root,storeFile,launch:async(_s,_t,chunk,meta)=>{calls++;meta?.({nativeId:'12345678-1234-1234-1234-123456789abc'});chunk?.('partial');return{text:'complete',nativeId:'12345678-1234-1234-1234-123456789abc'};}});
  const s=m.create();await m.send(s.id,'hello');
  const restored=new ManagedAntigravity({workspace:root,storeFile});
  expect(restored.list()[0]).toMatchObject({id:s.id,nativeId:'12345678-1234-1234-1234-123456789abc',status:'idle'});
  expect(restored.history(s.id)[1]).toMatchObject({text:'complete',complete:true});expect(calls).toBe(1);
 }finally{rmSync(root,{recursive:true,force:true});}
});