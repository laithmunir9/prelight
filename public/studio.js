(function () {
  const KEY = 'prelightStudioTakes';
  const WORKSPACE_KEY = 'prelightStudioWorkspace';
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo') === '1';
  const state = window.StudioState;
  state.migrate(localStorage);
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Every explicit tutorial entry starts a new lesson, even from an old bookmarked URL.
  const freshTutorial = params.get('tour') === '1' && !demo;
  let workspaceName = freshTutorial ? '' : state.cleanName(params.get('workspace')?.trim().slice(0, 100) || read(WORKSPACE_KEY, '') || '');
  const stored = read(KEY, []);
  let allTakes = Array.isArray(stored) ? stored.filter(t => t && t.features && Array.isArray(t.features.energy) && t.features.energy.length && Array.isArray(t.features.pitch)) : [];
  if (demo) workspaceName = 'Product Pitch';
  if (!freshTutorial && !workspaceName && allTakes.some(t => !state.isDemo(t))) workspaceName = 'Product Pitch';
  if (workspaceName && !demo) { try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspaceName)); } catch {} }
  function demoTakes() {
    return Array.from({length:4}, (_, n) => {
      const duration = [82, 78, 75, 72][n];
      const pauses = [[9,1.2],[23,0.6],[39,1.6],[55,0.5],[64,0.4]].map(([start, length]) => ({start,end:start+length,duration:length,long:length>=.75}));
      const energy = Array.from({length:420}, (_,i) => {
        const t = i / 419 * duration;
        return pauses.some(p => t >= p.start && t <= p.end) ? .005 : .12 + .16 * Math.abs(Math.sin(i*.12+n*.24)) * (.55+.45*Math.sin(i*.035)**2) + .035*Math.sin(i*1.7)**2;
      });
      const pitch = energy.map((v,i) => v < .01 ? 0 : 142 + 27*Math.sin(i*.045+n*.3) + 12*Math.sin(i*.19));
      return {id:`demo-${n+1}`, label:`Take ${n+1}`, demo:true, createdAt:new Date(2026,8,14,10,n*7).toISOString(), features:{duration,energy,pitch,voiced:energy.map(v=>v>.01),energyMean:.2,energyVariance:.004,pauses,silenceRatio:pauses.reduce((s,p)=>s+p.duration,0)/duration,medianPitch:142,pitchVariability:24,longPauseCount:2}};
    });
  }
  let takes = demo ? demoTakes() : freshTutorial ? [] : allTakes.filter(t => !state.isDemo(t) && (t.workspace || 'Product Pitch') === workspaceName);
  let selected = takes.at(-1)?.id;
  let compare = takes.at(-2)?.id;
  let mode = 'trace';
  let modal = false;
  let introStep = null;
  let guided = params.get('tour') === '1' && !demo;
  let recorder = null;
  let recordingState = 'idle';
  let returnFocus = 'topNew';
  const fmt = (n, d=1) => Number.isFinite(n) ? n.toFixed(d) : '—';
  const time = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const brand = '<a class="pl-brand" href="/" aria-label="Prelight home"><img src="/prelight-mascot.png" width="36" height="36" alt=""/>Prelight</a>';
  function save() {
    allTakes = [...allTakes.filter(t => state.isDemo(t) || (t.workspace || 'Product Pitch') !== workspaceName), ...takes];
    try { localStorage.setItem(KEY, JSON.stringify(allTakes)); } catch {}
  }
  function renderLanding() {
    document.body.classList.add('prelight-page');
    document.title = 'Prelight · Practice before the room is real';
    document.getElementById('main').innerHTML = `<div class="prelight-landing pl-guided-landing">
      <nav class="pl-landing-nav" ${introStep?'inert':''}>${brand}</nav>
      <section class="pl-landing-content" ${introStep?'inert':''}>
        <div class="pl-mascot-greeting"><span>Hi, I’m Prelight.</span><img class="pl-hero-mark" src="/prelight-mascot.png" width="144" height="144" alt="Prelight mascot"/></div>
        <h1>A little practice.<br/>A <em>clearer voice.</em></h1>
        <p class="pl-landing-copy">Rehearse your 60-second pitch before the meeting.<br/>Try two deliveries. See what changed.</p>
        <button class="pl-btn pl-primary pl-start-tutorial" id="startTutorial">Show me how</button>
        <p class="pl-signin-line">Already have an account? <button id="studioSignIn">Sign in</button></p>
      </section>
      ${introHtml()}<div id="authRoot"></div></div>`;
    document.getElementById('startTutorial').onclick = () => {introStep='welcome';renderLanding();document.getElementById('introContinue').focus();};
    document.getElementById('studioSignIn').onclick = () => { if (typeof openAuth === 'function') openAuth('login'); };
    bindIntro();
    if (typeof S !== 'undefined' && S.authOpen) renderAuthDialog();
  }
  function introHtml() {
    if (!introStep) return '';
    return `<div class="pl-intro-backdrop"><section class="pl-intro-dialog" id="introDialog" role="dialog" aria-modal="true" aria-labelledby="introTitle">
      <button class="pl-intro-close" id="introClose" aria-label="Close introduction">×</button>
      <img src="/prelight-mascot.png" width="112" height="112" alt=""/>
      <h2 id="introTitle">Your next take starts here.</h2><p>Explain your idea in about 60 seconds. Record it once, try a deliberate pause in your next take, then compare the difference.</p><button class="pl-btn pl-primary" id="introContinue">Open my workspace</button>
    </section></div>`;
  }
  function closeIntro() {introStep=null;renderLanding();document.getElementById('startTutorial').focus();}
  function bindIntro() {
    document.getElementById('introClose')?.addEventListener('click',closeIntro);
    document.getElementById('introContinue')?.addEventListener('click',()=>location.assign('/studio?tour=1'));
    document.getElementById('introDialog')?.addEventListener('keydown',e=>{
      if(e.key==='Escape')closeIntro();
      if(e.key==='Tab'){const controls=[...e.currentTarget.querySelectorAll('button,input')];const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    });
  }
  function renderTutorialStart() {
    document.getElementById('main').innerHTML = `<div class="prelight-studio"><div class="pl-shell pl-simple pl-first-use pl-tutorial-start">
      <div class="pl-topbar">${brand}<div class="pl-workspace-title"><span class="pl-slash">/</span><h1>New practice</h1></div><a class="pl-exit-tutorial" href="/studio">Exit tutorial</a></div>
      <section class="pl-canvas"><aside class="pl-guide" aria-label="Start your speaking practice"><img src="/prelight-mascot.png" width="76" height="76" alt=""/><div class="pl-guide-body">
        <div class="pl-guide-meta">Prelight <span>Let’s start something</span></div>
        <h2 id="practiceHeading">What are you pitching?</h2><p>Choose an idea you want to explain. We’ll practice a short version together.</p>
        <form id="practiceForm"><label class="pl-sr-only" for="practiceType">Pitch name</label><input id="practiceType" value="Product pitch" placeholder="Give your pitch a name" maxlength="100" required autocomplete="off"/>
        <div class="pl-practice-choices">${['Product pitch','Business idea','Project proposal'].map(name=>`<button type="button" data-practice="${name}">${name}</button>`).join('')}</div>
        <button class="pl-btn pl-primary" type="submit">Start practicing</button></form>
      </div></aside></section></div></div>`;
    document.querySelectorAll('[data-practice]').forEach(button=>button.onclick=()=>{document.getElementById('practiceType').value=button.dataset.practice;document.getElementById('practiceType').focus();});
    document.getElementById('practiceForm').addEventListener('submit',e=>{
      e.preventDefault();const requested=document.getElementById('practiceType').value.trim();if(!requested)return;
      // Start a fresh practice without mixing in or replacing earlier takes.
      const names=new Set(allTakes.filter(t=>!state.isDemo(t)).map(t=>t.workspace || 'Product Pitch'));
      let name=requested, suffix=2;while(names.has(name))name=`${requested} ${suffix++}`;
      workspaceName=name; takes=[]; selected=undefined; compare=undefined; mode='trace';
      try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspaceName)); } catch {}
      // The lesson lives in this visit. Reloading restores practice, not a guessed tutorial step.
      history.replaceState(null, '', `/studio?workspace=${encodeURIComponent(workspaceName)}`);
      render(); document.getElementById('guideAction').focus();
    });
  }
  function guideHtml() {
    if(!guided)return '';
    const step=takes.length===0?1:takes.length===1?2:mode==='compare'?4:3;
    const [title,copy,action]=[
      ['Record your first take','A take is one recording. Aim for about 60 seconds: who are you helping, what problem do they face, and how does your idea help? Start with “My idea helps…” and speak naturally.','Record your first take'],
      ['See what happened','The blocks show where you paused. Try the same pitch again, this time leaving a deliberate pause after your main point. See how that changes the trace.','Record another take'],
      ['What changed?','You’ve tried two deliveries of your pitch. Compare them to see where your pauses and timing changed.','Compare with previous'],
      ['A little clearer, take by take','Find the pause you tried in your second take. Check how the timing changed, then decide whether that pause fits your message. You can rehearse again before your meeting.','Finish tutorial']
    ][step-1];
    return `<aside class="pl-guide" aria-label="Speaking tutorial"><img src="/prelight-mascot.png" width="76" height="76" alt=""/><div class="pl-guide-body"><div class="pl-guide-meta">Prelight <span>Step ${step} of 4</span><button id="exitGuide" aria-label="Exit tutorial">×</button></div><h2>${title}</h2><p>${copy}</p><button class="pl-btn pl-primary" id="guideAction">${action}</button></div></aside>`;
  }
  function points(values, width=1000, height=110) {
    const valid = values.filter(Number.isFinite);
    const max = Math.max(...valid, .01), min = Math.min(...valid, 0);
    return values.map((v,i)=>`${i / Math.max(1,values.length-1)*width},${height-10-(v-min)/Math.max(max-min,.01)*(height-22)}`).join(' ');
  }
  function timeline(f) {
    const pauseBlocks = f.pauses.map(p=>`<rect x="${p.start/f.duration*1000}" y="0" width="${p.duration/f.duration*1000}" height="110" class="pl-pause"/>`).join('');
    return `<div class="pl-timeline pl-selectable" tabindex="0" aria-label="Synchronized energy, pitch and pause timeline. Drag to select a range. Escape clears selection." data-duration="${f.duration}"><div class="pl-selection" hidden></div><div class="pl-track"><div class="pl-track-label">Energy</div><svg viewBox="0 0 1000 110" preserveAspectRatio="none" role="img" aria-label="Energy over time">${pauseBlocks}<polyline class="pl-energy" points="${points(f.energy)}"/></svg></div><div class="pl-track"><div class="pl-track-label">Pitch</div><svg viewBox="0 0 1000 110" preserveAspectRatio="none" role="img" aria-label="Pitch over time">${pauseBlocks}<polyline class="pl-pitch" points="${points(f.pitch)}"/></svg></div><div class="pl-track pl-pause-track"><div class="pl-track-label">Pauses</div><svg viewBox="0 0 1000 110" preserveAspectRatio="none" role="img" aria-label="Silent regions">${pauseBlocks}</svg></div><div class="pl-ticks">${Array.from({length:5},(_,i)=>`<span>${time(f.duration*i/4)}</span>`).join('')}</div></div>`;
  }
  function comparisonSummary(previous, active) {
    const a = previous.features, b = active.features;
    const changes = [];
    if (Number.isFinite(a.duration) && Number.isFinite(b.duration)) {
      const seconds = Math.round(b.duration) - Math.round(a.duration);
      changes.push(seconds === 0 ? 'about the same length' : `${Math.abs(seconds)} ${Math.abs(seconds) === 1 ? 'second' : 'seconds'} ${seconds < 0 ? 'shorter' : 'longer'}`);
    }
    if (Number.isFinite(a.longPauseCount) && Number.isFinite(b.longPauseCount)) {
      const pauses = b.longPauseCount - a.longPauseCount;
      changes.push(pauses === 0 ? 'the same number of long pauses' : `${Math.abs(pauses)} ${pauses < 0 ? 'fewer' : 'more'} long ${Math.abs(pauses) === 1 ? 'pause' : 'pauses'}`);
    }
    return changes.length ? `${escape(active.label)} compared with ${escape(previous.label)}: ${changes.join('; ')}.` : 'See the measurements below to compare these takes.';
  }
  function diffCanvas(previous, active) {
    const a = previous.features, b = active.features;
    const alignment = window.SpeechProfiler.compareTakes(previous,active);
    const aligned = (feature, side, kind) => alignment.path.map(pair => feature[kind][pair[side]]);
    return `<div class="pl-canvas-heading"><div><div class="pl-eyebrow">Compare takes</div><h2>${escape(previous.label)} <span class="pl-muted">→</span> ${escape(active.label)}</h2></div><label class="pl-compare-picker">Compare with<select id="compareTake">${takes.filter(t=>t.id!==active.id).map(t=>`<option value="${escape(t.id)}" ${t.id===previous.id?'selected':''}>${escape(t.label)}</option>`).join('')}</select></label></div><p class="pl-comparison-summary">${comparisonSummary(previous,active)}</p><div class="pl-diff-metrics">${[['Duration',time(a.duration),time(b.duration)],['Silence',`${fmt(a.silenceRatio*100)}%`,`${fmt(b.silenceRatio*100)}%`],['Long pauses',a.longPauseCount,b.longPauseCount],['Pitch variation',`${fmt(a.pitchVariability,0)} Hz`,`${fmt(b.pitchVariability,0)} Hz`]].map(([label,from,to])=>`<div><span>${label}</span><strong>${from} <i>→</i> ${to}</strong></div>`).join('')}</div><div class="pl-alignment-title"><h3>Your takes overlaid</h3></div><p class="pl-reading-help">Follow each color to see where your delivery changed. Shorter or fewer pauses isn’t always better—choose what fits your message.</p><div class="pl-timeline pl-aligned">${['energy','pitch'].map(kind=>`<div class="pl-track"><div class="pl-track-label">${kind}</div><svg viewBox="0 0 1000 110" preserveAspectRatio="none" role="img" aria-label="${kind} comparison"><polyline class="pl-previous" points="${points(aligned(a,0,kind))}"/><polyline class="pl-energy" points="${points(aligned(b,1,kind))}"/></svg></div>`).join('')}<div class="pl-ticks"><span>Start</span><span>End</span></div></div><div class="pl-legend"><span><i class="pl-key-previous"></i>${escape(previous.label)}</span><span><i></i>${escape(active.label)}</span></div>`;
  }
  function render() {
    if (!/^\/studio\/?$/.test(location.pathname)) { renderLanding(); return; }
    document.body.classList.add('prelight-page');
    document.body.classList.remove('landing-page');
    document.title = `${workspaceName || 'What are you practicing?'} · Prelight Studio`;
    if (!workspaceName && guided) {renderTutorialStart(); return;}
    if (!workspaceName) {
      document.getElementById('main').innerHTML = `<div class="prelight-studio pl-onboarding"><nav>${brand}</nav><form id="workspaceForm"><img class="pl-character" src="/prelight-mascot.png" width="88" height="88" alt=""/><h1 id="practiceHeading">What are you practicing?</h1><input aria-labelledby="practiceHeading" id="workspaceName" placeholder="Product pitch" maxlength="100" required/><button class="pl-btn pl-primary">Start recording <span>→</span></button></form></div>`;
      document.getElementById('workspaceForm').onsubmit = e => {e.preventDefault(); const name = document.getElementById('workspaceName').value.trim(); if(name) location.assign(`/studio?workspace=${encodeURIComponent(name)}`);};
      return;
    }
    const active = takes.find(t=>t.id===selected);
    const previous = takes.find(t=>t.id===compare && t.id!==selected) || takes.find(t=>t.id!==selected);
    const f = active?.features;
    const isComparing = mode === 'compare' && previous;
    const newLabel = demo ? 'Start your workspace' : takes.length === 1 ? 'Record another take' : 'Record new take';
    const compareLabel = takes.findIndex(t => t.id === selected) > 0 ? 'Compare with previous' : 'Compare takes';
    const metricRows = rows => rows.map(([label,value,unit='']) => `<div><dt>${label}</dt><dd>${value}<span>${unit}</span></dd></div>`).join('');
    document.getElementById('main').innerHTML = `<div class="prelight-studio"><div class="pl-shell pl-simple ${f?'':'pl-first-use'} ${guided&&!f?'pl-tutorial-start':''}">
      <div class="pl-topbar">${brand}<div class="pl-workspace-title"><span class="pl-slash">/</span><h1>${escape(workspaceName)}</h1>${demo?'<span class="pl-demo-tag">Demo</span>':''}</div>
        ${f?`<div class="pl-actions">${takes.length>=2?`<button class="pl-btn ${isComparing?'':'pl-primary'}" id="compareBtn">${isComparing?'Back to trace':compareLabel}</button>`:''}<button class="pl-btn ${takes.length<2||isComparing?'pl-primary':''}" id="topNew">${newLabel}</button></div>`:''}
      </div>
      ${f?`<aside class="pl-rail"><div class="pl-rail-heading"><h2>Takes</h2></div><div class="pl-takes">${takes.slice().reverse().map(t=>`<button class="pl-take ${t.id===selected?'pl-active':''}" data-take="${escape(t.id)}" aria-pressed="${t.id===selected}"><span><strong>${escape(t.label)}</strong><small>${time(t.features.duration)}</small></span></button>`).join('')}</div><button class="pl-text-btn pl-new" id="newTake">＋ ${demo?'Start your workspace':'New take'}</button></aside>`:''}
      <section class="pl-canvas">${guideHtml()}${f?(isComparing?diffCanvas(previous,active):`
        <div class="pl-canvas-heading"><div><div class="pl-eyebrow">${escape(active.label)}</div><h2>Performance trace</h2></div></div>
        <p class="pl-reading-help">Energy shows how loud your voice is. Pitch shows its ups and downs. Blocks mark pauses.</p>
        ${!guided?`<p class="pl-next-step">${takes.length===1?'Next: record the same pitch or answer again, then compare the two takes.':'Next: compare this take with another to see what changed.'}</p>`:''}
        ${timeline(f)}
        <div class="pl-canvas-foot"><span>Drag to select · Arrow keys to adjust · Esc to clear</span><span class="pl-inspector-range" aria-live="polite"></span></div>
        <dl class="pl-headline-metrics">${metricRows([['Duration',time(f.duration)],['Pauses',f.pauses.length],['Silence',fmt(f.silenceRatio*100),'%'],['Pitch variation',fmt(f.pitchVariability,0),'Hz']])}</dl>
        <details class="pl-details"><summary>View details</summary><div class="pl-inspector"><p class="pl-metrics-scope">Whole take</p><dl class="pl-metrics">${metricRows([['Median pitch',fmt(f.medianPitch,0),'Hz'],['Long pauses',f.longPauseCount]])}</dl><p class="pl-inspector-note">These measurements describe the whole take, including when a region is selected.</p></div></details>
        ${demo?'<p class="pl-demo-note">Example recordings. Start your workspace to record your own.</p>':''}
      `):`<div class="pl-empty"><img class="pl-character" src="/prelight-mascot.png" width="88" height="88" alt=""/><h2>Record your first take</h2><p>A take is one recording. Say a short version of your pitch or answer. Then record it again to see what changes.</p><button class="pl-btn pl-primary" id="firstTake">Record your first take</button></div>`}</section>
      </div>${modalHtml()}</div>`;
    bind();
  }
  function modalHtml() {
    return modal ? `<div class="pl-modal"><form class="pl-dialog" id="takeDialog" role="dialog" aria-modal="true" aria-labelledby="takeDialogTitle"><img class="pl-character" src="/prelight-mascot.png" width="72" height="72" alt=""/><h2 id="takeDialogTitle">Ready when you are.</h2><p>${takes.length?'Say the same pitch or answer again. Stop when you’re done, then compare your delivery.':'Say your pitch or answer out loud. Stop when you’re done to see where you paused and how your voice moved.'}</p><label for="takeName">Take name</label><input id="takeName" value="Take ${takes.length+1}" maxlength="100"/><div class="pl-actions"><button type="button" class="pl-btn" id="cancelTake">Cancel</button><button class="pl-btn pl-primary" id="recordTake" type="submit">Record new take</button></div><p id="recordStatus" role="status" aria-live="polite">Microphone access is requested only when you record.</p></form></div>` : '';
  }
  async function startRecording() {
    if (recordingState !== 'idle') return;
    recordingState = 'requesting';
    const status = document.getElementById('recordStatus');
    const button = document.getElementById('recordTake');
    const cancel = document.getElementById('cancelTake');
    const name = document.getElementById('takeName');
    let stream;
    button.disabled = cancel.disabled = name.disabled = true;
    status.textContent = 'Waiting for microphone access…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t=>t.stop());
        recordingState = 'analyzing'; button.disabled = true;
        status.textContent = 'Inspecting your take…';
        let context;
        try {
          const blob = new Blob(chunks,{type:recorder.mimeType || 'audio/webm'});
          context = new AudioContext();
          const buffer = await context.decodeAudioData(await blob.arrayBuffer());
          const features = window.SpeechProfiler.extractFeatures(buffer.getChannelData(0),buffer.sampleRate);
          const take = {id:`take-${Date.now()}`,label:name.value.trim() || `Take ${takes.length+1}`,workspace:workspaceName,createdAt:new Date().toISOString(),features};
          takes.push(take); selected = take.id; compare = takes.at(-2)?.id; mode='trace';
          save(); modal=false; recordingState='idle'; render(); document.getElementById(guided?'guideAction':'topNew').focus();
        } catch { status.textContent='This take could not be analyzed. Please try again.'; reset(); }
        finally { if(context) await context.close(); }
      };
      recorder.start(); recordingState='recording'; button.disabled=false;
      status.textContent='Recording. Click Stop recording when you’re done.';
      button.textContent='Stop recording';
    } catch {
      stream?.getTracks().forEach(t=>t.stop());
      status.textContent='Microphone unavailable. You can retry or cancel.'; reset();
    }
    function reset() { recordingState='idle'; button.disabled=cancel.disabled=name.disabled=false; button.textContent='Record new take'; }
  }
  function closeModal() { if(recordingState!=='idle') return; modal=false;render();document.getElementById(guided&&takes.length<2?'guideAction':returnFocus)?.focus(); }
  function bind() {
    document.getElementById('exitGuide')?.addEventListener('click',()=>{guided=false;render();document.getElementById(takes.length?'topNew':'firstTake')?.focus();});
    document.getElementById('guideAction')?.addEventListener('click',()=>{
      if(takes.length>=2&&mode==='compare'){guided=false;render();document.getElementById('topNew')?.focus();}
      else document.getElementById(takes.length>=2?'compareBtn':takes.length?'topNew':'firstTake')?.click();
    });
    document.querySelectorAll('[data-take]').forEach(b=>b.onclick=()=>{selected=b.dataset.take; const index=takes.findIndex(t=>t.id===selected); compare=takes[index-1]?.id || takes.find(t=>t.id!==selected)?.id; mode='trace'; render();});
    ['newTake','topNew','firstTake'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>{if(demo){location.assign('/studio?workspace=Product%20Pitch');return;}returnFocus=id;modal=true;render();document.getElementById('takeName').focus();}));
    const timeline = document.querySelector('.pl-selectable');
    if (timeline) {
      const selection = timeline.querySelector('.pl-selection');
      const range = document.querySelector('.pl-inspector-range');
      const duration = Number(timeline.dataset.duration);
      let anchor = null;
      const fraction = event => Math.max(0, Math.min(1, (event.clientX - timeline.getBoundingClientRect().left) / timeline.clientWidth));
      function selectRange(start, end) {
        selection.hidden = false;
        selection.style.left = `${start*100}%`;
        selection.style.width = `${Math.max(end-start,.002)*100}%`;
        range.innerHTML = `${time(start*duration)} <span>—</span> ${time(end*duration)}<small>Selected range</small>`;
      }
      timeline.onpointerdown = event => {
        if(event.button!==0) return;
        anchor = fraction(event); timeline.setPointerCapture(event.pointerId); timeline.focus();
        selectRange(anchor,Math.min(1,anchor+1/duration));
      };
      timeline.onpointermove = event => { if(anchor!==null) {const end=fraction(event); selectRange(Math.min(anchor,end),Math.max(anchor,end));} };
      timeline.onpointerup = timeline.onpointercancel = () => {anchor=null;};
      timeline.onkeydown = event => {
        if(event.key==='Escape') {selection.hidden=true;range.innerHTML='';}
        if(event.key==='ArrowRight' || event.key==='ArrowLeft') {event.preventDefault();const start=Math.max(0,Math.min(.9,parseFloat(selection.style.left||'0')/100+(event.key==='ArrowRight'?.05:-.05)));selectRange(start,start+.1);}
      };
    }
    document.getElementById('cancelTake')?.addEventListener('click',closeModal);
    document.getElementById('takeDialog')?.addEventListener('submit',e=>{e.preventDefault();if(recordingState==='recording'){recorder.stop();}else startRecording();});
    document.getElementById('takeDialog')?.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal(); if(e.key==='Tab'){const controls=[...e.currentTarget.querySelectorAll('input:not(:disabled),button:not(:disabled)')]; const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
    document.getElementById('compareBtn')?.addEventListener('click',()=>{if(mode==='trace'){const index=takes.findIndex(t=>t.id===selected);compare=takes[index-1]?.id || takes.find(t=>t.id!==selected)?.id;mode='compare';}else{mode='trace';}render();document.getElementById('compareBtn')?.focus();});
    document.getElementById('compareTake')?.addEventListener('change',e=>{compare=e.target.value;render();document.getElementById('compareTake')?.focus();});
  }
  window.renderStudio = render;
  // The legacy bootstrap owns the initial render, after its auth state is available.
})();
