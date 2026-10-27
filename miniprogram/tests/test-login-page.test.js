const test=require('node:test')
const assert=require('node:assert/strict')
function harness() {
  let definition
  const events=[],backs=[]
  global.Page=value=>{definition=value}
  global.wx={navigateBack:options=>backs.push(options)}
  delete require.cache[require.resolve('../pages/test-login/index')]
  require('../pages/test-login/index')
  const page={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v)},getOpenerEventChannel:()=>({emit:(name,data)=>events.push({name,data})})}
  return {page,events,backs}
}
const select=(page,account)=>page.selectAccount({currentTarget:{dataset:{account}}})
test('account choice emits only after returning; unload does not cancel the selection',()=>{
  const {page,events,backs}=harness()
  assert.equal(page.data.accounts.length,9)
  select(page,'demo-admin');select(page,'demo-anchor-lin')
  assert.equal(backs.length,1);assert.equal(events.length,0)
  page.onUnload();assert.equal(events.length,0)
  backs[0].success()
  assert.deepEqual(events,[{name:'testAccountSelected',data:{account:'demo-admin'}}])
})
test('back without selecting cancels, invalid accounts never navigate',()=>{
  const {page,events,backs}=harness()
  select(page,'wrong');assert.equal(backs.length,0)
  page.onUnload();page.onUnload()
  assert.deepEqual(events,[{name:'testAccountCancelled',data:undefined}])
})
test('failed return preserves the choice page and permits retry or cancellation',()=>{
  const {page,events,backs}=harness()
  select(page,'demo-anchor-lin');backs[0].fail()
  assert.equal(page.data.returning,false);assert.equal(events.length,0)
  select(page,'demo-anchor-xia');assert.equal(backs.length,2)
  page.onUnload();backs[1].success()
  assert.equal(events[0].data.account,'demo-anchor-xia')
})
