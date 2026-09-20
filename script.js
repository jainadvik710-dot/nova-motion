const state={jobId:null,pollTimer:null};
const $=id=>document.getElementById(id);
const form=$('generatorForm'),prompt=$('prompt'),stage=$('previewStage'),status=$('status'),progressArea=$('progressArea'),progressMessage=$('progressMessage'),progressValue=$('progressValue'),progressBar=$('progressBar'),errorBox=$('errorBox'),button=$('generateButton'),promptCount=$('promptCount');

prompt.addEventListener('input',()=>{promptCount.textContent=prompt.value.length});
function setStatus(text,working=false){status.innerHTML=`<i></i> ${text}`;status.classList.toggle('working',working)}
function showError(message){errorBox.hidden=false;errorBox.textContent=message;setStatus('Generation unavailable')}
function clearOutput(){errorBox.hidden=true;stage.innerHTML='<div class="empty-state"><div class="empty-icon">✦</div><h3>Generating a real video…</h3><p>Nothing is shown until the model returns actual output.</p></div>';progressArea.hidden=false;progressBar.style.width='5%';progressValue.textContent='5%';progressMessage.textContent='Connecting to free Hugging Face hardware.'}
function renderVideo(url){stage.innerHTML='';const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=url;video.addEventListener('error',()=>showError('The model returned a video URL, but the browser could not load the real output.'));stage.append(video)}
async function poll(){
  try{
    const response=await fetch(`/api/generate/${encodeURIComponent(state.jobId)}`,{headers:{Accept:'application/json'}});const data=await response.json();
    if(!response.ok)throw new Error(data.error||`Polling failed (${response.status}).`);
    const progress=Number(data.progress)||5;progressBar.style.width=`${Math.min(100,progress)}%`;progressValue.textContent=`${Math.min(100,progress)}%`;progressMessage.textContent=data.message||'The model is working.';
    if(data.status==='completed'&&data.videoUrl){renderVideo(data.videoUrl);progressArea.hidden=true;button.disabled=false;setStatus('Video ready');return}
    if(data.status==='failed'){throw new Error(data.error||data.message||'The model failed without an error message.')}
    state.pollTimer=setTimeout(poll,4000);
  }catch(error){progressArea.hidden=true;button.disabled=false;showError(error.message);}
}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!prompt.value.trim()||button.disabled)return;clearOutput();button.disabled=true;setStatus('Generating',true);
  const body=new FormData();body.append('prompt',prompt.value.trim());
  try{const response=await fetch('/api/generate',{method:'POST',body});const data=await response.json();if(!response.ok)throw new Error(data.error||`Generation request failed (${response.status}).`);state.jobId=data.id;progressMessage.textContent=data.message||'Queued for free hardware.';poll();}
  catch(error){progressArea.hidden=true;button.disabled=false;showError(error.message)}
});
