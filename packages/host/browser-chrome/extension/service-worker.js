const HOST = 'com.deepcreator.browser'
const shared = new Set()
const controlled = new Map()
const revisions = new Map()
const snapshots = new Map()
const attached = new Set()
const pausedRequests = new Map()
const dialogs = new Map()
const AGENT_GROUP_TITLE = 'DeepCreator Agent'
let port

function connect() {
  port = chrome.runtime.connectNative(HOST)
  port.onMessage.addListener(message => { if(message?.kind==='network-decision'){const paused=pausedRequests.get(message.decisionId);if(paused){pausedRequests.delete(message.decisionId);clearTimeout(paused.timer);void cdp(paused.tabId,message.allow?'Fetch.continueRequest':'Fetch.failRequest',message.allow?{requestId:paused.requestId}:{requestId:paused.requestId,errorReason:'BlockedByClient'})}return}void dispatch(message) })
  port.onDisconnect.addListener(() => { port = undefined; setTimeout(connect, 2000) })
}
function send(value) { try { port?.postMessage(value) } catch {} }
function fail(id, error) { send({ id, ok: false, error: { code: error?.code || 'BROWSER_UNAVAILABLE', message: error?.message || String(error), ...(error?.details ? { details: error.details } : {}) } }) }
function state(tab) { return { providerTabId: String(tab.id), url: tab.url || '', title: tab.title || '', loading: tab.status === 'loading', canGoBack: false, canGoForward: false, presentation: { owner: 'provider', mode: 'live', requiredBeforeControl: false } } }
async function tabOf(providerTabId) { const tab = await chrome.tabs.get(Number(providerTabId)); if (!tab.id) throw new Error('Chrome tab is gone.'); return tab }
async function attach(tabId) { if(attached.has(tabId))return;try { await chrome.debugger.attach({ tabId }, '1.3') } catch (error) { if (!String(error).includes('already attached')) throw error }await chrome.debugger.sendCommand({tabId},'Fetch.enable',{patterns:[{urlPattern:'http://*/*'},{urlPattern:'https://*/*'}]});attached.add(tabId) }
async function cdp(tabId, method, params = {}) { await attach(tabId); return chrome.debugger.sendCommand({ tabId }, method, params) }
chrome.debugger.onDetach.addListener(source=>attached.delete(source.tabId))
chrome.debugger.onEvent.addListener((source,method,params)=>{if(method==='Page.javascriptDialogOpening'){dialogs.set(source.tabId,params);return}if(method!=='Fetch.requestPaused'||!controlled.has(source.tabId))return;const decisionId=crypto.randomUUID();const timer=setTimeout(()=>{const paused=pausedRequests.get(decisionId);if(!paused)return;pausedRequests.delete(decisionId);void cdp(source.tabId,'Fetch.failRequest',{requestId:params.requestId,errorReason:'TimedOut'})},5000);pausedRequests.set(decisionId,{tabId:source.tabId,requestId:params.requestId,timer});send({event:'network-request',providerTabId:String(source.tabId),decisionId,url:params.request.url})})
async function installInputGuard(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
    if (globalThis.__deepcreatorInputGuard) return; globalThis.__deepcreatorInputGuard = true
    for (const event of ['pointerdown', 'keydown', 'beforeinput']) addEventListener(event, value => { if (value.isTrusted) chrome.runtime.sendMessage({ type: 'deepcreator-user-input' }) }, true)
  } }).catch(() => undefined)
}
chrome.runtime.onMessage.addListener((message, sender) => { if (message?.type === 'deepcreator-user-input' && sender.tab?.id && controlled.has(sender.tab.id)) send({ event: 'control-interrupted', providerTabId: String(sender.tab.id) }) })
chrome.action.onClicked.addListener(tab => { if (!tab.id) return; if (shared.has(tab.id)) shared.delete(tab.id); else shared.add(tab.id); revisions.set(tab.id, (revisions.get(tab.id) || 0) + 1); void chrome.action.setBadgeText({ tabId: tab.id, text: shared.has(tab.id) ? 'ON' : '' }) })
chrome.tabs.onUpdated.addListener(tabId => { if (shared.has(tabId) || controlled.has(tabId)) { revisions.set(tabId, (revisions.get(tabId) || 0) + 1); send({ event: 'state-changed', providerTabId: String(tabId) }) } })
chrome.tabs.onRemoved.addListener(tabId => { shared.delete(tabId); controlled.delete(tabId); snapshots.delete(String(tabId)); send({ event: 'state-changed', providerTabId: String(tabId) }) })

