import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = {};
vm.runInNewContext(fs.readFileSync(new URL('./public/studioState.js', import.meta.url), 'utf8'), context);
const state = context.StudioState;
function storage(entries) {
  const map = new Map(Object.entries(entries));
  return { get length() { return map.size; }, key: i => [...map.keys()][i], getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) };
}
test('stale demo names migrate automatically and are excluded from real takes', () => {
  const db = storage({prelightStudioTakes: JSON.stringify([{id:'old',label:'NeutralEye Pitch',features:{energy:[.1,.2]}},{id:'real',label:'My pitch',features:{energy:[.3,.4]}}]),prelightStudioWorkspace:JSON.stringify('Neutral Eye'),unrelated:JSON.stringify('NeutralEye')});
  state.migrate(db);
  const takes = JSON.parse(db.getItem('prelightStudioTakes'));
  assert.equal(takes[0].label,'Product Pitch');
  assert.equal(state.isDemo(takes[0]),true);
  assert.equal(state.isDemo(takes[1]),false);
  assert.deepEqual(takes[1],{id:'real',label:'My pitch',features:{energy:[.3,.4]}});
  assert.equal(JSON.parse(db.getItem('prelightStudioWorkspace')),'Product Pitch');
  assert.equal(JSON.parse(db.getItem('unrelated')),'NeutralEye');
  const before = db.getItem('prelightStudioTakes');
  state.migrate(db);
  assert.equal(db.getItem('prelightStudioTakes'),before);
});
test('nested demo state and malformed old labels migrate without clearing storage', () => {
  const db = storage({prelightStudioDemo:JSON.stringify({name:'Neutral Eye Pitch',takes:[{label:'NeutralEye'}]}),prelightStudioWorkspace:'NeutralEye Pitch'});
  state.migrate(db);
  assert.equal(/neutral\s*eye/i.test(db.getItem('prelightStudioDemo')),false);
  assert.equal(db.getItem('prelightStudioWorkspace'),'Product Pitch');
});
test('explicit demo flags and legacy seed IDs stay outside normal workspaces', () => {
  assert.equal(state.isDemo({id:'demo-1'}),true);
  assert.equal(state.isDemo({isDemo:true}),true);
  assert.equal(state.isDemo({demo:true}),true);
  assert.equal(state.isDemo({id:'take-123'}),false);
});
test('unavailable storage does not crash migration', () => {
  assert.doesNotThrow(()=>state.migrate({get length(){throw new Error('blocked');}}));
});
