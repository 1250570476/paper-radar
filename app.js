const STORAGE_KEY="paper-radar-profile-v2";
const LEGACY_KEY="paper-radar-profile-v1";
const CHECK_KEY="paper-radar-last-check";
const DAY=864e5;
const starterNames=["Nature Biomedical Engineering","Science Robotics","Advanced Materials","Advanced Functional Materials","Small","Soft Robotics","Lab on a Chip","Biofabrication","Acta Biomaterialia","ACS Nano"];
const legacy=JSON.parse(localStorage.getItem(LEGACY_KEY)||"null");
const state={
  profile:JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")||{cvText:legacy?.cvText||"",interests:legacy?.interests||"",excluded:legacy?.excluded||"",favoriteJournals:[]},
  saved:new Set(JSON.parse(localStorage.getItem("paper-radar-saved")||"[]")),
  lastCheck:JSON.parse(localStorage.getItem(CHECK_KEY)||"null"),
  latestByJournal:{}
};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const escapeHtml=(value="")=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const stopWords=new Set(["the","and","for","with","from","into","using","use","based","study","studies","effect","effects","development","design","analysis","novel","approach","applications","application","research","system","systems","method","methods","results","their","our","this","that","are","was","were","have","has","its","can","may","university","engineering","mechanical","present","student","grade","author","publications","experience","skills"]);
const sourceId=s=>String(s.id||"").split("/").pop();
const conceptFamilies=[{"id":"microrobotics","label":"micro/millirobots","terms":["microrobot","microrobots","microrobotic","microrobotics","millirobot","millirobots","microswimmer","microswimmers","microbot","microbots","soft robot","untethered robot","medical robot"]},{"id":"magnetic","label":"magnetic actuation","terms":["magnetic actuation","magnetically actuated","magnetic robot","magnetic microrobot","magnetic particle","magnetic particles","microroller","microrollers","rotating magnetic field","iron oxide","fe3o4"]},{"id":"acoustics","label":"ultrasound/acoustics","terms":["ultrasound","ultrasonic","acoustic actuation","acoustically actuated","focused ultrasound","low intensity focused ultrasound","lifu","acoustic streaming","microbubble","microbubbles","cavitation","sonication"]},{"id":"neuro","label":"neuromodulation","terms":["neuromodulation","neurostimulation","neural stimulation","nerve stimulation","neuronal stimulation","brain stimulation","peripheral nerve","bioelectronic medicine"]},{"id":"hydrogel","label":"hydrogels","terms":["hydrogel","hydrogels","alginate","soft biomaterial","soft biomaterials","biodegradable particle","biodegradable particles","injectable biomaterial","polymer network"]},{"id":"piezo","label":"piezoelectric materials","terms":["piezoelectric","piezoelectricity","barium titanate","batio3","piezoelectric nanoparticle","piezoelectric nanoparticles","piezoelectric composite","piezocatalytic"]},{"id":"microfluidics","label":"microfluidics","terms":["microfluidic","microfluidics","lab on a chip","lab-on-a-chip","droplet microfluidics","droplet-based microfluidics","flow focusing","microchannel","microchannels","micromixer","micromixers","organ on a chip"]},{"id":"separation","label":"particle/cell separation","terms":["particle separation","cell separation","deterministic lateral displacement","dld","inertial microfluidics","inertial separation","circulating tumor cell","size-based separation"]},{"id":"biomaterials","label":"biomaterials/tissue engineering","terms":["biomaterial","biomaterials","tissue engineering","scaffold","scaffolds","bone regeneration","regenerative medicine","chitosan","polyvinyl alcohol","carbon nanotube","graphene"]},{"id":"biofilm","label":"biofilm removal","terms":["biofilm","biofilms","antibiofilm","biofilm removal","bacterial adhesion","microneedle","microneedles"]},{"id":"biofabrication","label":"micro/nanofabrication","terms":["microfabrication","nanofabrication","two photon polymerization","two-photon polymerization","soft lithography","3d printing","additive manufacturing","nanoscribe"]},{"id":"imaging","label":"biomedical imaging","terms":["optoacoustic","photoacoustic","multispectral optoacoustic","msot","biomedical imaging","image guided","image-guided"]}];
function terms(text,limit=30){const words=(cleanPhrase(text).match(/[a-z][a-z0-9-]{2,}/g)||[]).filter(w=>!stopWords.has(w)&&w.length>3);const counts={};words.forEach(w=>counts[w]=(counts[w]||0)+1);return Object.entries(counts).sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length).slice(0,limit).map(([w])=>w);}
function cleanPhrase(value){return String(value||"").toLowerCase().replace(/[^a-z0-9+ -]/g," ").replace(/\s+/g," ").trim();}
function interestPhrases(){const chunks=(state.profile.interests||"").split(/[;,\n.!?]|\band\b/).map(cleanPhrase).filter(Boolean),phrases=[];chunks.forEach(chunk=>{const words=chunk.split(" ").filter(w=>w.length>2&&!stopWords.has(w));if(words.length>=2&&words.length<=8)phrases.push(words.join(" "));for(let size=Math.min(5,words.length);size>=2;size--)for(let i=0;i<=words.length-size;i++)phrases.push(words.slice(i,i+size).join(" "));});return [...new Set(phrases)].sort((a,b)=>b.split(" ").length-a.split(" ").length).slice(0,40);}
function hasExact(text,value){return (" "+cleanPhrase(text)+" ").includes(" "+cleanPhrase(value)+" ");}
function familyActivated(family,profileText){return family.terms.some(term=>hasExact(profileText,term));}
function profileModel(){const explicit=cleanPhrase(state.profile.interests),cv=cleanPhrase((state.profile.cvText||"").slice(0,30000)),all=explicit+" "+cv;const phrases=interestPhrases();const activeFamilies=conceptFamilies.filter(f=>familyActivated(f,all)).map(f=>({...f,priority:familyActivated(f,explicit)?3:1}));const interestTerms=terms(explicit,28);const cvTerms=terms(cv,24).filter(t=>!interestTerms.includes(t));return{phrases,interestTerms,cvTerms,activeFamilies};}
function buildSearchPlan(model){const queries=[],add=(q,stage,reason)=>{q=cleanPhrase(q);if(q.length>2&&!queries.some(x=>x.query===q))queries.push({query:q,stage,reason});};model.phrases.slice(0,8).forEach(q=>add(q,"exact","written-interest phrase"));model.activeFamilies.filter(f=>f.priority===3).slice(0,8).forEach(f=>f.terms.slice(0,3).forEach(q=>add(q,"concept",f.label)));const primary=model.activeFamilies.filter(f=>f.priority===3);for(let i=0;i<primary.length;i++)for(let j=i+1;j<primary.length;j++)add(primary[i].terms[0]+" "+primary[j].terms[0],"combined",primary[i].label+" + "+primary[j].label);model.interestTerms.slice(0,10).forEach(q=>add(q,"term","explicit profile term"));return queries.slice(0,28);}
function profileTerms(){return buildSearchPlan(profileModel()).map(x=>x.query);}
function saveProfile(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state.profile));}
function formatDate(value){return value?new Intl.DateTimeFormat(undefined,{dateStyle:"medium"}).format(new Date(value)):"Not checked";}

