// Change media filenames here when replacing assets. MP4 alternatives are tried first when present.
const CONFIG = Object.freeze({
  media: {
    curtainOpen: "assets/curtain_open.mp4",
    waveLoop: "assets/wave_loop.mp4",
    singing: "assets/singing.mp4",
    ambient: "assets/ambient_cafe.mp3"
  },
  ambientVolume: 1.0,
  ambientGain: 3.0,
  fadeMs: 700,
  limits: { to: 40, message: 500, from: 50 }
});

const SAMPLE = {to:"Emily",message:"Wishing you a wonderful birthday filled with love and happiness.",from:"Sarah"};
const $ = id => document.getElementById(id);
const scenes = {opening:$("opening"),curtain:$("curtain"),wave:$("wave"),singing:$("singing"),notice:$("notice"),message:$("messageScene")};
const curtainVideo=$("curtainVideo"),waveVideo=$("waveVideo"),singingVideo=$("singingVideo"),ambient=$("ambient"),loading=$("loading"),letter=$("letter"),signature=$("signature"),fromName=$("fromName"),stage=$("stage"),replayButton=$("replayButton"),soundToggle=$("soundToggle");
let soundEnabled=true;
let current="opening",busy=false;
let curtainErrorTimer=0;
let singingStartTimer=0;
let sceneTransitionTimer=0;
let ambientContext=null;
let ambientGraph=null;
let ambientMediaSource=null;
let ambientGainNode=null;
let ambientLimiter=null;
let ambientStopTimer=0;

function decodeData(){
  try{
    const raw=new URLSearchParams(location.hash.slice(1)).get("d");
    if(!raw)return SAMPLE;
    const base64=raw.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-raw.length%4)%4);
    const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64),c=>c.charCodeAt(0))));
    const clean={
      to:String(data.to||"").replace(/[\r\n]+/g," ").trim().slice(0,CONFIG.limits.to),
      message:String(data.message||"").replace(/\r\n?/g,"\n").trim().slice(0,CONFIG.limits.message),
      from:String(data.from||"").replace(/[\r\n]+/g," ").trim().slice(0,CONFIG.limits.from)
    };
    return clean.to&&clean.message&&clean.from?clean:SAMPLE;
  }catch(error){console.warn("Invalid card data; using the sample.",error);return SAMPLE}
}

curtainVideo.src=CONFIG.media.curtainOpen;
waveVideo.src=CONFIG.media.waveLoop;
singingVideo.src=CONFIG.media.singing;
waveVideo.loop=true;
waveVideo.playsInline=true;
if(CONFIG.media.ambient)ambient.src=CONFIG.media.ambient;
ambient.volume=CONFIG.ambientVolume;

function show(next){
  if(next===current)return Promise.resolve();busy=true;
  clearTimeout(sceneTransitionTimer);
  Object.entries(scenes).forEach(([name,node])=>{node.classList.toggle("active",name===next);node.setAttribute("aria-hidden",String(name!==next))});
  current=next;return new Promise(resolve=>{sceneTransitionTimer=setTimeout(()=>{busy=false;resolve()},CONFIG.fadeMs)});
}
function safePlay(video,label){
  const playPromise=video.play();
  if(playPromise)playPromise.catch(error=>console.error(`${label} playback failed:`,error));
  return playPromise;
}
function stop(video){video.pause();try{video.currentTime=0}catch{}}

function applySoundState(){
  ambient.muted=!soundEnabled;
  singingVideo.muted=!soundEnabled;
  if(soundEnabled&&current==="wave"&&ambient.paused){
    if(ambientContext?.state==="suspended")ambientContext.resume().catch(error=>console.error("Cafe ambience AudioContext resume failed:",error));
    const playPromise=ambient.play();
    if(playPromise)playPromise.catch(error=>console.error("Cafe ambience playback failed after Sound On:",error));
  }
  soundToggle.textContent=soundEnabled?"🔊 Sound On":"🔇 Sound Off";
  soundToggle.setAttribute("aria-pressed",String(soundEnabled));
  soundToggle.setAttribute("aria-label",soundEnabled?"Turn sound off":"Turn sound on");
  stage.dataset.sound=soundEnabled?"on":"off";
}

function createFilteredRoomNoise(context,duration,channelOffset){
  const frameCount=Math.ceil(context.sampleRate*duration);
  const buffer=context.createBuffer(1,frameCount,context.sampleRate);
  const samples=buffer.getChannelData(0);
  let smooth=0,roomPulse=0;
  for(let i=0;i<frameCount;i+=1){
    smooth=smooth*.985+(Math.random()*2-1)*.015;
    if(i%Math.floor(context.sampleRate*(.22+Math.random()*.5))===0)roomPulse=Math.random()*.22;
    roomPulse*=.9997;
    const slowDrift=.72+.18*Math.sin(i/context.sampleRate*(.31+channelOffset)*Math.PI*2);
    samples[i]=(smooth*.8+roomPulse*(Math.random()*2-1))*slowDrift;
  }
  return buffer;
}

