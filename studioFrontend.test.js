import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the real frontend controller with an in-memory DOM and media guard.
// No device or browser permissions are used by these tests.
function boot(path='/', search='', initial={}) {
  const entries = new Map(Object.entries(initial));
  const nodes = new Map();
  let micCalls = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {innerHTML:'',value:'',dataset:{},listeners:{},classList:{add(){},remove(){}},addEventListener(event, handler){this.listeners[event]=handler;},focus(){},querySelectorAll(){return[];}});
    return nodes.get(id);
  };
  const context = {
    URLSearchParams, console, Date,
    location:{pathname:path,search,assign(url){this.assigned=url;}},
    localStorage:{get length(){return entries.size;},key:i=>[...entries.keys()][i],getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)},
    navigator:{mediaDevices:{async getUserMedia(){micCalls++;throw new Error('Test guard: no device access');}}},
    document:{title:'',body:{classList:{add(){},remove(){}}},getElementById:node,querySelectorAll(){return[];},querySelector(){return null;}},
  };
  context.window=context;
  vm.createContext(context);
  for (const file of ['studioState.js','speechProfiler.js','studio.js']) vm.runInContext(fs.readFileSync(new URL(`./public/${file}`,import.meta.url),'utf8'),context);
  context.renderStudio();
  return {context,node,entries,get html(){return node('main').innerHTML;},get micCalls(){return micCalls;}};
}
const features={duration:2,energy:[.1,.3,.1],pitch:[140,160,140],voiced:[true,true,true],energyMean:.2,pauses:[],silenceRatio:0,medianPitch:140,pitchVariability:10,longPauseCount:0};