function showView(name){
  $$(".view").forEach(v=>v.classList.toggle("hidden",v.id!==`${name}-view`));
  $$(".nav-button").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  if(name==="journals")renderFavorites();
}
$$(".nav-button").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
$$("[data-go-profile]").forEach(b=>b.addEventListener("click",()=>showView("profile")));
$$("[data-go-journals]").forEach(b=>b.addEventListener("click",()=>showView("journals")));

function populateProfile(){
  $("#cv-text").value=state.profile.cvText;
  $("#interests").value=state.profile.interests;
  $("#excluded").value=state.profile.excluded;
  updateFavoriteSummaries();
}
function updateFavoriteSummaries(){
  const n=state.profile.favoriteJournals.length;
  $("#favorites-count").textContent=`${n} journal${n===1?"":"s"} selected`;
  $("#profile-journal-summary").textContent=n?`${n} favorite journal${n===1?"":"s"} will restrict your feed.`:"No favorites yet; the feed will search broadly.";
  $("#journal-warning").classList.toggle("hidden",n>0);
}
function journalCard(j,{favorite=false}={}){
  const id=sourceId(j),latest=state.latestByJournal[id];
  return `<article class="journal-card">
    <div><div class="journal-type">${escapeHtml(j.type||"Journal")}${j.is_oa?" · Open access":""}</div>
    <h3>${escapeHtml(j.display_name)}</h3>
    <p>${escapeHtml(j.host_organization_name||"Independent publisher")}${j.issn_l?` · ISSN ${escapeHtml(j.issn_l)}`:""}</p>
    <small>${Number(j.works_count||0).toLocaleString()} indexed works${latest?` · Latest indexed article: ${escapeHtml(latest)}`:""}</small></div>
    <button class="${favorite?"remove-journal secondary":"add-favorite primary"}" data-id="${escapeHtml(id)}">${favorite?"Remove":"Add to favorites"}</button>
  </article>`;
}
function bindJournalButtons(container,journals){
  container.querySelectorAll(".add-favorite").forEach(button=>button.addEventListener("click",()=>{
    const journal=journals.find(j=>sourceId(j)===button.dataset.id);
    if(journal&&!state.profile.favoriteJournals.some(f=>sourceId(f)===button.dataset.id)){
      state.profile.favoriteJournals.push(journal);saveProfile();renderFavorites();button.textContent="Added";button.disabled=true;updateFavoriteSummaries();
    }
  }));
  container.querySelectorAll(".remove-journal").forEach(button=>button.addEventListener("click",()=>{
    state.profile.favoriteJournals=state.profile.favoriteJournals.filter(j=>sourceId(j)!==button.dataset.id);
    saveProfile();renderFavorites();updateFavoriteSummaries();
  }));
}
function renderFavorites(){
  const box=$("#favorite-journals"),journals=state.profile.favoriteJournals;
  box.innerHTML=journals.length?journals.map(j=>journalCard(j,{favorite:true})).join(""):`<div class="empty compact"><h3>No favorite journals yet</h3><p>Search above and add journals to make your feed journal-specific.</p></div>`;
  bindJournalButtons(box,journals);updateFavoriteSummaries();
  $("#last-checked").textContent=state.lastCheck?`Last daily check: ${formatDate(state.lastCheck.date)}`:"Daily check has not run yet";
}

