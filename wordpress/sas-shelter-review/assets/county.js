/* County EM contacts list ([sas_county_contacts]); same behavior as the original hand-built page:
   search and state filter, Edit links that carry the county's current details, and the
   Suggest an Edit pop-up. */
(function(){var q=document.getElementById('sas-em-q'),st=document.getElementById('sas-em-st');if(!q)return;
function run(){var t=q.value.trim().toLowerCase(),s=st.value;document.querySelectorAll('.sas-em details').forEach(function(d){var ok=!s||d.getAttribute('data-st')===s,n=0;d.querySelectorAll('tbody tr').forEach(function(r){var m=ok&&(!t||r.textContent.toLowerCase().indexOf(t)>-1);r.classList.toggle('hide',!m);if(m)n++;});d.classList.toggle('hide',!ok||(t&&!n));if(t&&n)d.open=true;if(s&&ok&&!t)d.open=true;});}
q.addEventListener('input',run);st.addEventListener('change',run);
document.addEventListener('click',function(ev){var a=ev.target.closest&&ev.target.closest('.sas-em a.fb');if(!a)return;var tr=a.closest('tr'),d=a.closest('details'),p=new URLSearchParams();
function c(l){var td=tr.querySelector('td[data-l="'+l+'"]');return td?td.textContent.trim():'';}
var w=tr.querySelector('a[target=_blank]');var v={county:tr.getAttribute('data-c'),state:d.querySelector('summary').childNodes[0].textContent.trim(),agency:tr.getAttribute('data-a'),director:c('Director'),phone:c('Phone'),email:c('Email'),address:c('Address'),website:w?w.href:''};
Object.keys(v).forEach(function(k){if(v[k])p.set(k,v[k]);});a.href=a.getAttribute('href').split('?')[0]+'?'+p.toString();},true);
function hash(){var h=location.hash;if(h.indexOf('#em-')===0){var d=document.querySelector(h);if(d)d.open=true;}}window.addEventListener('hashchange',hash);hash();})();

(function(){
var FRAME_CSS="html{margin-top:0!important}#wpadminbar,header.vcv-header,footer.vcv-footer,h1.entry-title,.entry-content > p,#frm_field_592_container,.sp-beacon,.o-livechat-root,#querylist{display:none!important}body{background:#fff!important}.content-wrapper{padding-top:0!important}.container{padding-top:16px!important;padding-bottom:24px!important}";
var lastFocus=null;
function onKey(e){if(e.key==="Escape")closeModal();}
function closeModal(){var bd=document.querySelector(".sas-modal-backdrop");if(!bd)return;bd.classList.remove("is-open");document.body.classList.remove("sas-modal-open");document.removeEventListener("keydown",onKey);setTimeout(function(){bd.remove();},200);if(lastFocus)lastFocus.focus();}
function openModal(url){lastFocus=document.activeElement;var bd=document.createElement("div");bd.className="sas-modal-backdrop";
bd.innerHTML='<div class="sas-modal" role="dialog" aria-modal="true" aria-labelledby="sas-modal-title"><div class="sas-modal-head"><h2 class="sas-modal-title" id="sas-modal-title">Suggest an Edit</h2><button type="button" class="sas-modal-close" aria-label="Close">&times;</button></div><div class="sas-modal-body"><div class="sas-modal-loading">Loading…</div><iframe title="Suggest an edit form"></iframe></div></div>';
document.body.appendChild(bd);document.body.classList.add("sas-modal-open");requestAnimationFrame(function(){bd.classList.add("is-open");});
bd.addEventListener("click",function(e){if(e.target===bd)closeModal();});bd.querySelector(".sas-modal-close").addEventListener("click",closeModal);document.addEventListener("keydown",onKey);
var frame=bd.querySelector("iframe");frame.addEventListener("load",function(){try{if(frame.contentWindow.location.href==="about:blank")return;}catch(err){}
try{var d=frame.contentDocument,st=d.createElement("style");st.textContent=FRAME_CSS;d.head.appendChild(st);d.addEventListener("keydown",onKey);}catch(err){}
var l=bd.querySelector(".sas-modal-loading");if(l)l.remove();});
frame.src=url;bd.querySelector(".sas-modal-close").focus();}
document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest(".sas-em a.fb");if(!a||e.defaultPrevented)return;if(e.metaKey||e.ctrlKey||e.shiftKey||e.button!==0)return;e.preventDefault();openModal(a.href);});
})();
