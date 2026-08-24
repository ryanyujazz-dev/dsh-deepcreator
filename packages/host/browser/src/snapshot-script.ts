/** Provider-neutral interactive DOM extraction policy. */
export const INTERACTIVE_SNAPSHOT_SCRIPT = `()=>{const cssPath=element=>{if(element.id)return'#'+CSS.escape(element.id);const parts=[];let current=element;while(current&&current!==document.documentElement){const name=current.tagName.toLowerCase();const siblings=current.parentElement?[...current.parentElement.children].filter(child=>child.tagName===current.tagName):[];parts.unshift(name+':nth-of-type('+Math.max(1,siblings.indexOf(current)+1)+')');current=current.parentElement}return parts.join(' > ')};const visible=el=>{const input=el;if(input.type==='hidden'||el.hasAttribute('hidden')||el.hasAttribute('inert')||el.getAttribute('aria-hidden')==='true')return false;const bounds=el.getBoundingClientRect(),style=getComputedStyle(el);return bounds.width>0&&bounds.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0'};const editable=new Set(['text','search','email','tel','url','number','range','color','date','time','datetime-local','month','week']);return[...document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')].filter(visible).slice(0,500).map(el=>{const input=el,role=el.getAttribute('role')||el.tagName.toLowerCase(),name=(el.getAttribute('aria-label')||el.getAttribute('title')||el.innerText||input.placeholder||'').trim().slice(0,240),inputType=input.type||undefined,autocomplete=input.autocomplete||undefined,identity=[el.id,el.getAttribute('name'),inputType,autocomplete].filter(Boolean).join(' '),sensitive=inputType==='password'||autocomplete==='one-time-code'||String(autocomplete||'').startsWith('cc-')||/(?:token|secret|signature|authorization|authenticity|csrf|xsrf|session|credential|otp|passcode|api[-_]?key)/i.test(identity),exposesValue=el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement||(el instanceof HTMLInputElement&&editable.has(input.type));return{selector:cssPath(el),role,name,...(sensitive||!exposesValue?{}:{value:String(input.value||'').slice(0,240)}),...(inputType?{inputType}:{}),...(autocomplete?{autocomplete}:{})}})}`

export interface BrowserSnapshotScriptRow {
  selector: string
  role: string
  name: string
  value?: string
  inputType?: string
  autocomplete?: string
}

/** Provider-neutral, bounded document reader shared by IAB and managed Playwright. */
export const DOCUMENT_EXTRACTION_SCRIPT = String.raw`(input={})=>{
  const SOURCE_LIMIT=2*1024*1024,DEFAULT_PAGE=12000,MAX_PAGE=20000;
  const contentType=String(document.contentType||'text/html').toLowerCase();
  const raw=contentType==='text/plain'||contentType==='application/json'||contentType==='application/xml'||contentType==='text/xml'||location.hostname==='raw.githubusercontent.com';
  const hidden=el=>{for(let node=el;node&&node!==document.documentElement;node=node.parentElement){if(node.matches('script,style,noscript,template,svg,[hidden],[inert],[aria-hidden="true"]'))return true;const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return true}return false};
  const safeUrl=value=>{try{const url=new URL(value,location.href);if(!['http:','https:'].includes(url.protocol))return'';url.username='';url.password='';url.search='';url.hash='';return url.href}catch{return''}};
  const clean=value=>String(value||'').replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  let sections=[];
  if(raw){const source=document.querySelector('pre')||document.body;sections=[clean(source?.textContent||'')]}
  else{const root=document.querySelector('main,article')||document.body;if(root){const nodes=[...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,tr,dt,dd')].filter(el=>!hidden(el)&&!(el.matches('li')&&el.querySelector(':scope > ul,:scope > ol')));for(const el of nodes){let value='';if(el.matches('tr'))value=[...el.querySelectorAll(':scope > th,:scope > td')].map(cell=>clean(cell.innerText||cell.textContent||'')).filter(Boolean).join(' | ');else value=clean(el.innerText||el.textContent||'');if(!value)continue;const links=el.matches('a[href]')?[el]:[...el.querySelectorAll('a[href]')];const destinations=[...new Set(links.map(link=>safeUrl(link.getAttribute('href')||'')).filter(Boolean))];sections.push(value+(destinations.length?'\nLinks: '+destinations.join(' '):''))}}}
  let text=clean([document.title?('# '+clean(document.title)):'',...sections].filter(Boolean).join('\n\n'));
  const sourceTruncated=text.length>SOURCE_LIMIT;if(sourceTruncated)text=text.slice(0,SOURCE_LIMIT);
  let hash=2166136261;const identity=location.href+'\n'+contentType+'\n'+text;for(let i=0;i<identity.length;i++){hash^=identity.charCodeAt(i);hash=Math.imul(hash,16777619)}
  const documentId='document-'+(hash>>>0).toString(16)+'-'+text.length;const expected=typeof input.documentId==='string'?input.documentId:undefined;
  if(expected&&expected!==documentId)return{error:'STALE_DOCUMENT',documentId,contentType};
  const offset=Math.max(0,Math.min(Number.isFinite(input.offset)?Math.trunc(input.offset):0,text.length));const requested=Number.isFinite(input.maxChars)?Math.trunc(input.maxChars):DEFAULT_PAGE;const maxChars=Math.max(1,Math.min(requested,MAX_PAGE));const end=Math.min(text.length,offset+maxChars);
  return{documentId,text:text.slice(offset,end),offset,...(end<text.length?{nextOffset:end}:{}),truncated:end<text.length,contentType,...(sourceTruncated?{sourceTruncated:true}:{})}
}`

export interface BrowserDocumentScriptResult {
  documentId: string
  text?: string
  offset?: number
  nextOffset?: number
  truncated?: boolean
  contentType: string
  sourceTruncated?: boolean
  error?: 'STALE_DOCUMENT'
}