async function searchJournals(){
  const query=$("#journal-search").value.trim();
  if(!query)return;
  $("#journal-search-button").disabled=true;$("#journal-search-status").textContent="Searching the journal catalog…";
  try{
    const params=new URLSearchParams({search:query,filter:"type:journal",sort:"works_count:desc",per_page:"30"});
    const res=await fetch("https://api.openalex.org/sources?"+params);
    if(!res.ok)throw new Error("Journal search failed");
    const journals=(await res.json()).results||[];
    $("#journal-results").innerHTML=journals.length?journals.map(j=>journalCard(j,{favorite:state.profile.favoriteJournals.some(f=>sourceId(f)===sourceId(j))})).join(""):`<div class="empty compact"><h3>No journals found</h3><p>Try a shorter title, field name, or ISSN.</p></div>`;
    bindJournalButtons($("#journal-results"),journals);
    $("#journal-search-status").textContent=`${journals.length} journal results`;
  }catch(error){$("#journal-search-status").textContent="Journal search is temporarily unavailable. Try again.";console.error(error);}
  finally{$("#journal-search-button").disabled=false;}
}
$("#journal-search-button").addEventListener("click",searchJournals);
$("#journal-search").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchJournals();}});

async function extractPdf(file){
  const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;let text="";
  for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();text+=content.items.map(x=>x.str).join(" ")+"\n";}
  return text;
}
$("#cv-file").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  $("#file-label").textContent="Reading "+file.name+"…";
  try{const text=file.type==="application/pdf"||file.name.endsWith(".pdf")?await extractPdf(file):await file.text();$("#cv-text").value=text;$("#file-label").textContent=file.name;}
  catch(err){$("#file-label").textContent="Could not extract this file. Paste its text below.";console.error(err);}
});
$("#profile-form").addEventListener("submit",e=>{
  e.preventDefault();
  state.profile.cvText=$("#cv-text").value.trim();state.profile.interests=$("#interests").value.trim();state.profile.excluded=$("#excluded").value.trim();
  saveProfile();$("#save-status").textContent="Profile saved locally";setTimeout(()=>$("#save-status").textContent="",1800);showView("feed");refreshFeed();
});

