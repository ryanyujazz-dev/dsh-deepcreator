/**
 * Provider-neutral DOM extraction policy. It is a self-contained browser function so both
 * Playwright and Electron WebContents execute the same visibility and value-redaction rules.
 */
export const INTERACTIVE_SNAPSHOT_SCRIPT = `()=>{const cssPath=element=>{if(element.id)return'#'+CSS.escape(element.id);const parts=[];let current=element;while(current&&current!==document.documentElement){const name=current.tagName.toLowerCase();const siblings=current.parentElement?[...current.parentElement.children].filter(child=>child.tagName===current.tagName):[];parts.unshift(name+':nth-of-type('+Math.max(1,siblings.indexOf(current)+1)+')');current=current.parentElement}return parts.join(' > ')};const visible=el=>{const input=el;if(input.type==='hidden'||el.hasAttribute('hidden')||el.hasAttribute('inert')||el.getAttribute('aria-hidden')==='true')return false;const bounds=el.getBoundingClientRect(),style=getComputedStyle(el);return bounds.width>0&&bounds.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0'};const editable=new Set(['text','search','email','tel','url','number','range','color','date','time','datetime-local','month','week']);return[...document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')].filter(visible).slice(0,500).map(el=>{const input=el,role=el.getAttribute('role')||el.tagName.toLowerCase(),name=(el.getAttribute('aria-label')||el.getAttribute('title')||el.innerText||input.placeholder||'').trim().slice(0,240),inputType=input.type||undefined,autocomplete=input.autocomplete||undefined,identity=[el.id,el.getAttribute('name'),inputType,autocomplete].filter(Boolean).join(' '),sensitive=inputType==='password'||autocomplete==='one-time-code'||String(autocomplete||'').startsWith('cc-')||/(?:token|secret|signature|authorization|authenticity|csrf|xsrf|session|credential|otp|passcode|api[-_]?key)/i.test(identity),exposesValue=el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement||(el instanceof HTMLInputElement&&editable.has(input.type));return{selector:cssPath(el),role,name,...(sensitive||!exposesValue?{}:{value:String(input.value||'').slice(0,240)}),...(inputType?{inputType}:{}),...(autocomplete?{autocomplete}:{})}})}`

export interface BrowserSnapshotScriptRow {
  selector: string
  role: string
  name: string
  value?: string
  inputType?: string
  autocomplete?: string
}