async function snapshot(tab) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
    const visible = element => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' }
    const selector = element => { if (element.id) return `#${CSS.escape(element.id)}`; const parts=[]; for(let node=element; node&&node.nodeType===1&&parts.length<6;node=node.parentElement){let part=node.tagName.toLowerCase();const siblings=node.parentElement?[...node.parentElement.children].filter(x=>x.tagName===node.tagName):[];if(siblings.length>1)part+=`:nth-of-type(${siblings.indexOf(node)+1})`;parts.unshift(part)} return parts.join('>') }
    const editable=new Set(['text','search','email','tel','url','number','range','color','date','time','datetime-local','month','week'])
    return [...document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')].filter(visible).slice(0,500).map(element => { const inputType=element.type||undefined,autocomplete=element.autocomplete||undefined,identity=[element.id,element.getAttribute('name'),inputType,autocomplete].filter(Boolean).join(' '),sensitive=inputType==='password'||autocomplete==='one-time-code'||String(autocomplete||'').startsWith('cc-')||/(?:token|secret|signature|authorization|authenticity|csrf|xsrf|session|credential|otp|passcode|api[-_]?key)/i.test(identity),exposesValue=element instanceof HTMLTextAreaElement||element instanceof HTMLSelectElement||(element instanceof HTMLInputElement&&editable.has(element.type));return { selector: selector(element), role: element.getAttribute('role') || element.tagName.toLowerCase(), name: element.getAttribute('aria-label') || element.innerText?.trim() || element.placeholder || '', ...(!sensitive&&exposesValue?{value:String(element.value||'').slice(0,240)}:{}), ...(inputType?{inputType}:{}), ...(autocomplete?{autocomplete}:{}) } })
  } })
  const snapshotId = `snapshot-${crypto.randomUUID()}`; const selectors = new Map(); const nodes = (result || []).map((row, index) => { const nodeRef=`n${index+1}`; selectors.set(nodeRef,row.selector); return { nodeRef, role: row.role, name: row.name, ...(row.value ? { value: row.value } : {}), ...(row.inputType ? { inputType: row.inputType } : {}), ...(row.autocomplete ? { autocomplete: row.autocomplete } : {}) } }); snapshots.set(String(tab.id), { snapshotId, selectors }); return { snapshotId, url: tab.url || '', title: tab.title || '', text: nodes.map(n=>`${n.nodeRef} ${n.role} ${JSON.stringify(n.name)}`).join('\n'), nodes }
}
async function documentPage(tab, command) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [{ documentId: command.documentId, offset: command.offset, maxChars: command.maxChars }], func: input => {
    const SOURCE_LIMIT=2*1024*1024,DEFAULT_PAGE=12000,MAX_PAGE=20000,contentType=String(document.contentType||'text/html').toLowerCase(),raw=/^(?:text\/plain|application\/(?:json|xml)|text\/xml)/.test(contentType)||/raw\.githubusercontent\.com$/i.test(location.hostname)
    const hidden=el=>{for(let node=el;node&&node!==document.documentElement;node=node.parentElement){if(node.matches('script,style,noscript,template,svg,[hidden],[inert],[aria-hidden="true"]'))return true;const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return true}return false}
    const safeUrl=value=>{try{const url=new URL(value,location.href);if(!['http:','https:'].includes(url.protocol))return'';url.username='';url.password='';url.search='';url.hash='';return url.href}catch{return''}}
    const clean=value=>String(value||'').replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim()
    let sections=[]
    if(raw){const source=document.querySelector('pre')||document.body;sections=[clean(source?.textContent||'')]}else{const root=document.querySelector('main,article')||document.body;if(root){const nodes=[...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,tr,dt,dd')].filter(el=>!hidden(el)&&!(el.matches('li')&&el.querySelector(':scope > ul,:scope > ol')));for(const el of nodes){let value=el.matches('tr')?[...el.querySelectorAll(':scope > th,:scope > td')].map(cell=>clean(cell.innerText||cell.textContent||'')).filter(Boolean).join(' | '):clean(el.innerText||el.textContent||'');if(!value)continue;const links=el.matches('a[href]')?[el]:[...el.querySelectorAll('a[href]')],destinations=[...new Set(links.map(link=>safeUrl(link.getAttribute('href')||'')).filter(Boolean))];sections.push(value+(destinations.length?'\nLinks: '+destinations.join(' '):''))}}}
    let text=clean([document.title?('# '+clean(document.title)):'',...sections].filter(Boolean).join('\n\n')),sourceTruncated=text.length>SOURCE_LIMIT;if(sourceTruncated)text=text.slice(0,SOURCE_LIMIT);let hash=2166136261,identity=location.href+'\n'+contentType+'\n'+text;for(let i=0;i<identity.length;i++){hash^=identity.charCodeAt(i);hash=Math.imul(hash,16777619)}const documentId='document-'+(hash>>>0).toString(16)+'-'+text.length;if(input.documentId&&input.documentId!==documentId)return{error:'STALE_DOCUMENT',documentId,contentType};const offset=Math.max(0,Math.min(Number.isFinite(input.offset)?Math.trunc(input.offset):0,text.length)),maxChars=Math.max(1,Math.min(Number.isFinite(input.maxChars)?Math.trunc(input.maxChars):DEFAULT_PAGE,MAX_PAGE)),end=Math.min(text.length,offset+maxChars);return{documentId,text:text.slice(offset,end),offset,...(end<text.length?{nextOffset:end}:{}),truncated:end<text.length,contentType,...(sourceTruncated?{sourceTruncated:true}:{})}
  } })
  if(result?.error==='STALE_DOCUMENT')throw Object.assign(new Error('The page changed while continuing this document. Start again without documentId.'),{code:'STALE_DOCUMENT'})
  return result
}
function selectorFor(providerTabId, locator) { if (!locator) return undefined; if(locator.kind==='node'){const snap=snapshots.get(providerTabId);if(!snap||snap.snapshotId!==locator.snapshotId)throw Object.assign(new Error('Snapshot is stale.'),{code:'STALE_SNAPSHOT'});return snap.selectors.get(locator.nodeRef)} if(locator.kind==='text')return `text=${locator.text}`; return undefined }
async function act(tab, command) {
  const selector = selectorFor(String(tab.id), command.locator)
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [selector, command], func: (selector, command) => {
    let element
    if (command.locator?.kind === 'role') element=[...document.querySelectorAll(`[role="${CSS.escape(command.locator.role)}"],${command.locator.role}`)].find(x=>!command.locator.name||(x.getAttribute('aria-label')||x.innerText||'').includes(command.locator.name))
    else if(command.locator?.kind==='label'){const label=[...document.querySelectorAll('label')].find(x=>(x.innerText||'').includes(command.locator.label));element=label?.control}
    else if(selector?.startsWith('text=')){const text=selector.slice(5);element=[...document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')].find(x=>(x.innerText||x.value||'').includes(text))}
    else element=selector?document.querySelector(selector):document.scrollingElement
    if(!element)throw new Error('Element not found')
    if(command.action==='click')element.click();else if(command.action==='fill'||command.action==='type'){element.focus();element.value=command.value||'';element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));element.dispatchEvent(new Event('change',{bubbles:true}))}else if(command.action==='press'){element.dispatchEvent(new KeyboardEvent('keydown',{key:command.value||'Enter',bubbles:true}))}else if(command.action==='check'){element.checked=true;element.dispatchEvent(new Event('change',{bubbles:true}))}else if(command.action==='select'){element.value=command.value||'';element.dispatchEvent(new Event('change',{bubbles:true}))}else if(command.action==='scroll')element.scrollBy?.(0,Number(command.value)||600)
    return { role: element.getAttribute?.('role') || element.tagName?.toLowerCase(), name: element.getAttribute?.('aria-label') || element.innerText || element.placeholder || '', inputType: element.type, autocomplete: element.autocomplete }
  } })
  return result
}
async function execute(providerTabId, command) {
  let tab=await tabOf(providerTabId); controlled.set(tab.id, true); await installInputGuard(tab.id)
  if(command.kind==='navigate'){if(command.action==='goto')await chrome.tabs.update(tab.id,{url:command.url});else if(command.action==='back')await chrome.tabs.goBack(tab.id);else if(command.action==='forward')await chrome.tabs.goForward(tab.id);else await chrome.tabs.reload(tab.id);tab=await tabOf(providerTabId);return{kind:'state',tab:state(tab)}}
  if(command.kind==='inspect'){if(command.action==='snapshot')return{kind:'snapshot',snapshot:await snapshot(tab),tab:state(await tabOf(providerTabId))};if(command.action==='screenshot'){const shot=await cdp(tab.id,'Page.captureScreenshot',{format:'png'});return{kind:'screenshot',dataUrl:`data:image/png;base64,${shot.data}`,tab:state(tab)}};if(command.action==='document')return{kind:'document',document:await documentPage(tab,command),tab:state(await tabOf(providerTabId))};if(command.action==='elementInfo'){const element=await act(tab,{...command,action:'scroll'});return{kind:'elementInfo',element:{nodeRef:'element',...element},tab:state(tab)}}return{kind:'state',tab:state(tab)}}
  if(command.kind==='wait'){const deadline=Date.now()+(command.timeoutMs||15000);let matched=false;while(Date.now()<deadline){tab=await tabOf(providerTabId);if(command.condition==='load'&&tab.status==='complete')matched=true;else if(command.condition==='url'&&tab.url?.includes(command.value||''))matched=true;else if(command.condition==='dialog'&&dialogs.has(tab.id)){matched=true;dialogs.delete(tab.id);await cdp(tab.id,'Page.handleJavaScriptDialog',{accept:false})}else if(command.condition==='visible'||command.condition==='hidden'){const selector=selectorFor(providerTabId,command.locator);if(!selector||selector.startsWith('text='))throw Object.assign(new Error('Chrome element wait requires a snapshot node locator.'),{code:'STALE_SNAPSHOT'});const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},args:[selector],func:selector=>{const element=document.querySelector(selector);if(!element)return false;const box=element.getBoundingClientRect(),style=getComputedStyle(element);return box.width>0&&box.height>0&&style.visibility!=='hidden'&&style.display!=='none'}});matched=command.condition==='visible'?result:!result}if(matched)break;await new Promise(r=>setTimeout(r,100))}if(!matched)throw Object.assign(new Error(`Chrome wait timed out: ${command.condition}`),{code:'TIMEOUT'});return{kind:'state',tab:state(tab)}}
  if(command.kind==='act'&&command.action==='upload'){
    const selector=selectorFor(providerTabId,command.locator);if(!selector||selector.startsWith('text='))throw Object.assign(new Error('Chrome upload requires a fresh snapshot node locator.'),{code:'STALE_SNAPSHOT'})
    const expression=`document.querySelector(${JSON.stringify(selector)})`;const evaluated=await cdp(tab.id,'Runtime.evaluate',{expression,returnByValue:false});if(!evaluated.result?.objectId)throw Object.assign(new Error('Upload input is no longer present.'),{code:'STALE_SNAPSHOT'});await cdp(tab.id,'DOM.setFileInputFiles',{objectId:evaluated.result.objectId,files:command.files||[]});return{kind:'state',tab:state(await tabOf(providerTabId))}
  }
  await act(tab,command); return{kind:'state',tab:state(await tabOf(providerTabId))}
}
async function dispatch(request) { const {id,method,params={}}=request; try { let result
  if(method==='createTab'){let tab=await chrome.tabs.create({url:'about:blank',active:true});const groupId=await chrome.tabs.group({tabIds:[tab.id]});await chrome.tabGroups.update(groupId,{title:AGENT_GROUP_TITLE,color:'blue',collapsed:false});controlled.set(tab.id,params.automationSessionId);await attach(tab.id);await installInputGuard(tab.id);if(params.request?.url){await chrome.tabs.update(tab.id,{url:params.request.url});tab=await chrome.tabs.get(tab.id)}result=state(tab)}
  else if(method==='listAgentTabs'){result=[];for(const tabId of controlled.keys())try{result.push(state(await chrome.tabs.get(tabId)))}catch{}}
  else if(method==='listUserTabs'){result=[];for(const tabId of shared)try{const tab=await chrome.tabs.get(tabId);result.push({...state(tab),revision:revisions.get(tabId)||0})}catch{}}
  else if(method==='claimUserTab'){const tab=await chrome.tabs.get(Number(params.candidate.providerTabId));const current={...state(tab),revision:revisions.get(tab.id)||0};if(current.url!==params.candidate.url||current.title!==params.candidate.title||current.revision!==params.candidate.revision)throw Object.assign(new Error('Shared tab changed; list it again.'),{code:'STALE_SNAPSHOT'});controlled.set(tab.id,params.automationSessionId);await attach(tab.id);await installInputGuard(tab.id);result=state(tab)}
  else if(method==='execute')result=await execute(params.providerTabId,params.command)
  else if(method==='show'||method==='resumeControl'){const tab=await tabOf(params.providerTabId);await chrome.windows.update(tab.windowId,{focused:true});await chrome.tabs.update(tab.id,{active:true});controlled.set(tab.id,true);result=state(await tabOf(params.providerTabId))}
  else if(method==='release'){controlled.delete(Number(params.providerTabId));try{await chrome.debugger.detach({tabId:Number(params.providerTabId)})}catch{};result=null}
  else if(method==='close'){controlled.delete(Number(params.providerTabId));await chrome.tabs.remove(Number(params.providerTabId));result=null}
  else throw new Error(`Unknown method ${method}`);send({id,ok:true,result})
} catch(error){fail(id,error)} }
connect()
