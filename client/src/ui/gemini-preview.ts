import {h} from './dom';
import {tr} from '../../../shared/i18n';
type Session={id:string;title?:string;nativeId?:string;cwd:string;status:string;model?:string;error?:string;usage?:Record<string,number>};

async function checkGeminiMode(root: HTMLElement): Promise<void> {
  const notice = document.createElement('p');
  notice.className = 'gemini-server-mode';
  notice.setAttribute('role', 'status');
  notice.style.cssText =
    'padding:9px 12px;border:1px solid rgba(128,128,128,.35);' +
    'border-radius:9px;margin:8px 0;font-size:.85rem';

  notice.textContent = 'Verificando modo Gemini...';
  root.prepend(notice);

  try {
    const response = await fetch('/api/native-gemini/mode', {
      cache: 'no-store'
    });

    if (!response.ok) throw new Error('API indisponível');

    const info = await response.json();

    if (
      info.mode === 'demo' &&
      info.simulated === true &&
      info.consumesTokens === false
    ) {
      notice.textContent =
        'DEMONSTRAÇÃO · Respostas locais · 0 tokens de IA';
      notice.dataset.mode = 'demo';

      // Corrige o aviso legado somente quando o servidor
      // confirma que a execução está em modo simulado.
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
      );

      while (walker.nextNode()) {
        const node = walker.currentNode;
        const value = node.textContent ?? '';

        if (value.includes('Execução real somente ao enviar')) {
          node.textContent = value
            .replace(
              /Execução real somente ao enviar\./g,
              'Execução simulada pelo servidor.'
            )
            .replace(
              /Cada envio consome cota\./g,
              'Nenhum token de IA é consumido.'
            );
        }
      }
    } else if (
      info.mode === 'real' &&
      info.simulated === false &&
      info.consumesTokens === true
    ) {
      notice.textContent =
        'CLI REAL · As mensagens podem consumir tokens de IA';
      notice.dataset.mode = 'real';
    } else {
      throw new Error('Modo inconsistente');
    }
  } catch {
    notice.textContent = 'Modo Gemini não confirmado.';
    notice.dataset.mode = 'unavailable';
  }
}