function prepareAmbientSound(){
  if(CONFIG.media.ambient){
    // MediaElementSource can be silent on file:// because each local file has an opaque origin.
    // Use the audio element directly for local previews; keep the existing gain on HTTP(S).
    if(location.protocol!=="file:"){
      const AudioContextClass=window.AudioContext||window.webkitAudioContext;
      if(AudioContextClass){
        ambientContext=ambientContext||new AudioContextClass();
        if(!ambientMediaSource){
          ambientMediaSource=ambientContext.createMediaElementSource(ambient);
          ambientGainNode=ambientContext.createGain();
          ambientLimiter=ambientContext.createDynamicsCompressor();
          ambientLimiter.threshold.value=-4;ambientLimiter.knee.value=6;ambientLimiter.ratio.value=12;
          ambientLimiter.attack.value=.003;ambientLimiter.release.value=.25;
          ambientMediaSource.connect(ambientGainNode);ambientGainNode.connect(ambientLimiter);ambientLimiter.connect(ambientContext.destination);
        }
        ambientGainNode.gain.value=CONFIG.ambientGain;
        if(ambientContext.state==="suspended")ambientContext.resume().catch(error=>console.error("Cafe ambience AudioContext resume failed:",error));
      }
    }
    return;
  }
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)return;
  ambientContext=ambientContext||new AudioContextClass();
  if(ambientContext.state==="suspended")ambientContext.resume().catch(()=>{});
}

// Generated ambience is isolated here so an ambient.mp3 can replace it later.
function startAmbientSound(){
  stopAmbientSound(0);
  stage.dataset.ambient="starting";
  if(CONFIG.media.ambient){
    prepareAmbientSound();
    if(ambientContext?.state==="suspended"){
      ambientContext.resume().catch(error=>console.error("Cafe ambience AudioContext resume failed:",error));
    }
    clearTimeout(ambientStopTimer);
    if(ambientGainNode){
      const now=ambientContext.currentTime;
      ambientGainNode.gain.cancelScheduledValues(now);
      ambientGainNode.gain.setValueAtTime(CONFIG.ambientGain,now);
    }
    ambient.pause();ambient.currentTime=0;ambient.loop=true;ambient.volume=CONFIG.ambientVolume;ambient.muted=!soundEnabled;
    const playPromise=ambient.play();
    ambientGraph={type:"file"};stage.dataset.ambient="playing";stage.dataset.ambientGain=String(CONFIG.ambientGain);
    if(playPromise)playPromise.catch(error=>{
      ambientGraph=null;ambient.pause();ambient.currentTime=0;ambient.volume=CONFIG.ambientVolume;if(ambientGainNode)ambientGainNode.gain.value=CONFIG.ambientGain;stage.dataset.ambient="unavailable";
      console.error("Cafe ambience playback failed:",error);
    });
    return;
  }
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass){stage.dataset.ambient="unsupported";return}
  prepareAmbientSound();
  const now=ambientContext.currentTime;
  const master=ambientContext.createGain();
  master.gain.setValueAtTime(.0001,now);
  master.gain.exponentialRampToValueAtTime(.055,now+.9);
  master.connect(ambientContext.destination);
  const nodes=[];
  [[270,-.38,.17],[620,.34,.23]].forEach(([frequency,pan,lfoRate],index)=>{
    const source=ambientContext.createBufferSource();source.buffer=createFilteredRoomNoise(ambientContext,7.5,index*.19);source.loop=true;
    const filter=ambientContext.createBiquadFilter();filter.type="bandpass";filter.frequency.value=frequency;filter.Q.value=index?1.1:.72;
    const gain=ambientContext.createGain();gain.gain.value=index?.16:.22;
    const panner=ambientContext.createStereoPanner?ambientContext.createStereoPanner():null;if(panner)panner.pan.value=pan;
    const lfo=ambientContext.createOscillator(),depth=ambientContext.createGain();lfo.frequency.value=lfoRate;depth.gain.value=index?.028:.035;lfo.connect(depth);depth.connect(gain.gain);
    source.connect(filter);filter.connect(gain);if(panner){gain.connect(panner);panner.connect(master)}else gain.connect(master);
    source.start();lfo.start();nodes.push(source,lfo);
  });
  ambientGraph={type:"generated",master,nodes};stage.dataset.ambient="playing";
}

