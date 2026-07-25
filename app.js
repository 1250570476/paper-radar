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
const stopWords=new Set("the and for with from into using use based study studies effect effects development design analysis novel approach applications application research system systems method methods results their our this that are was were have has its can may".split(" "));
const sourceId=s=>String(s.id||"").split("/").pop();

function terms(text,limit=24){
  const words=(text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)||[]).filter(w=>!stopWords.has(w));
  const counts={};words.forEach(w=>counts[w]=(counts[w]||0)+1);
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([w])=>w);
}
function cleanPhrase(value){return value.toLowerCase().replace(/[^a-z0-9+ -]/g," ").replace(/\s+/g," ").trim();}
function interestPhrases(){
  const chunks=(state.profile.interests||"").split(/[;,\n.!?]|\band\b/).map(cleanPhrase).filter(Boolean),phrases=[];
  chunks.forEach(chunk=>{const words=chunk.split(" ").filter(w=>w.length>2&&!stopWords.has(w));if(words.length>=2&&words.length<=6)phrases.push(words.join(" "));for(let size=Math.min(4,words.length);size>=2;size--)for(let i=0;i<=words.length-size;i++)phrases.push(words.slice(i,i+size).join(" "));});
  return [...new Set(phrases)].sort((a,b)=>b.split(" ").length-a.split(" ").length).slice(0,24);
}
function profileModel(){const interestTerms=terms(state.profile.interests,20);return{phrases:interestPhrases(),interestTerms,cvTerms:terms(state.profile.cvText.slice(0,12000),12).filter(t=>!interestTerms.includes(t))};}
function profileTerms(){const model=profileModel();return [...model.phrases.slice(0,4),...model.interestTerms.slice(0,8)];}
function hasExact(text,value){return (" "+cleanPhrase(text)+" ").includes(" "+cleanPhrase(value)+" ");}
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
  const title=(work.title||"").toLowerCase(),abstract=decodeAbstract(work.abstract_inverted_index).toLowerCase();
  const excluded=(state.profile.excluded||"").split(/[,;\n]/).map(cleanPhrase).filter(Boolean);
  if(excluded.some(value=>hasExact(title,value)||hasExact(abstract,value)))return null;
  const matches=[];let raw=0,phraseHits=0,interestHits=0,titleHits=0;
  model.phrases.forEach(value=>{const inTitle=hasExact(title,value),inAbstract=hasExact(abstract,value);if(inTitle||inAbstract){const points=inTitle?16:9;raw+=points;phraseHits++;if(inTitle)titleHits++;matches.push({value,points});}});
  model.interestTerms.forEach(value=>{const inTitle=hasExact(title,value),inAbstract=hasExact(abstract,value);if(inTitle||inAbstract){const points=(inTitle?6:0)+(inAbstract?2:0);raw+=points;interestHits++;if(inTitle)titleHits++;matches.push({value,points});}});
  model.cvTerms.forEach(value=>{const inTitle=hasExact(title,value),inAbstract=hasExact(abstract,value);if(inTitle||inAbstract){const points=(inTitle?2:0)+(inAbstract?1:0);raw+=points;matches.push({value,points});}});
  if(!(raw>=12&&(phraseHits>=1||interestHits>=2||titleHits>=2)))return null;
  return{value:Math.min(98,Math.round(42+raw*2.2)),hits:matches.sort((x,y)=>y.points-x.points).slice(0,6).map(m=>m.value),explanation:phraseHits?phraseHits+" research phrase"+(phraseHits===1?"":"s")+" + "+interestHits+" supporting term"+(interestHits===1?"":"s"):interestHits+" independent research terms"};
}
function renderPapers(works){
  const model=profileModel();
  let ranked=works.map(w=>({work:w,score:scorePaper(w,model)})).filter(x=>x.score);
  ranked.sort((a,b)=>b.score.value-a.score.value||String(b.work.publication_date).localeCompare(String(a.work.publication_date)));ranked=ranked.slice(0,25);
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
  $("#feed-status").textContent=ranked.length?`${ranked.length} relevant papers found${state.profile.favoriteJournals.length?` in ${state.profile.favoriteJournals.length} favorite journals`:""}`:"No papers passed the stricter relevance threshold in this scan.";
  $$(".save-paper").forEach(b=>b.addEventListener("click",()=>{state.saved.has(b.dataset.id)?state.saved.delete(b.dataset.id):state.saved.add(b.dataset.id);localStorage.setItem("paper-radar-saved",JSON.stringify([...state.saved]));b.textContent=state.saved.has(b.dataset.id)?"★":"☆";}));
}
async function fetchWorks(){
  const days=Number($("#days-select").value),date=new Date(Date.now()-days*DAY).toISOString().slice(0,10),favorites=state.profile.favoriteJournals;
  if(favorites.length){
    const groups=[];for(let i=0;i<favorites.length;i+=20)groups.push(favorites.slice(i,i+20));
    const responses=await Promise.all(groups.map(group=>{
      const ids=group.map(sourceId).join("|");
      const params=new URLSearchParams({filter:`from_publication_date:${date},type:article,primary_location.source.id:${ids}`,sort:"publication_date:desc",per_page:"100"});
      return fetch("https://api.openalex.org/works?"+params).then(async r=>{if(!r.ok)throw new Error("OpenAlex request failed");return(await r.json()).results||[];});
    }));
    return responses.flat();
  }
  const responses=await Promise.all(profileTerms().slice(0,6).map(search=>{
    const params=new URLSearchParams({search,filter:`from_publication_date:${date},type:article`,sort:"publication_date:desc",per_page:"40"});
    return fetch("https://api.openalex.org/works?"+params).then(async r=>{if(!r.ok)throw new Error("OpenAlex request failed");return(await r.json()).results||[];});
  }));
  return responses.flat();
}
async function refreshFeed(){
  if(!state.profile.interests){$("#profile-warning").classList.remove("hidden");return;}
  $("#profile-warning").classList.add("hidden");$("#refresh-button").disabled=true;document.body.classList.add("loading");$("#feed-status").textContent="Scanning recent research…";
  try{const works=await fetchWorks();renderPapers([...new Map(works.map(w=>[w.id,w])).values()]);}
  catch(err){$("#feed-status").textContent="The literature service is temporarily unavailable. Try again shortly.";console.error(err);}
  finally{$("#refresh-button").disabled=false;document.body.classList.remove("loading");}
}
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
