import {it,expect} from 'vitest';
import {CliReply, cliArgs} from './cli';
it('uses official safe stdin protocol and resumes only an explicit conversation',()=>{
 const args=cliArgs('12345678-1234-1234-1234-123456789abc');
 expect(args).toContain('--sandbox'); expect(args).toContain('plan');
 expect(args).toContain('--conversation');expect(args).not.toContain('--dangerously-skip-permissions');expect(args).not.toContain('--continue');
});
it('assembles real deltas and replaces the final result without duplication',()=>{
 const r=new CliReply();r.accept({event:'init',conversation_id:'id',init:{model:'gemini-4-argon-medium'}});
 r.accept({event:'step_update',step_update:{step_type:'agent_response',text_delta:'OK'}});
 r.accept({event:'result',result:{conversation_id:'id',status:'SUCCESS',response:'OK',usage:{total_tokens:12}}});
 expect(r.text).toBe('OK');expect(r.nativeId).toBe('id');expect(r.done).toBe(true);expect(r.usage.total_tokens).toBe(12);
});
it('requires a native successful result, not just stdout or exit zero',()=>{
 const r=new CliReply();expect(()=>r.finish()).toThrow();
 expect(()=>r.accept({event:'result',result:{status:'ERROR',error:'quota exhausted'}})).toThrow('quota exhausted');
});