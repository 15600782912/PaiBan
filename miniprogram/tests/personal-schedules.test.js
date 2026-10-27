const test=require('node:test')
const assert=require('node:assert/strict')
function harness() {
  let definition
  const storage={token:'token-1',user:{id:1,display_name:'主播甲'},'company-1':99}
  const requests=[]
  global.Page=value=>{definition=value}
  global.wx={getStorageSync:key=>storage[key],setStorageSync:(key,value)=>{storage[key]=value},
    removeStorageSync:key=>{delete storage[key]},request:options=>{requests.push(options);if(options.url.includes('/my-schedules')) ok(options,{items:rows()})},
    showModal:options=>options.success({confirm:true,content:'新姓名'}),switchTab:()=>{}}
  for(const file of ['../pages/personal/index','../services/api']) delete require.cache[require.resolve(file)]
  require('../pages/personal/index')
  return {storage,requests,page:{...definition,data:structuredClone(definition.data),setData(values){Object.assign(this.data,values)}}}
}
const ok=(request,data)=>request.success({statusCode:200,data})
const companies={items:[{id:1,name:'公司甲',role:'member'},{id:2,name:'公司乙',role:'owner'}]}
function rows() {return [
  {id:1,company_id:1,company_name:'公司甲',start_at:'2030-01-01T12:00:00+08:00',end_at:'2030-01-01T13:00:00+08:00',minutes:60,note:'直播',status:'active',has_conflict:true},
  {id:2,company_id:2,company_name:'公司乙',start_at:'2030-01-01T12:00:00+08:00',end_at:'2030-01-01T13:00:00+08:00',minutes:60,note:'',status:'cancelled',has_conflict:false}
]}
async function loaded() {const h=harness();const pending=h.page.load();ok(h.requests[0],companies);await pending;return h}

test('logout clears company data and ignores a late company response',async()=>{
  const {page,storage,requests}=harness()
  const loading=page.load()
  page.setData({items:[{id:8}],companyIndex:1})
  page.logout()
  ok(requests[0],{items:[{id:9,role:'owner'}]})
  await loading
  assert.equal(storage.token,undefined)
  assert.deepEqual(page.data.companies,[])
  assert.deepEqual(page.data.items,[])
})

test('rename updates the current user and logout is available without company membership',async()=>{
  const {page,storage,requests}=harness()
  const loading=page.load();ok(requests[0],{items:[]});await loading
  await page.rename()
  assert.equal(requests[1].method,'PATCH')
  ok(requests[1],{id:1,display_name:'新姓名'})
  await new Promise(resolve=>setImmediate(resolve))
  ok(requests[2],{items:[]})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(storage.user.display_name,'新姓名')
  assert.equal(page.data.name,'新姓名')
  page.logout()
  assert.equal(page.data.loggedIn,false)
})

test('401 while renaming clears private state and unlocks the login controls',async()=>{
  const {page,requests}=harness()
  const loading=page.load();ok(requests[0],{items:[]});await loading
  page.setData({companies:[{id:8}],items:[{id:9}]})
  page.rename()
  requests[1].success({statusCode:401,data:{detail:{code:'unauthorized',message:'请重新登录'}}})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.data.accountBusy,false)
  assert.equal(page.data.loggedIn,false)
  assert.deepEqual(page.data.companies,[])
  assert.deepEqual(page.data.items,[])
  assert.match(page.data.error,/重新登录/)
})

test('an old rename failure cannot clear a newly loaded account',async()=>{
  const {page,requests,storage}=harness()
  const first=page.load();ok(requests[0],{items:[]});await first
  page.rename()
  storage.user={id:2,display_name:'主播乙'};storage.token='token-2'
  const second=page.load();ok(requests[2],{items:[]});await second
  requests[1].success({statusCode:401,data:{detail:{code:'unauthorized',message:'旧请求失效'}}})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.data.loggedIn,true)
  assert.equal(page.data.name,'主播乙')
  assert.equal(storage.token,'token-2')
})

test('personal defaults to all companies and preserves company, cancellation and conflict labels',async()=>{
  const {page,requests}=await loaded()
  assert.equal(page.data.companyIndex,0)
  assert.equal(page.data.items.length,1)
  assert.equal(page.data.cancelledCount,1)
  page.toggleCancelled()
  assert.equal(page.data.items.length,2)
  assert.equal(page.data.items[0].company_name,'公司甲')
  assert.equal(page.data.items[0].hasConflict,true)
  assert.equal(page.data.items[1].status,'cancelled')
  assert.match(page.data.items[0].interval,/01.01/)
  assert.equal(requests.filter(r=>r.url.includes('/my-schedules')).length,1)
  assert.equal(typeof page.edit,'undefined')
})
test('company filtering is personal-only and does not alter the company tab preference',async()=>{
  const {page,storage}=await loaded()
  page.switchCompany({detail:{value:2}})
  assert.deepEqual(page.data.items,[])
  assert.equal(page.data.cancelledCount,1)
  page.toggleCancelled()
  assert.deepEqual(page.data.items.map(r=>r.id),[2])
  assert.equal(storage['company-1'],99)
  page.switchCompany({detail:{value:0}})
  assert.equal(page.data.items.length,1)
})
test('single-day and weekly filters query Beijing date boundaries',async()=>{
  const {page,requests}=await loaded()
  page.setData({selectedDay:'2030-01-01'})
  const pending=page.toggleDay();ok(requests[requests.length-1],companies);await pending
  const url=decodeURIComponent(requests.at(-1).url)
  assert.match(url,/start_at=2030-01-01T00:00:00\+08:00/)
  assert.match(url,/end_at=2030-01-02T00:00:00\+08:00/)
})
test('failed loads clear schedules, and old responses cannot replace a new account',async()=>{
  const {page,requests,storage}=await loaded()
  const pending=page.load()
  requests.at(-1).fail()
  await pending
  assert.deepEqual(page.data.items,[])
  const old=page.load(), oldRequest=requests.at(-1)
  storage.token='token-2';storage.user={id:2,display_name:'乙'}
  const fresh=page.load();ok(requests.at(-1),{items:[]});await fresh
  ok(oldRequest,companies);await old
  assert.equal(page.data.name,'乙')
  assert.deepEqual(page.data.items,[])
})
test('no membership produces an empty personal schedule without calling schedules',async()=>{
  const {page,requests}=harness();const pending=page.load();ok(requests[0],{items:[]});await pending
  assert.deepEqual(page.data.items,[])
  assert.equal(requests.length,1)
})