function decodeAbstract(index){
  if(!index)return"";const words=[];Object.entries(index).forEach(([word,positions])=>positions.forEach(position=>words[position]=word));return words.join(" ");
}
function scorePaper(work,model){
 const title=cleanPhrase(work.title||""),abstract=cleanPhrase(decodeAbstract(work.abstract_inverted_index)),topics=cleanPhrase((work.topics||[]).map(t=>t.display_name||"").join(" ")),body=[title,abstract,topics].filter(Boolean).join(" ");
 const excluded=(state.profile.excluded||"").split(/[,;\n]/).map(cleanPhrase).filter(Boolean);if(excluded.some(v=>hasExact(title,v)||hasExact(abstract,v)||hasExact(topics,v)))return null;
 const evidence=[];let raw=0,titleSignal=0,phraseHits=0,explicitHits=0,familyHits=0;
 model.phrases.forEach(value=>{const words=value.split(" ").filter(Boolean),et=hasExact(title,value),ea=hasExact(abstract,value),ep=hasExact(topics,value),coverage=words.filter(w=>hasExact(body,w)).length/Math.max(1,words.length);if(et||ea||ep||coverage>=.67){const points=et?18:ep?13:ea?11:Math.round(4+coverage*7);raw+=points;phraseHits++;if(et)titleSignal++;evidence.push({value,points});}});
 model.activeFamilies.forEach(f=>{const matches=f.terms.filter(t=>hasExact(body,t));if(matches.length){const tm=f.terms.some(t=>hasExact(title,t)),pm=f.terms.some(t=>hasExact(topics,t)),points=f.priority*(tm?7:pm?5:3)+Math.min(4,matches.length-1);raw+=points;familyHits++;if(tm)titleSignal++;evidence.push({value:f.label,points});}});
 model.interestTerms.forEach(value=>{const it=hasExact(title,value),ia=hasExact(abstract,value),ip=hasExact(topics,value);if(it||ia||ip){const points=(it?7:0)+(ip?4:0)+(ia?2:0);raw+=points;explicitHits++;if(it)titleSignal++;evidence.push({value,points});}});
 model.cvTerms.forEach(value=>{const it=hasExact(title,value),ip=hasExact(topics,value);if(it||ip){const points=it?2:1;raw+=points;evidence.push({value,points});}});
 const independent=phraseHits+familyHits+Math.min(2,explicitHits),strong=raw>=24&&(familyHits>=2||phraseHits>=1&&familyHits>=1||titleSignal>=2),candidate=!strong&&raw>=12&&(familyHits>=1||phraseHits>=1)&&(independent>=2||titleSignal>=1);if(!strong&&!candidate)return null;
 const top=evidence.sort((x,y)=>y.points-x.points).filter((x,i,z)=>z.findIndex(y=>y.value===x.value)===i).slice(0,6);
 return{value:Math.min(98,Math.round((strong?38:24)+raw*(strong?1.55:1.8))),tier:strong?"strong":"candidate",hits:top.map(x=>x.value),explanation:`${familyHits} research concept${familyHits===1?"":"s"}, ${phraseHits} phrase match${phraseHits===1?"":"es"}, ${explicitHits} explicit term${explicitHits===1?"":"s"}`};
}
function renderPapers(works){
  const model=profileModel();
  let ranked=works.map(w=>({work:w,score:scorePaper(w,model)})).filter(x=>x.score);
  ranked.sort((a,b)=>(a.score.tier==="strong"?0:1)-(b.score.tier==="strong"?0:1)||b.score.value-a.score.value||String(b.work.publication_date).localeCompare(String(a.work.publication_date)));
  const strong=ranked.filter(x=>x.score.tier==="strong");
  const candidates=ranked.filter(x=>x.score.tier==="candidate");
  ranked=[...strong,...candidates.slice(0,Math.max(0,12-strong.length))].slice(0,25);
  $("#paper-list").innerHTML=ranked.map(({work,score})=>{
    const source=work.primary_location?.source?.display_name||"Research article",abstract=decodeAbstract(work.abstract_inverted_index);
    const summary=abstract?abstract.split(/(?<=[.!?])\s+/).slice(0,2).join(" "):"Abstract not available in OpenAlex. Open the paper to read more.";
    const url=work.doi||work.primary_location?.landing_page_url||work.id;
    return `<article class="paper-card"><div class="score" style="--score:${score.value}"><strong>${score.value}</strong><small>RELEVANCE</small></div><div><div class="paper-meta">${escapeHtml(source)} · ${escapeHtml(work.publication_date||"New")}</div><h3>${escapeHtml(work.title||"Untitled paper")}</h3><p>${escapeHtml(summary.slice(0,520))}</p><div class="why"><strong>Why it matches:</strong> ${escapeHtml(score.explanation)} · ${score.hits.map(escapeHtml).join(", ")}</div></div><div class="paper-actions"><button class="icon-button save-paper" data-id="${escapeHtml(work.id)}" title="Save paper">${state.saved.has(work.id)?"★":"☆"}</button><a class="icon-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="Open paper">↗</a></div></article>`;
  }).join("");
  $(".empty").classList.toggle("hidden",ranked.length>0);
  $("#empty-state h3").textContent="No strong matches yet";
  $("#empty-state p").textContent=state.profile.favoriteJournals.length?"No relevant papers were found in your favorite journals for this time window.":"Try a longer time window or broader interests.";
  $("#empty-state button").textContent="Adjust my profile";
  const strongShown=ranked.filter(x=>x.score.tier==="strong").length;
  $("#feed-status").textContent=ranked.length?`${ranked.length} relevant match${ranked.length===1?"":"es"} found (${strongShown} strong)${state.profile.favoriteJournals.length?` in ${state.profile.favoriteJournals.length} favorite journals`:""}`:"No papers with enough research-topic evidence were found in this scan.";
  $$(".save-paper").forEach(b=>b.addEventListener("click",()=>{state.saved.has(b.dataset.id)?state.saved.delete(b.dataset.id):state.saved.add(b.dataset.id);localStorage.setItem("paper-radar-saved",JSON.stringify([...state.saved]));b.textContent=state.saved.has(b.dataset.id)?"★":"☆";}));
}
function openAlexWorks(params){return fetch("https://api.openalex.org/works?"+params).then(async res=>{if(!res.ok)throw new Error("OpenAlex request failed ("+res.status+")");return res.json();});}
function uniqueWorks(works){return [...new Map(works.filter(Boolean).map(w=>[w.doi||w.id,w])).values()];}
async function fetchJournalCensus2(ids,date,onProgress){const works=[];let cursor="*",page=0,previous=-1;while(cursor&&page<30){const params=new URLSearchParams({filter:`from_publication_date:${date},type:article,primary_location.source.id:${ids}`,sort:"publication_date:desc",per_page:"200",cursor});const data=await openAlexWorks(params);works.push(...(data.results||[]));page++;cursor=data.meta?.next_cursor||null;onProgress?.(page,works.length);if(works.length===previous||(data.results||[]).length===0)break;previous=works.length;}return works;}
async function fetchTargeted2(ids,date,plan,onProgress){const works=[];for(let i=0;i<plan.length;i++){const filters=[`from_publication_date:${date}`,"type:article"];if(ids)filters.push(`primary_location.source.id:${ids}`);const params=new URLSearchParams({search:plan[i].query,filter:filters.join(","),sort:"relevance_score:desc",per_page:"100"});const data=await openAlexWorks(params);works.push(...(data.results||[]));onProgress?.(i+1,plan.length,plan[i]);}return works;}
async function fetchWorks2(){const days=Number($("#days-select").value),date=new Date(Date.now()-days*DAY).toISOString().slice(0,10),favorites=state.profile.favoriteJournals,model=profileModel(),plan=buildSearchPlan(model),collected=[];let scans=0;if(favorites.length){const groups=[];for(let i=0;i<favorites.length;i+=20)groups.push(favorites.slice(i,i+20));for(let g=0;g<groups.length;g++){const ids=groups[g].map(sourceId).join("|");$("#feed-status").textContent=`Pass 1/3: testing ${plan.length} query variants in journal group ${g+1}/${groups.length}…`;collected.push(...await fetchTargeted(ids,date,plan,(i,total)=>$("#feed-status").textContent=`Pass 1/3: query ${i}/${total}, journal group ${g+1}/${groups.length}…`));scans+=plan.length;$("#feed-status").textContent=`Pass 2/3: scanning every indexed article in journal group ${g+1}/${groups.length}…`;collected.push(...await fetchJournalCensus(ids,date,(page,count)=>$("#feed-status").textContent=`Pass 2/3: census page ${page}, ${count} records checked…`));scans++;}}else{collected.push(...await fetchTargeted("",date,plan,(i,total)=>$("#feed-status").textContent=`Pass 1/3: query variant ${i}/${total}…`));scans+=plan.length;const ranked=uniqueWorks(collected).map(w=>scorePaper(w,model)).filter(Boolean);if(ranked.length<12){const expansions=model.activeFamilies.flatMap(f=>f.terms.slice(3,7).map(query=>({query,stage:"expanded",reason:f.label}))).slice(0,20);collected.push(...await fetchTargeted("",date,expansions,(i,total)=>$("#feed-status").textContent=`Pass 2/3: synonym search ${i}/${total}…`));scans+=expansions.length;}}const unique=uniqueWorks(collected);state.lastSearchReport={queries:plan.length,scans,candidates:unique.length,journals:favorites.length,date};return unique;}
async function refreshFeed2(){if(!state.profile.interests){$("#profile-warning").classList.remove("hidden");return;}$("#profile-warning").classList.add("hidden");$("#refresh-button").disabled=true;document.body.classList.add("loading");$("#feed-status").textContent="Building a multi-pass search plan…";try{const works=await fetchWorks();$("#feed-status").textContent=`Pass 3/3: ranking ${works.length} unique candidates…`;renderPapers(works);const r=state.lastSearchReport;$("#feed-status").textContent+` · ${r.candidates} unique papers examined across ${r.scans} retrieval passes`;}catch(err){$("#feed-status").textContent="The literature service is temporarily unavailable. Try again shortly.";console.error(err);}finally{$("#refresh-button").disabled=false;document.body.classList.remove("loading");}}
async function checkFavoriteJournals(force=false){
  if(!state.profile.favoriteJournals.length)return;
  if(!force&&state.lastCheck&&Date.now()-new Date(state.lastCheck.date).getTime()<DAY)return;
  $("#check-journals-button").disabled=true;$("#last-checked").textContent="Checking favorite journals…";
  try{
    await Promise.all(state.profile.favoriteJournals.map(async journal=>{
      const params=new URLSearchParams({filter:`primary_location.source.id:${sourceId(journal)},type:article`,sort:"publication_date:desc",per_page:"1"});
      const res=await fetch("https://api.openalex.org/works?"+params);if(!res.ok)throw new Error("Daily check failed");
      const latest=(await res.json()).results?.[0];state.latestByJournal[sourceId(journal)]=latest?.publication_date||"No articles found";
    }));
    state.lastCheck={date:new Date().toISOString()};localStorage.setItem(CHECK_KEY,JSON.stringify(state.lastCheck));renderFavorites();
    if(state.profile.interests)refreshFeed();
  }catch(err){$("#last-checked").textContent="Daily check failed. Try again.";console.error(err);}
  finally{$("#check-journals-button").disabled=false;}
}
$("#refresh-button").addEventListener("click",refreshFeed);
$("#days-select").addEventListener("change",refreshFeed);
$("#check-journals-button").addEventListener("click",()=>checkFavoriteJournals(true));

populateProfile();renderFavorites();
if(state.profile.interests)refreshFeed();else $("#profile-warning").classList.remove("hidden");
checkFavoriteJournals();
if(!state.profile.favoriteJournals.length){$("#journal-search").value=starterNames[0];searchJournals();}
