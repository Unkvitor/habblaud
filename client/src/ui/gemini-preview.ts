import {h} from './dom';
import {renderMarkdown} from './markdown';
import {shouldFollowGeminiScroll} from './gemini-scroll';
import {tr} from '../../../shared/i18n';
type Session={id:string;title?:string;nativeId?:string;cwd:string;status:string;model?:string;error?:string;usage?:Record<string,number>};

async function checkGeminiMode(root: HTMLElement, intro: HTMLElement): Promise<void> {
  const notice = document.createElement('small');
  notice.className = 'gemini-server-mode';
  notice.setAttribute('role', 'status');
  notice.style.cssText = 'margin-left:8px;font-size:.72rem;color:var(--ui-muted)';

  notice.textContent = tr('Verificando modo Gemini...');
  root.querySelector('strong')?.append(' ', notice);

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
        tr('DEMONSTRAÇÃO · Respostas locais · 0 tokens de IA');
      notice.dataset.mode = 'demo';

      intro.textContent = tr('Execu\u00e7\u00e3o simulada pelo servidor. Nenhum token de IA \u00e9 consumido.');
    } else if (
      info.mode === 'real' &&
      info.simulated === false &&
      info.consumesTokens === true
    ) {
      notice.textContent =
        tr('CLI REAL · As mensagens podem consumir tokens de IA');
      notice.dataset.mode = 'real';
    } else {
      throw new Error('Modo inconsistente');
    }
  } catch {
    notice.textContent = tr('Modo Gemini não confirmado.');
    notice.dataset.mode = 'unavailable';
  }
}