test('company menu selects locally, closes, and leaves the company-tab preference intact',async()=>{
  const {page,requests,storage}=await loaded()
  const count=requests.length
  page.toggleCompanyMenu()
  assert.equal(page.data.companyMenuOpen,true)
  page.selectCompany({currentTarget:{dataset:{index:2}}})
  assert.equal(page.data.companyMenuOpen,false)
  assert.equal(page.data.companyIndex,2)
  assert.equal(page.data.cancelledCount,1)
  page.toggleCancelled()
  assert.deepEqual(page.data.items.map(item=>item.id),[2])
  assert.equal(requests.length,count)
  assert.equal(storage['company-1'],99)
})

test('closing and hiding the company menu preserve selection',async()=>{
  const {page}=await loaded()
  page.switchCompany({detail:{value:1}})
  page.toggleCompanyMenu();page.closeCompanyMenu()
  assert.equal(page.data.companyMenuOpen,false)
  assert.equal(page.data.companyIndex,1)
  page.toggleCompanyMenu();page.onHide()
  assert.equal(page.data.companyMenuOpen,false)
  assert.equal(page.data.companyIndex,1)
})

test('menu closes on logout, account switch, and expired login',async()=>{
  let h=await loaded()
  h.page.toggleCompanyMenu();h.page.logout()
  assert.equal(h.page.data.companyMenuOpen,false)
  h=await loaded();h.page.toggleCompanyMenu()
  h.storage.token='token-2';h.storage.user={id:2}
  h.page.selectCompany({currentTarget:{dataset:{index:1}}})
  assert.equal(h.page.data.companyMenuOpen,false)
  assert.equal(h.page.data.companyIndex,0)
  h=await loaded();h.page.toggleCompanyMenu()
  const loading=h.page.load()
  h.requests.at(-1).success({statusCode:401,data:{detail:{code:'unauthorized',message:'请重新登录'}}})
  await loading
  assert.equal(h.page.data.companyMenuOpen,false)
  assert.equal(h.page.data.loggedIn,false)
})

test('refresh closes the menu and falls back to all companies when selection disappears',async()=>{
  const {page,requests}=await loaded()
  page.switchCompany({detail:{value:2}});page.toggleCompanyMenu()
  const loading=page.load()
  assert.equal(page.data.companyMenuOpen,false)
  ok(requests.at(-1),{items:[companies.items[0]]});await loading
  assert.equal(page.data.companyIndex,0)
  assert.equal(page.data.companyOptions[0].name,'全部公司')
})

test('menu cannot open while loading or for an account with no companies',async()=>{
  const {page}=await loaded()
  page.setData({loading:true});page.toggleCompanyMenu()
  assert.equal(page.data.companyMenuOpen,false)
  page.setData({loading:false,companies:[]});page.toggleCompanyMenu()
  assert.equal(page.data.companyMenuOpen,false)
})

test('company menu toggles on repeated capsule taps and closes on page scrolling',async()=>{
  const {page,requests}=await loaded()
  const count=requests.length
  page.toggleCompanyMenu()
  assert.equal(page.data.companyMenuOpen,true)
  page.toggleCompanyMenu()
  assert.equal(page.data.companyMenuOpen,false)
  page.toggleCompanyMenu();page.onPageScroll({scrollTop:20})
  assert.equal(page.data.companyMenuOpen,false)
  assert.equal(page.data.companyIndex,0)
  assert.equal(requests.length,count)
})

test('cancelled personal rows collapse by default and counts follow company filtering',async()=>{
  const {page,requests}=await loaded()
  assert.equal(page.data.showCancelled,false)
  assert.equal(page.data.activeCount,1)
  assert.equal(page.data.cancelledCount,1)
  const count=requests.length
  page.toggleCancelled();assert.equal(page.data.items.length,2)
  page.toggleCancelled();assert.equal(page.data.items.length,1)
  assert.equal(requests.length,count)
  page.switchCompany({detail:{value:2}})
  assert.equal(page.data.activeCount,0)
  assert.equal(page.data.cancelledCount,1)
  page.toggleCancelled();assert.equal(page.data.items[0].status,'cancelled')
  page.logout();assert.equal(page.data.showCancelled,false);assert.equal(page.data.cancelledCount,0)
})
