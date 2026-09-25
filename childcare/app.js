'use strict';
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let catalog, entries=[], byId=new Map(), filtered=[], limit=48, currentId=null;
const reader=$('#reader');
const isFeatured=document.body.dataset.page==='featured';
let featuredData, featuredById=new Map(), readingTexts={}, articleGroups=new Map(), entryAliases={};
let keyOnly=new URLSearchParams(location.search).get('view')!=='all', timelineScrollHandler=null;
function dateLabel(e){if(!e.date)return e.year_hint?`Undated · c. ${e.year_hint}`:'Undated';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(e.date+'T12:00:00Z'));}
function paramsToControls(){const p=new URLSearchParams(location.search);$('#search').value=p.get('q')||'';$('#yearFrom').value=p.get('from')||'';$('#yearTo').value=p.get('to')||'';}
function controlsToParams(){const p=new URLSearchParams();for(const [key,id] of [['q','search'],['from','yearFrom'],['to','yearTo']]){const val=$('#'+id).value.trim();if(val)p.set(key,val);}if(isFeatured&&!keyOnly)p.set('view','all');const qs=p.toString();history.replaceState(null,'',location.pathname+(qs?'?'+qs:'')+location.hash);}
function applyFilters(updateURL=true){
  limit=48;
  const query=norm($('#search').value.trim()),from=$('#yearFrom').value?Number($('#yearFrom').value):-Infinity,to=$('#yearTo').value?Number($('#yearTo').value):Infinity;
  const hasRange=Number.isFinite(from)||Number.isFinite(to),bad=from>to;
  $('#filterError').hidden=!bad;$('#filterError').textContent=bad?'The starting year must be no later than the ending year.':'';
  // Undated entries belong in unrestricted searches, but cannot match a year range.
  filtered=bad?[]:entries.filter(e=>(e.year?e.year>=from&&e.year<=to:!hasRange)&&(!query||e.searchText.includes(query)));
  filtered.sort((a,b)=>{if(!a.date&&!b.date)return a.id.localeCompare(b.id);if(!a.date)return 1;if(!b.date)return -1;return a.date.localeCompare(b.date)||a.id.localeCompare(b.id);});
  $('#reset').hidden=!query&&!hasRange;
  if(updateURL)controlsToParams();renderCards();
}
function renderCards(){const showing=filtered.slice(0,limit);$('#resultCount').textContent=`${filtered.length.toLocaleString()} ${filtered.length===1?'entry':'entries'}${filtered.length!==entries.length?` of ${entries.length}`:''} · ${Math.min(limit,filtered.length)} shown`;$('#cards').innerHTML=showing.length?`<div class="list-heading" aria-hidden="true"><span>Date</span><span>Article / author</span><span>Type</span><span>Archive</span></div>`+showing.map(e=>`<div class="archive-row"><time ${e.date?`datetime="${e.date}"`:''}>${esc(dateLabel(e))}</time><div><h3><a href="#entry/${encodeURIComponent(e.id)}" aria-label="${esc(e.title)}, ${esc(dateLabel(e))}">${esc(e.title)}</a></h3><p>${esc(e.author||'No byline identified')}</p></div><span class="row-type">${esc(e.type)}</span><a class="row-source" href="${esc(e.source_url)}" target="_blank" rel="noopener" aria-label="Archive scan for ${esc(e.title)}">Archive ↗</a></div>`).join(''):'<div class="empty">No entries match these filters.<br><small>Try a wider year range or a different phrase.</small></div>';$('#loadMore').hidden=limit>=filtered.length;}
function renderFeatured(){
  if(!isFeatured)return;
  if(timelineScrollHandler){window.removeEventListener('scroll',timelineScrollHandler);window.removeEventListener('resize',timelineScrollHandler);}
  const selection=featuredData.entries.filter(f=>f.key_article);
  $('.browse').hidden=keyOnly;$('#timelineNav').hidden=!keyOnly;$('#featured').hidden=!keyOnly;
  $('#allFeatured').setAttribute('aria-pressed',String(!keyOnly));$('#keyFeatured').setAttribute('aria-pressed',String(keyOnly));
  $('#allFeaturedCount').textContent=entries.length;$('#keyFeaturedCount').textContent=featuredData.entries.filter(f=>f.key_article).length;
  if(!keyOnly){$('#timelineRange').textContent=`${catalog.stats.first_year}–${catalog.stats.last_year}`;$('#featured').innerHTML='';timelineScrollHandler=null;return;}
  const groups=new Map();
  for(const f of selection){const year=byId.get(f.id).year;if(!groups.has(year))groups.set(year,[]);groups.get(year).push(f);}
  const years=[...groups.keys()].sort((a,b)=>a-b),first=years[0],last=years.at(-1);
  $('#timelineRange').textContent=`${first}–${last}`;
  $('#timelineYears').innerHTML=years.map((y,i)=>`${i&&y-years[i-1]>1?'<span class="year-gap" aria-hidden="true"><span>···</span><i></i></span>':''}<a class="year-stop" href="#year-${y}" data-year="${y}" aria-label="${y}, ${groups.get(y).length} ${groups.get(y).length===1?'article':'articles'}"><span>${y}</span><i aria-hidden="true"></i></a>`).join('');
  // A continuous grid keeps every desktop row paired across year boundaries.
  $('#featured').innerHTML=selection.map(f=>{
    const e=byId.get(f.id),firstInYear=groups.get(e.year)[0].id===f.id;
    return `<a class="placard" ${firstInYear?`id="year-${e.year}"`:''} data-year="${e.year}" href="#entry/${e.id}" aria-label="${esc(f.display_title)}, ${esc(dateLabel(e))}"><div class="placard-date"><time datetime="${e.date}">${esc(dateLabel(e))}</time><span>${esc(e.type)}</span></div><div class="clipping"><img src="${esc(f.cover)}" alt="Newspaper clipping: ${esc(f.display_title)}" loading="lazy"></div><div class="placard-copy"><h3>${esc(f.display_title)}</h3></div></a>`;
  }).join('');
  const cards=[...$('#featured').querySelectorAll('.placard')];
  let scheduled=false,activeYear=null;
  const updateYear=()=>{
    scheduled=false;
    let active=cards[0],activeTop=-Infinity;
    const threshold=$('#timelineNav').getBoundingClientRect().bottom+45;
    for(const card of cards){
      const top=card.getBoundingClientRect().top;
      if(top>threshold)break;
      // Prefer the first card in a row unless a year jump selected its neighbor.
      if(top>activeTop+1){active=card;activeTop=top;}
    }
    const target=/^#year-\d{4}$/.test(location.hash)?$(location.hash):null;
    if(target&&Math.abs(target.getBoundingClientRect().top-active.getBoundingClientRect().top)<2)active=target;
    if(window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-2)active=cards.at(-1);
    const year=active.dataset.year;
    if(year===activeYear)return;
    activeYear=year;
    for(const link of document.querySelectorAll('.year-stop')){
      if(link.dataset.year===year)link.setAttribute('aria-current','true');else link.removeAttribute('aria-current');
    }
    const link=$('.year-stop[aria-current]'),rail=$('#timelineYears');
    rail.scrollTo({left:link.offsetLeft-rail.clientWidth/2+link.clientWidth/2,behavior:'instant'});
  };
  timelineScrollHandler=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(updateYear);}};
  window.addEventListener('scroll',timelineScrollHandler,{passive:true});
  window.addEventListener('resize',timelineScrollHandler);
  updateYear();
}
function readerList(){if(isFeatured&&keyOnly&&featuredById.get(currentId)?.key_article)return featuredData.entries.filter(f=>f.key_article).map(f=>byId.get(f.id));return filtered.some(e=>e.id===currentId)?filtered:entries;}
function updateNav(){const list=readerList(),pos=list.findIndex(e=>e.id===currentId);$('#previous').disabled=pos<=0;$('#next').disabled=pos<0||pos>=list.length-1;}
function openEntry(id){
  const canonical=entryAliases[id]||id;
  if(canonical!==id){id=canonical;history.replaceState(null,'',location.pathname+location.search+'#entry/'+encodeURIComponent(id));}
  const e=byId.get(id);if(!e){if(reader.open)closeReader();return;}
  currentId=id;updateNav();$('#closeReader').textContent=isFeatured&&keyOnly?'← Timeline':'← All articles';
  const feature=featuredById.get(id),title=feature?.display_title||e.title;
  const parts=(articleGroups.get(id)||[id]).map(pid=>({entry:byId.get(pid),reading:feature?.reading.find(r=>r.id===pid)}));
  const imageHTML=parts.map(({entry:p},pi)=>p.crops.map((c,i)=>`<figure><a href="${esc(c.file)}" target="_blank" rel="noopener" aria-label="Open clipping at full resolution"><img src="${esc(c.file)}" alt="${esc(p.title)} — region ${i+1}" ${pi||i?'loading="lazy"':''} width="${c.dimensions[0]}" height="${c.dimensions[1]}"></a></figure>`).join('')).join('');
  const textHTML=parts.map(({entry:p,reading:r},pi)=>`${pi?'<hr class="continuation-break" aria-label="Continuation">':''}<div class="reading-text">${(r?.text||readingTexts[p.id]||p.text).split(/\n\n+/).map(t=>`<p>${esc(t)}</p>`).join('')}</div>`).join('');
  $('#readerContent').innerHTML=`<header class="entry-header"><p class="entry-kicker"><time datetime="${esc(e.date||'')}">${esc(dateLabel(e))}</time><span>${esc(e.type)}</span></p><h2 id="readerTitle">${esc(title)}</h2>${e.author?`<p class="byline">${esc(e.author)}</p>`:''}</header><div class="reading-area"><section class="image-panel" aria-label="Article images"><div class="image-controls"><div><button data-zoom="out" aria-label="Zoom out">−</button><output id="zoomLevel" aria-live="polite">100%</output><button data-zoom="in" aria-label="Zoom in">+</button><button data-zoom="reset">Fit</button></div></div><div class="clipping-pages">${imageHTML}</div></section><section class="text-panel" aria-label="Article text">${textHTML}</section></div>`;
  zoom=1;if(!reader.open){reader.showModal();document.body.classList.add('modal-open');}reader.scrollTop=0;
}
let zoom=1;
function setZoom(action){zoom=action==='reset'?1:Math.max(.75,Math.min(3,zoom+(action==='in'?.25:-.25)));$('.clipping-pages').style.width=(zoom*100)+'%';$('#zoomLevel').textContent=Math.round(zoom*100)+'%';}
function route(){const match=location.hash.match(/^#entry\/(.+)$/);if(match)openEntry(decodeURIComponent(match[1]));else if(reader.open){reader.close();document.body.classList.remove('modal-open');}}
function closeReader(){history.replaceState(null,'',location.pathname+location.search);reader.close();currentId=null;document.body.classList.remove('modal-open');}
function moveEntry(delta){const list=readerList(),i=list.findIndex(e=>e.id===currentId),next=list[i+delta];if(next)location.hash='entry/'+encodeURIComponent(next.id);}
$('#closeReader').addEventListener('click',closeReader);reader.addEventListener('cancel',ev=>{ev.preventDefault();closeReader();});$('#previous').addEventListener('click',()=>moveEntry(-1));$('#next').addEventListener('click',()=>moveEntry(1));reader.addEventListener('click',ev=>{const z=ev.target.closest('[data-zoom]');if(z)setZoom(z.dataset.zoom);});document.addEventListener('keydown',ev=>{if(reader.open&&!['INPUT','TEXTAREA','SELECT'].includes(ev.target.tagName)){if(ev.key==='ArrowRight'){ev.preventDefault();moveEntry(1);}if(ev.key==='ArrowLeft'){ev.preventDefault();moveEntry(-1);}}});window.addEventListener('hashchange',route);window.addEventListener('popstate',()=>{paramsToControls();applyFilters(false);if(isFeatured){keyOnly=new URLSearchParams(location.search).get('view')!=='all';renderFeatured();}route();});let searchTimer;$('#search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>applyFilters(),150);});for(const id of ['yearFrom','yearTo'])$('#'+id).addEventListener('change',()=>applyFilters());for(const id of ['yearFrom','yearTo'])$('#'+id).addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>applyFilters(),150);});$('#reset').addEventListener('click',()=>{for(const id of ['search','yearFrom','yearTo'])$('#'+id).value='';applyFilters();});$('#loadMore').addEventListener('click',()=>{limit+=48;renderCards();});
if(isFeatured){for(const [id,mode]of [['allFeatured',false],['keyFeatured',true]])$('#'+id).addEventListener('click',()=>{keyOnly=mode;const p=new URLSearchParams(location.search);if(mode)p.delete('view');else p.set('view','all');history.pushState(null,'',location.pathname+(p.size?'?'+p:''));renderFeatured();$('#featuredControls').scrollIntoView({block:'start'});});}
async function start(){try{const response=await fetch('data/catalog.json',{cache:'no-cache'});if(!response.ok)throw new Error('Catalog could not be loaded');catalog=await response.json();byId=new Map(catalog.entries.map(e=>[e.id,e]));const groupsResponse=await fetch('data/article-groups.json',{cache:'no-cache'});if(!groupsResponse.ok)throw new Error('Article index could not be loaded');const grouped=await groupsResponse.json();entryAliases=grouped.aliases;articleGroups=new Map(grouped.articles.map(g=>[g.id,g.parts]));entries=grouped.articles.map(g=>({...byId.get(g.id),searchText:norm(g.parts.map(id=>{const e=byId.get(id);return [e.title,e.author,e.text,e.id,e.date,e.type].join(' ');}).join(' '))}));if(!isFeatured){$('#yearSpan').textContent=`${catalog.stats.first_year} — ${catalog.stats.last_year}`;$('#collectionStats').innerHTML=`${entries.length} articles · ${catalog.stats.scans} original scans<br>${catalog.stats.retained_items} retained research items`;}const readingResponse=await fetch('data/reading-text.json',{cache:'no-cache'});if(!readingResponse.ok)throw new Error('Reading copies could not be loaded');readingTexts=await readingResponse.json();const featureResponse=await fetch('data/featured.json',{cache:'no-cache'});if(!featureResponse.ok)throw new Error('Featured selection could not be loaded');featuredData=await featureResponse.json();featuredById=new Map(featuredData.entries.map(f=>[f.id,f]));renderFeatured();for(const id of ['yearFrom','yearTo']){$('#'+id).min=catalog.stats.first_year;$('#'+id).max=catalog.stats.last_year;}paramsToControls();applyFilters(false);route();if(isFeatured && /^#year-\d{4}$/.test(location.hash))$(location.hash)?.scrollIntoView();}catch(error){$('#resultCount').textContent='The catalog could not be loaded.';if(isFeatured)$('#featured').innerHTML='<p class="error">The featured collection could not be loaded. Please reload the page.</p>';$('#cards').innerHTML='<div class="empty">The archive could not be loaded. Please reload the page or try again shortly.</div>';console.error(error);}}
start();