export function mountGeminiPreview(root:HTMLElement):{activate:()=>void;deactivate:()=>void}{
 const select=h('select',{attrs:{'aria-label':tr('Sessão Gemini')}});
 const cwd=h('input',{attrs:{'aria-label':tr('Workspace Gemini'),placeholder:tr('Subdiretório opcional do workspace')}});
 const create=h('button',{class:'ui-btn',text:tr('Preparar conversa Gemini')});
 const recover=h('button',{class:'ui-btn',text:tr('Liberar após conferir erro'),hidden:true});
 const cancel=h('button',{class:'ui-btn',text:tr('Cancelar execu\u00e7\u00e3o'),hidden:true});
 const rename=h('button',{
   class:'ui-btn',
   text:tr('Renomear'),
   attrs:{'aria-label':tr('Renomear conversa Gemini')}
 });
 const remove=h('button',{
   class:'ui-btn',
   text:tr('Excluir'),
   attrs:{'aria-label':tr('Excluir conversa Gemini')}
 });
 const status=h('p',{attrs:{role:'status','aria-live':'polite'}});
 const connection=h('small',{class:'native-gemini-connection',attrs:{role:'status','aria-live':'polite'},text:tr('Desconectado')});
 const history=h('div',{class:'native-history',attrs:{'aria-label':tr('Histórico Gemini')}});
 history.style.cssText =
  'flex:1 1 auto;min-height:0;overflow-y:auto;' +
  'overscroll-behavior:contain;';
 const input=h('textarea',{attrs:{'aria-label':tr('Mensagem ao Gemini'),rows:3,maxlength:32000}});
 const send=h('button',{class:'ui-btn ui-btn--primary',type:'submit',text:tr('Enviar ao Gemini')});
 const form=h('form',{},input,send);
 form.style.flexShrink='0';
 const intro=h('p',{text:tr('Execu\u00e7\u00e3o real somente ao enviar. Modelo gemini-4-argon-medium; modo plano e sandbox. Cada envio consome cota.')});
 const options=h('details',{class:'native-gemini-options'},h('summary',{text:tr('Op\u00e7\u00f5es e seguran\u00e7a')}),
  h('div',{class:'native-toolbar'},cwd,rename,remove),intro,h('p',{class:'native-hint',text:tr('O protocolo headless não recebe decisões de aprovação. Operações que exigem confirmação podem ser recusadas pelo CLI. Use o terminal original para autorizações; nenhuma permissão automática é habilitada.')}));
 const box=h('section',{class:'native-gemini-chat',attrs:{'aria-label':tr('Conversa Gemini')}},
 h('div',{class:'native-gemini-heading'},h('strong',{text:tr('Gemini · Antigravity CLI')}),connection),
 h('div',{class:'native-toolbar'},select,create),
 options,
 status,recover,cancel,history,form);
 root.replaceChildren(box);
 void checkGeminiMode(box,intro);
 let selected=localStorage.getItem('habblaud-gemini-session')||'';let sessions:Session[]=[];let sending=false;let generation=0;
 const cancelRequested=new Set<string>();



 let followBottom=true;
 let programmaticScroll=false;
 let scrollRevision=0;
 const scrollToLatest=()=>{
  if(!followBottom)return;
  programmaticScroll=true;
  const revision=++scrollRevision;
  requestAnimationFrame(()=>{
   if(revision!==scrollRevision)return;
   if(followBottom)history.scrollTop=history.scrollHeight;
   requestAnimationFrame(()=>{if(revision===scrollRevision)programmaticScroll=false;});
  });
 };

 history.addEventListener('wheel',(event)=>{
  if(event.deltaY<0)followBottom=false;
 },{passive:true});

 history.addEventListener('scroll',()=>{
  if(programmaticScroll)return;
  followBottom=shouldFollowGeminiScroll(
   history.scrollHeight,
   history.scrollTop,
   history.clientHeight
  );
 },{passive:true});
 const api=async(path:string,body?:unknown)=>{
  const response=await fetch('/api/native-gemini'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Habblaud-Client':'gemini-preview'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||tr('Antigravity indisponível.'));return data;
 };
 const error=(e:unknown)=>{status.textContent=e instanceof Error?e.message:tr('Erro Gemini.');};
 const copyButton=(value:string,label:string)=>{
  const button=h('button',{class:'ui-btn native-gemini-copy',type:'button',text:label,attrs:{'aria-label':label}});
  button.onclick=()=>{void navigator.clipboard.writeText(value).then(()=>{button.textContent=tr('Copiado');}).catch(error);};
  return button;
 };
 const renderMessage=(m:{id:string;role:string;text:string;complete:boolean})=>{
  const article=h('article',{class:'native-item',attrs:{'data-gemini-message':m.id}},h('strong',{text:m.role==='user'?tr('Voc\u00ea'):'Gemini'}));
  if(m.role==='assistant'&&m.complete){
   const body=h('div',{class:'ui-md native-gemini-rendered'});body.append(renderMarkdown(m.text));
   body.querySelectorAll('.ui-md__block').forEach(block=>{
    const code=block.querySelector('pre')?.textContent;
    if(code)block.append(copyButton(code,tr('Copiar c\u00f3digo')));
   });
   article.append(body,copyButton(m.text,tr('Copiar resposta')));
  }else{
   article.append(h('pre',{class:'native-gemini-stream',text:m.text}));
   if(m.role==='assistant'&&!m.complete)article.append(h('small',{text:tr('Resposta incompleta')}));
  }
  return article;
 };
 const stateName:Record<string,string>={idle:tr('Ocioso'),working:tr('Gemini est\u00e1 respondendo...'),error:tr('Erro'),closed:tr('Encerrada')};
 const refresh=async()=>{
  const version=++generation;const list=await api('/sessions');if(version!==generation)return;sessions=list.data;
  select.replaceChildren(...sessions.map(s=>h('option',{text:`${s.title||s.nativeId?.slice(0,8)||tr('Conversa preparada')} · ${stateName[s.status]||s.status}`,attrs:{value:s.id}})));
  if(!sessions.some(s=>s.id===selected))selected=sessions[0]?.id||'';select.value=selected;localStorage.setItem('habblaud-gemini-session',selected);
  const s=sessions.find(s=>s.id===selected);send.disabled=!s||s.status!=='idle'||sending;input.disabled=send.disabled;
  recover.hidden=s?.status!=='error';
  options.hidden=s?.status==='working';if(options.hidden)options.open=false;
  cancel.hidden=s?.status!=='working';cancel.disabled=!!s&&cancelRequested.has(s.id);
  if(s?.status!=='working'&&s)cancelRequested.delete(s.id);
  rename.disabled=!s||s.status==='working'||sending;
  remove.disabled=!s||s.status==='working'||sending;
  const total=s?.usage?.total_tokens;
  const usage=typeof total==='number'&&Number.isFinite(total)?' \u00b7 '+tr('Total reportado pelo CLI: {0} tokens',[total]):'';
  status.textContent=s?`${s.model||'gemini-4-argon-medium'} \u00b7 ${cancelRequested.has(s.id)?tr('Cancelando...'):stateName[s.status]||s.status}${s.error?' \u00b7 '+s.error:''}${usage}`:tr('Prepare uma conversa; nenhum modelo ser\u00e1 iniciado antes do envio.');
  if(!s){history.replaceChildren();return;}
  const page=await api('/history?id='+encodeURIComponent(s.id));if(version!==generation)return;
  history.replaceChildren(...page.data.map((m:any)=>renderMessage(m)));
  scrollToLatest();
 };
 select.onchange=()=>{selected=select.value;followBottom=true;void refresh().catch(error);};
 create.onclick=()=>{create.disabled=true;void api('/create',cwd.value.trim()?{cwd:cwd.value.trim()}:{}).then(s=>{selected=s.id;return refresh();}).catch(error).finally(()=>{create.disabled=false;});};
 recover.onclick=()=>{void api('/recover',{id:selected}).then(refresh).catch(error);};
 cancel.onclick=()=>{
  const id=selected;if(!id||cancelRequested.has(id))return;
  cancelRequested.add(id);cancel.disabled=true;
  void api('/cancel',{id}).catch(e=>{cancelRequested.delete(id);error(e);}).finally(()=>{void refresh().catch(error);});
 };

 rename.onclick=()=>{
  const s=sessions.find(item=>item.id===selected);
  if(!s||s.status==='working'||sending)return;
  const title=window.prompt(
   tr('Nome da conversa Gemini (até 80 caracteres):'),
   s.title||''
  );
  if(title===null)return;
  if(!title.trim()||title.trim().length>80){
   status.textContent=tr('Informe um nome de 1 a 80 caracteres.');
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
   tr('Excluir definitivamente esta conversa Gemini e seu histórico?')
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
  options.open=false;sending=true;send.disabled=true;followBottom=true;const text=input.value;const id=selected;input.value='';scrollToLatest();
  void api('/send',{id,text}).catch(e=>{if(selected===id&&!input.value)input.value=text;error(e);}).finally(()=>{sending=false;void refresh().catch(error);});
 };
 input.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();form.requestSubmit();}
 });
 let events:EventSource|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const activate=()=>{
  if(events)return;
  void refresh().catch(error);
  connection.textContent=tr('Conectando...');
  events=new EventSource('/api/native-gemini/events');
  events.onopen=()=>{connection.textContent=tr('SSE conectado');};
  events.onmessage=e=>{
   let event:any;
   try{event=JSON.parse(e.data);}catch{return;}
   if(event.method==='message/delta'){
    if(event.sessionId!==selected||!event.message)return;
    generation++;
    const node=history.querySelector(`[data-gemini-message="${event.message.id}"] pre.native-gemini-stream`);
    if(followBottom)programmaticScroll=true;
    if(node)node.textContent=event.message.text;
    else history.append(renderMessage({...event.message,role:'assistant',complete:false}));
    scrollToLatest();
   }else if(event.method!=='session/progress'){
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=undefined;void refresh().catch(error);},60);
   }
  };
  events.onerror=()=>{connection.textContent=tr('Reconectando SSE');status.textContent=tr('Reconectando Gemini; mensagens n\u00e3o ser\u00e3o reenviadas.');};
 };
 const deactivate=()=>{
  events?.close();events=undefined;connection.textContent=tr('Desconectado');
  if(timer){clearTimeout(timer);timer=undefined;}
 };
 return {activate,deactivate};
}