test('root remains the landing page even with stored takes',()=>{
  const app=boot('/','',{prelightStudioTakes:JSON.stringify([{id:'real',label:'Saved take',features}])});
  assert.match(app.html,/A little practice/);
  assert.doesNotMatch(app.html,/Performance trace|pl-inspector|Saved take/);
  assert.equal(app.micCalls,0);
  app.node('startTutorial').onclick();
  app.node('introContinue').listeners.click();
  assert.equal(app.context.location.assigned,'/studio?tour=1');
});
test('fresh Studio asks for a workspace, and named workspace starts without demo takes',()=>{
  assert.match(boot('/studio').html,/Start recording/);
  const app=boot('/studio/','?workspace=Product%20Pitch');
  assert.match(app.html,/Record your first take/);
  assert.doesNotMatch(app.html,/Take 4|pl-demo-tag/);
  assert.equal(app.micCalls,0);
});
test('stale stored demo is migrated and not presented as real user content',()=>{
  const app=boot('/studio','?workspace=Product%20Pitch',{prelightStudioTakes:JSON.stringify([{id:'old',label:'NeutralEye Pitch',features}])});
  assert.match(app.html,/Record your first take/);
  assert.doesNotMatch(app.html,/NeutralEye|Neutral Eye/);
  assert.equal(JSON.parse(app.entries.get('prelightStudioTakes'))[0].demo,true);
});
test('explicit demo is labeled, never persisted, and comparison lives in the canvas',()=>{
  const app=boot('/studio','?demo=1');
  assert.match(app.html,/pl-demo-tag.*Demo/);
  assert.equal(app.entries.has('prelightStudioTakes'),false);
  app.node('compareBtn').listeners.click();
  assert.match(app.html,/<section class="pl-canvas">[\s\S]*Your takes overlaid/);
  assert.doesNotMatch(app.html,/DTW|acoustic|RMS|F0/);
  assert.equal(app.micCalls,0);
});
test('opening and cancelling the recording dialog never requests microphone access',()=>{
  const app=boot('/studio','?workspace=Speech');
  app.node('firstTake').listeners.click();
  assert.match(app.html,/takeDialog/);
  assert.equal(app.micCalls,0);
  app.node('cancelTake').listeners.click();
  assert.doesNotMatch(app.html,/id="takeDialog"/);
  assert.equal(app.micCalls,0);
});
test('only submitting Record invokes the guarded media API',async()=>{
  const app=boot('/studio','?workspace=Speech');
  app.node('firstTake').listeners.click();
  app.node('takeDialog').listeners.submit({preventDefault(){}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.micCalls,1);
  assert.match(app.node('recordStatus').textContent,/Microphone unavailable/);
});
test('workspace and take names are escaped before rendering',()=>{
  const app=boot('/studio','?workspace=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  assert.doesNotMatch(app.html,/<script>/);
  assert.match(app.html,/&lt;script&gt;/);
});

function withTakes(count) {
  return boot('/studio','?workspace=Speech',{prelightStudioTakes:JSON.stringify(Array.from({length:count},(_,i)=>({id:`real-${i+1}`,label:`Take ${i+1}`,workspace:'Speech',features})))});
}
test('zero takes exposes only the first recording action',()=>{
  const app=withTakes(0);
  assert.match(app.html,/id="firstTake">Record your first take/);
  assert.doesNotMatch(app.html,/id="compareBtn"|id="topNew"|pl-headline-metrics|pl-details|class="pl-rail"/);
});
test('one take defers comparison and puts extra measurements in collapsed details',()=>{
  const app=withTakes(1);
  assert.match(app.html,/id="topNew">Record another take/);
  assert.doesNotMatch(app.html,/id="compareBtn"|RMS|F0|Acoustic/);
  assert.equal((app.html.split('class="pl-headline-metrics">')[1].split('</dl>')[0].match(/<dt>/g)||[]).length,4);
  assert.match(app.html,/<details class="pl-details"><summary>View details/);
  assert.match(app.html,/<details[\s\S]*Median pitch/);
});
test('two and several takes make comparison primary, recording secondary',()=>{
  for(const count of [2,4]) {
    const app=withTakes(count);
    assert.match(app.html,/class="pl-btn pl-primary" id="compareBtn">Compare with previous/);
    assert.match(app.html,/class="pl-btn " id="topNew">Record new take/);
    app.node('compareBtn').listeners.click();
    assert.match(app.html,new RegExp(`Take ${count-1} <span class="pl-muted">→</span> Take ${count}`));
    assert.match(app.html,/Your takes overlaid/);
    assert.doesNotMatch(app.html,/DTW|acoustic|alignment path|RMS|F0/);
    assert.match(app.html,/class="pl-btn pl-primary" id="topNew">Record new take/);
    app.node('compareBtn').listeners.click();
    assert.match(app.html,/Performance trace/);
  }
});

test('introduction opens a clean workspace without requesting the mic',()=>{
 const app=boot('/');
 assert.match(app.html,/Go straight to Studio/);
 app.node('startTutorial').onclick();
 assert.match(app.html,/Your next take starts here/);
 app.node('introContinue').listeners.click();
 assert.equal(app.context.location.assigned,'/studio?tour=1');
 app.node('introClose').listeners.click();
 assert.doesNotMatch(app.html,/id="introDialog"/);
 assert.equal(app.micCalls,0);
});
test('tutorial workspace starts empty for returning users and preserves prior takes',()=>{
 const saved=JSON.stringify([{id:'real',label:'Saved take',workspace:'Product pitch',features}]);
 const app=boot('/studio','?tour=1',{prelightStudioTakes:saved,prelightStudioWorkspace:JSON.stringify('Product pitch')});
 assert.match(app.html,/What would you like to practice/);
 assert.doesNotMatch(app.html,/Saved take|Performance trace|id="compareBtn"/);
 app.node('practiceType').value='Product pitch';
 app.node('practiceForm').listeners.submit({preventDefault(){}});
 assert.equal(app.context.location.assigned,'/studio?workspace=Product%20pitch%202&tour=1');
 assert.equal(app.entries.get('prelightStudioTakes'),saved);
 assert.equal(app.micCalls,0);
});
test('guided steps follow actual take state and can be dismissed',()=>{
 for(const count of [0,1,2]){
  const app=boot('/studio','?workspace=Speech&tour=1',{prelightStudioTakes:JSON.stringify(Array.from({length:count},(_,i)=>({id:`real-${i}`,label:`Take ${i+1}`,workspace:'Speech',features})))});
  assert.match(app.html,new RegExp(`Step ${count+1} of 4`));
  if(count===2){app.node('compareBtn').listeners.click();assert.match(app.html,/Step 4 of 4/);}
  app.node('exitGuide').listeners.click();
  assert.doesNotMatch(app.html,/Speaking tutorial/);
  assert.equal(app.micCalls,0);
 }
 assert.doesNotMatch(boot('/studio','?demo=1&tour=1').html,/Speaking tutorial/);
});

test('comparison summary describes direction, ties and unavailable measurements accurately',()=>{
  const cases=[
    [{duration:78,longPauseCount:5},{duration:72,longPauseCount:3},'6 seconds shorter; 2 fewer long pauses'],
    [{duration:72,longPauseCount:3},{duration:73,longPauseCount:4},'1 second longer; 1 more long pause'],
    [{duration:72.1,longPauseCount:0},{duration:72.2,longPauseCount:0},'about the same length; the same number of long pauses'],
    [{duration:78,longPauseCount:null},{duration:72,longPauseCount:null},'6 seconds shorter.'],
  ];
  for(const [from,to,expected] of cases){
    const app=boot('/studio','?workspace=Speech',{prelightStudioTakes:JSON.stringify([
      {id:'a',label:'Earlier',workspace:'Speech',features:{...features,...from}},
      {id:'b',label:'<Latest>',workspace:'Speech',features:{...features,...to}}
    ])});
    app.node('compareBtn').listeners.click();
    assert.ok(app.html.includes(`&lt;Latest&gt; compared with Earlier: ${expected}`));
    assert.doesNotMatch(app.html,/<Latest>|NaN/);
  }
});