export function mountGeminiPreview(root:HTMLElement):void{
  void checkGeminiMode(root);
 const select=h('select',{attrs:{'aria-label':tr('Sessão Gemini')}});
 const cwd=h('input',{attrs:{'aria-label':tr('Workspace Gemini'),placeholder:tr('Subdiretório opcional do workspace')}});
 const create=h('button',{class:'ui-btn',text:tr('Preparar conversa Gemini')});
 const recover=h('button',{class:'ui-btn',text:tr('Liberar após conferir erro'),hidden:true});
 const rename=h('button',{
   class:'ui-btn',
   text:'Renomear',
   attrs:{'aria-label':'Renomear conversa Gemini'}
 });
 const remove=h('button',{
   class:'ui-btn',
   text:'Excluir',
   attrs:{'aria-label':'Excluir conversa Gemini'}
 });
 const status=h('p',{attrs:{role:'status','aria-live':'polite'}});
 const history=h('div',{class:'native-history',attrs:{'aria-label':tr('Histórico Gemini')}});
 const input=h('textarea',{attrs:{'aria-label':tr('Mensagem ao Gemini'),rows:3,maxlength:32000}});
 const send=h('button',{class:'ui-btn ui-btn--primary',type:'submit',text:tr('Enviar ao Gemini')});
 const form=h('form',{},input,send);
 const box=h('section',{attrs:{'aria-label':tr('Conversa Gemini')},style:'display:flex;flex-direction:column;gap:10px;min-height:280px;height:100%;overflow:auto'},
 h('strong',{text:'Gemini · Antigravity CLI'}),h('p',{text:tr('Execução real somente ao enviar. Modelo gemini-4-argon-medium; modo plano e sandbox. Cada envio consome cota.')}),
 h('div',{class:'native-toolbar'},select,cwd,create,rename,remove),
 status,recover,history,form,
 h('p',{class:'native-hint',text:tr('O protocolo headless não recebe decisões de aprovação. Operações que exigem confirmação podem ser recusadas pelo CLI. Use o terminal original para autorizações; nenhuma permissão automática é habilitada.')}));
 root.replaceChildren(box);
 let selected=localStorage.getItem('habblaud-gemini-session')||'';let sessions:Session[]=[];let sending=false;let generation=0;
 const api=async(path:string,body?:unknown)=>{
  const response=await fetch('/api/native-gemini'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Habblaud-Client':'gemini-preview'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||tr('Antigravity indisponível.'));return data;
 };
 const error=(e:unknown)=>{status.textContent=e instanceof Error?e.message:tr('Erro Gemini.');};
 const refresh=async()=>{
  const version=++generation;const list=await api('/sessions');if(version!==generation)return;sessions=list.data;
  select.replaceChildren(...sessions.map(s=>h('option',{text:`${s.title||s.nativeId?.slice(0,8)||tr('Conversa preparada')} · ${s.status}`,attrs:{value:s.id}})));
  if(!sessions.some(s=>s.id===selected))selected=sessions[0]?.id||'';select.value=selected;localStorage.setItem('habblaud-gemini-session',selected);
  const s=sessions.find(s=>s.id===selected);send.disabled=!s||s.status!=='idle'||sending;input.disabled=send.disabled;
  recover.hidden=s?.status!=='error';
  rename.disabled=!s||s.status==='working'||sending;
  remove.disabled=!s||s.status==='working'||sending;
  status.textContent=s?`${s.model||'gemini-4-argon-medium'} · ${s.status}${s.error?' · '+s.error:''}${s.usage?' · '+tr('Tokens nativos: {0}',[s.usage.total_tokens??0]):''}`:tr('Prepare uma conversa; nenhum modelo será iniciado antes do envio.');
  if(!s){history.replaceChildren();return;}
  const page=await api('/history?id='+encodeURIComponent(s.id));if(version!==generation)return;
  history.replaceChildren(...page.data.map((m:any)=>h('article',{class:'native-item',attrs:{'data-gemini-message':m.id}},h('strong',{text:m.role==='user'?tr('Você'):'Gemini'}),h('pre',{text:m.text+(m.complete?'':tr(' [resposta incompleta]'))}))));
  history.scrollTop=history.scrollHeight;
 };
 select.onchange=()=>{selected=select.value;void refresh().catch(error);};
 create.onclick=()=>{create.disabled=true;void api('/create',cwd.value.trim()?{cwd:cwd.value.trim()}:{}).then(s=>{selected=s.id;return refresh();}).catch(error).finally(()=>{create.disabled=false;});};
 recover.onclick=()=>{void api('/recover',{id:selected}).then(refresh).catch(error);};

 rename.onclick=()=>{
  const s=sessions.find(item=>item.id===selected);
  if(!s||s.status==='working'||sending)return;
  const title=window.prompt(
   'Nome da conversa Gemini (até 80 caracteres):',
   s.title||''
  );
  if(title===null)return;
  if(!title.trim()||title.trim().length>80){
   status.textContent='Informe um nome de 1 a 80 caracteres.';
   return;
  }
  rename.disabled=true;
  void api('/rename',{id:s.id,title:title.trim()})
   .then(refresh).catch(error)
   .finally(()=>{rename.disabled=false;});
 };

 remove.onclick=()=>{
  const s=sessions.find(item=>item.id===selected);
  if(!s||s.status==='working'||sending)return;
  const confirmed=window.confirm(
   'Excluir definitivamente esta conversa Gemini e seu histórico?'
  );
  if(!confirmed)return;
  remove.disabled=true;
  void api('/delete',{id:s.id})
   .then(()=>{
    selected='';
    localStorage.removeItem('habblaud-gemini-session');
    return refresh();
   })
   .catch(error)
   .finally(()=>{remove.disabled=false;});
 };

 form.onsubmit=e=>{
  e.preventDefault();if(sending||!selected||!input.value.trim())return;
  sending=true;send.disabled=true;const text=input.value;input.value='';
  void api('/send',{id:selected,text}).then(refresh).catch(error).finally(()=>{sending=false;void refresh().catch(error);});
 };
 const events=new EventSource('/api/native-gemini/events');let timer:ReturnType<typeof setTimeout>|undefined;
 events.onmessage=e=>{
  const event=JSON.parse(e.data);
  if(event.method==='message/delta' && event.sessionId===selected && event.message){
   const node=history.querySelector(`[data-gemini-message="${event.message.id}"] pre`);
   if(node)node.textContent=event.message.text;
   else history.append(h('article',{class:'native-item',attrs:{'data-gemini-message':event.message.id}},h('strong',{text:'Gemini'}),h('pre',{text:event.message.text})));
  }else if(event.method!=='session/progress'){
   if(timer)clearTimeout(timer);timer=setTimeout(()=>{void refresh().catch(error);},60);
  }
 };
 events.onerror=()=>{status.textContent=tr('Reconectando Gemini; mensagens não serão reenviadas.');};
 void refresh().catch(error);
}