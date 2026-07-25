const STORAGE_KEY="paper-radar-profile-v1";
const curated=["Nature Biomedical Engineering","Science Robotics","Advanced Materials","Advanced Functional Materials","Small","Soft Robotics","Lab on a Chip","Biofabrication","Acta Biomaterialia","ACS Nano"];
const state={profile:JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")||{cvText:"",interests:"",excluded:"",journals:curated.slice(0,5),customJournals:[]},saved:new Set(JSON.parse(localStorage.getItem("paper-radar-saved")||"[]"))};

const $=(s)=>document.querySelector(s);
const $$=(s)=>[...document.querySelectorAll(s)];
const escapeHtml=(value="")=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const stopWords=new Set("the and for with from into using use based study studies effect effects development design analysis novel approach applications application research system systems method methods results their our this that are was were have has its can may".split(" "));

function terms(text){
  const words=(text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)||[]).filter(w=>!stopWords.has(w));
  const counts={}; words.forEach(w=>counts[w]=(counts[w]||0)+1);
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,24).map(([w])=>w);
}
function profileTerms(){return terms(state.profile.interests+" "+state.profile.cvText.slice(0,12000));}
function journalNames(){return [...new Set([...curated,...state.profile.customJournals])];}
function renderJournals(){
  $("#journal-options").innerHTML=journalNames().map(j=>`<label class="journal-chip"><input type="checkbox" value="${escapeHtml(j)}" ${state.profile.journals.includes(j)?"checked":""}><span>${escapeHtml(j)}</span></label>`).join("");
}
function populateProfile(){
  $("#cv-text").value=state.profile.cvText; $("#interests").value=state.profile.interests; $("#excluded").value=state.profile.excluded;
  renderJournals();
}
function showView(name){
  $$(".view").forEach(v=>v.classList.toggle("hidden",v.id!==`${name}-view`));
  $$(".nav-button").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
}
$$(".nav-button").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
$$("[data-go-profile]").forEach(b=>b.addEventListener("click",()=>showView("profile")));

$("#add-journal-button").addEventListener("click",()=>{
  const input=$("#custom-journal"),name=input.value.trim(); if(!name)return;
  if(!state.profile.customJournals.includes(name))state.profile.customJournals.push(name);
  if(!state.profile.journals.includes(name))state.profile.journals.push(name);
  input.value="";renderJournals();
});

async function extractPdf(file){
  const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise; let text="";
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
  state.profile.journals=$$("#journal-options input:checked").map(x=>x.value);
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state.profile));$("#save-status").textContent="Profile saved locally";
  setTimeout(()=>$("#save-status").textContent="",1800);showView("feed");refreshFeed();
});

function decodeAbstract(index){
  if(!index)return"";const words=[];Object.entries(index).forEach(([word,positions])=>positions.forEach(position=>words[position]=word));return words.join(" ");
}
function scorePaper(work,keywords){
  const title=(work.title||"").toLowerCase(),abstract=decodeAbstract(work.abstract_inverted_index).toLowerCase();
  const excluded=terms(state.profile.excluded);if(excluded.some(t=>title.includes(t)||abstract.includes(t)))return 0;
  let hits=[];keywords.forEach(k=>{const n=(title.includes(k)?3:0)+(abstract.includes(k)?1:0);if(n)hits.push([k,n]);});
  const raw=hits.reduce((sum,[,n])=>sum+n,0);return{value:Math.min(99,Math.round(28+raw*7)),hits:hits.sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0])};
}
function renderPapers(works){
  const keywords=profileTerms();const selected=state.profile.journals.map(j=>j.toLowerCase());
  let ranked=works.map(w=>({work:w,score:scorePaper(w,keywords)})).filter(x=>x.score&&x.score.value>28);
  if(selected.length){const journalMatches=ranked.filter(({work})=>selected.some(j=>(work.primary_location?.source?.display_name||"").toLowerCase().includes(j)));if(journalMatches.length>=3)ranked=journalMatches;}
  ranked.sort((a,b)=>b.score.value-a.score.value);ranked=ranked.slice(0,25);
  $("#paper-list").innerHTML=ranked.map(({work,score})=>{
    const source=work.primary_location?.source?.display_name||"Research article",abstract=decodeAbstract(work.abstract_inverted_index);
    const summary=abstract?abstract.split(/(?<=[.!?])\s+/).slice(0,2).join(" "):"Abstract not available in OpenAlex. Open the paper to read more.";
    const url=work.doi||work.primary_location?.landing_page_url||work.id;
    return `<article class="paper-card"><div class="score" style="--score:${score.value}"><strong>${score.value}</strong><small>MATCH</small></div><div><div class="paper-meta">${escapeHtml(source)} · ${escapeHtml(work.publication_date||"New")}</div><h3>${escapeHtml(work.title||"Untitled paper")}</h3><p>${escapeHtml(summary.slice(0,520))}</p><div class="why">Matches: ${score.hits.map(escapeHtml).join(", ")||"your research profile"}</div></div><div class="paper-actions"><button class="icon-button save-paper" data-id="${escapeHtml(work.id)}" title="Save paper">${state.saved.has(work.id)?"★":"☆"}</button><a class="icon-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="Open paper">↗</a></div></article>`;
  }).join("");
  $(".empty").classList.toggle("hidden",ranked.length>0);
  $("#empty-state h3").textContent="No strong matches yet";
  $("#empty-state p").textContent="Try a longer time window, broader interests, or fewer journal restrictions.";
  $("#empty-state button").textContent="Adjust my profile";
  $("#feed-status").textContent=ranked.length?`${ranked.length} relevant papers found`:"No strong matches found in this scan.";
  $$(".save-paper").forEach(b=>b.addEventListener("click",()=>{state.saved.has(b.dataset.id)?state.saved.delete(b.dataset.id):state.saved.add(b.dataset.id);localStorage.setItem("paper-radar-saved",JSON.stringify([...state.saved]));b.textContent=state.saved.has(b.dataset.id)?"★":"☆";}));
}
async function refreshFeed(){
  if(!state.profile.interests){$("#profile-warning").classList.remove("hidden");return;}
  $("#profile-warning").classList.add("hidden");$("#refresh-button").disabled=true;document.body.classList.add("loading");$("#feed-status").textContent="Scanning recent research…";
  const days=Number($("#days-select").value),date=new Date(Date.now()-days*864e5).toISOString().slice(0,10),queries=profileTerms().slice(0,6);
  try{
    const responses=await Promise.all(queries.map(search=>{
      const params=new URLSearchParams({search,filter:`from_publication_date:${date},type:article`,sort:"publication_date:desc",per_page:"40"});
      return fetch("https://api.openalex.org/works?"+params).then(async res=>{if(!res.ok)throw new Error("OpenAlex request failed");return (await res.json()).results||[];});
    }));
    const unique=[...new Map(responses.flat().map(work=>[work.id,work])).values()];
    renderPapers(unique);
  }
  catch(err){$("#feed-status").textContent="The literature service is temporarily unavailable. Try again shortly.";console.error(err);}
  finally{$("#refresh-button").disabled=false;document.body.classList.remove("loading");}
}
$("#refresh-button").addEventListener("click",refreshFeed);$("#days-select").addEventListener("change",refreshFeed);
populateProfile();if(state.profile.interests)refreshFeed();else $("#profile-warning").classList.remove("hidden");