function stopAmbientSound(fadeDuration=.7){
  clearTimeout(ambientStopTimer);ambientStopTimer=0;
  const graph=ambientGraph;ambientGraph=null;stage.dataset.ambient="stopped";
  if(!graph){ambient.pause();ambient.currentTime=0;ambient.volume=CONFIG.ambientVolume;if(ambientGainNode)ambientGainNode.gain.value=CONFIG.ambientGain;return}
  if(graph.type==="file"){
    const finish=()=>{ambient.pause();ambient.currentTime=0;ambient.volume=CONFIG.ambientVolume;if(ambientGainNode)ambientGainNode.gain.value=CONFIG.ambientGain;ambientStopTimer=0};
    if(fadeDuration<=0){finish();return}
    if(!ambientGainNode){
      const started=performance.now(),initialVolume=ambient.volume;
      const fadeElement=()=>{
        const progress=Math.min(1,(performance.now()-started)/(fadeDuration*1000));
        ambient.volume=initialVolume*(1-progress);
        if(progress<1)ambientStopTimer=setTimeout(fadeElement,40);else finish();
      };
      fadeElement();return;
    }
    const now=ambientContext.currentTime;
    ambientGainNode.gain.cancelScheduledValues(now);
    ambientGainNode.gain.setValueAtTime(Math.max(.0001,ambientGainNode.gain.value),now);
    ambientGainNode.gain.exponentialRampToValueAtTime(.0001,now+fadeDuration);
    ambientStopTimer=setTimeout(finish,fadeDuration*1000+20);return;
  }
  const now=ambientContext.currentTime;
  graph.master.gain.cancelScheduledValues(now);
  graph.master.gain.setValueAtTime(Math.max(.0001,graph.master.gain.value),now);
  graph.master.gain.exponentialRampToValueAtTime(.0001,now+fadeDuration);
  graph.nodes.forEach(node=>{try{node.stop(now+fadeDuration+.05)}catch{}});
}

const data=decodeData();$("toName").textContent=data.to;$("messageText").textContent=data.message;fromName.textContent=data.from;

function fitLetter(){
  letter.style.fontSize="";let size=parseFloat(getComputedStyle(letter).fontSize),steps=80;
  while(letter.scrollHeight>letter.clientHeight&&size>12&&steps--){size-=.5;letter.style.fontSize=`${size}px`}
  fromName.style.fontSize="";let fromSize=parseFloat(getComputedStyle(fromName).fontSize),fromSteps=50;
  while(signature.scrollHeight>signature.clientHeight&&fromSize>10&&fromSteps--){fromSize-=.5;fromName.style.fontSize=`${fromSize}px`}
}
addEventListener("resize",()=>requestAnimationFrame(fitLetter));

// Handy visual QA mode: index.html?preview=message#d=… opens the final letter directly.
if(new URLSearchParams(location.search).get("preview")==="message"){
  scenes.opening.classList.remove("active");scenes.opening.setAttribute("aria-hidden","true");
  scenes.message.classList.add("active");scenes.message.setAttribute("aria-hidden","false");current="message";
  requestAnimationFrame(fitLetter);
}

scenes.opening.addEventListener("click",()=>{
  if(current!=="opening")return;
  // Start ambience directly inside the first user gesture for mobile autoplay policies.
  startAmbientSound();
  loading.hidden=true;
  curtainVideo.currentTime=0;
  const playPromise=safePlay(curtainVideo,"Curtain video");
  show("curtain");
  if(playPromise)playPromise.catch(()=>setTimeout(advanceToWave,250));
  curtainErrorTimer=setTimeout(()=>{
    if(current==="curtain"&&(curtainVideo.paused||curtainVideo.currentTime<0.05)){
      console.error("Curtain video did not begin within 2 seconds; continuing to the wave scene.");
      advanceToWave();
    }
  },2000);
});
function advanceToWave(){
  if(current!=="curtain")return;
  clearTimeout(curtainErrorTimer);
  waveVideo.currentTime=0;
  safePlay(waveVideo,"Wave video");
  show("wave");
}
curtainVideo.addEventListener("ended",advanceToWave);
curtainVideo.addEventListener("error",()=>{console.error("Curtain video could not be loaded.",curtainVideo.error);advanceToWave()});
scenes.wave.addEventListener("click",()=>{
  if(current!=="wave")return;
  stop(waveVideo);
  stopAmbientSound(.7);
  clearTimeout(singingStartTimer);
  singingStartTimer=setTimeout(()=>{
    if(current!=="wave")return;
    singingVideo.currentTime=0;
    singingVideo.muted=!soundEnabled;
    safePlay(singingVideo,"Singing video");
    show("singing");
  },760);
});
singingVideo.addEventListener("ended",()=>show("notice"));
singingVideo.addEventListener("error",()=>{if(current==="singing")show("notice")});
scenes.notice.addEventListener("click",()=>{if(current==="notice")show("message").then(()=>requestAnimationFrame(fitLetter))});

function resetCard(){
  clearTimeout(curtainErrorTimer);clearTimeout(singingStartTimer);clearTimeout(sceneTransitionTimer);
  stop(curtainVideo);stop(waveVideo);stop(singingVideo);waveVideo.loop=true;
  stopAmbientSound(0);busy=false;current="opening";
  Object.entries(scenes).forEach(([name,node])=>{const active=name==="opening";node.classList.toggle("active",active);node.setAttribute("aria-hidden",String(!active))});
}
replayButton.addEventListener("click",event=>{event.stopPropagation();resetCard()});
soundToggle.addEventListener("click",event=>{event.stopPropagation();soundEnabled=!soundEnabled;applySoundState()});
applySoundState();

document.addEventListener("visibilitychange",()=>{if(document.hidden){stopAmbientSound(.15);if(current==="wave")waveVideo.pause();if(current==="singing")singingVideo.pause()}else{if(current==="wave"){safePlay(waveVideo,"Wave video");startAmbientSound()}if(current==="singing")safePlay(singingVideo,"Singing video")}});
