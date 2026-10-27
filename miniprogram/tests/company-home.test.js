const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')

function harness(deferPosts=false) {
  let page
  const storage={token:'token-1',user:{id:1,display_name:'主播甲'}}
  const requests=[]
  global.Page=value=>{page=value}
  global.wx={getStorageSync:key=>storage[key],setStorageSync:(key,value)=>{storage[key]=value},
    removeStorageSync:key=>{delete storage[key]},request:options=>{requests.push(options);if(options.url.endsWith('/members')) {options.success({statusCode:200,data:{items:[]}});return}if(options.method==='POST' && !deferPosts) options.fail();else if(options.url.includes('schedules')) options.success({statusCode:200,data:{items:[]}})},
    showModal:options=>options.success({confirm:true,content:'新姓名'})}
  for(const file of ['../pages/company/index','../services/api']) delete require.cache[require.resolve(file)]
  require('../pages/company/index')
  return {storage,requests,page:{...page,data:structuredClone(page.data),setData(values){Object.assign(this.data,values)}}}
}
const ok=(request,data)=>request.success({statusCode:200,data})

test('personal is the launch page with personal, company and schedule tabs',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../app.json'),'utf8'))
  assert.equal(config.pages[0],'pages/personal/index')
  assert.deepEqual(config.tabBar.list.map(item=>item.text),['个人','公司','排班'])
})

test('company roster displays all member roles and clears on company or account changes',async()=>{
  const {page,requests,storage}=harness()
  // Supply roster responses manually to exercise late-response isolation.
  global.wx.request=o=>requests.push(o)
  let pending=page.load();ok(requests[0],{items:[{id:1,role:'owner'},{id:2,role:'member'}]})
  await new Promise(resolve=>setImmediate(resolve))
  ok(requests[1],{items:[{user_id:7,display_name:'同名',role:'operator'},{user_id:8,display_name:'同名',role:'member'}]})
  await pending;assert.equal(page.data.members.length,2)
  pending=page.switchCompany({detail:{value:1}});assert.deepEqual(page.data.members,[])
  ok(requests[2],{items:[{id:1,role:'owner'},{id:2,role:'member'}]});await pending
  assert.deepEqual(page.data.members,[]);assert.equal(requests.length,3)
  storage['company-1']=1
  pending=page.load();ok(requests[3],{items:[{id:1,role:'owner'}]})
  await new Promise(resolve=>setImmediate(resolve))
  storage.user={id:2};storage.token='next'
  const fresh=page.load();ok(requests[5],{items:[]});await fresh
  ok(requests[4],{items:[{user_id:99,display_name:'旧名单'}]});await pending
  assert.deepEqual(page.data.members,[])
})

test('account switch clears an uncertain company form and prevents retry as the new user',async()=>{
  const {page,storage,requests}=harness()
  const loading=page.load()
  ok(requests[0],{items:[]})
  await loading
  page.setData({panel:'create',companyName:'旧公司',uncertain:true})
  page.createKey='old-key'
  storage.user={id:2,display_name:'主播乙'};storage.token='token-2'
  await page.submitPanel()
  assert.equal(requests.length,1)
  assert.equal(page.data.panel,'')
  assert.equal(page.data.uncertain,false)
})

test('old company load cannot populate a newly signed-in account',async()=>{
  const {page,storage,requests}=harness()
  const loading=page.load()
  storage.user={id:2};storage.token='token-2'
  ok(requests[0],{items:[{id:9,role:'owner'}]})
  await loading
  assert.deepEqual(page.data.companies,[])
  assert.equal(requests.length,1)
})

test('401 clears all private company state',async()=>{
  const {page,requests}=harness()
  page.setData({panel:'join',inviteCode:'SECRET',companies:[{id:9}],manage:true})
  const loading=page.load()
  requests[0].success({statusCode:401,data:{detail:{code:'unauthorized',message:'请重新登录'}}})
  await loading
  assert.equal(page.data.loggedIn,false)
  assert.equal(page.data.inviteCode,'')
  assert.deepEqual(page.data.companies,[])
  assert.equal(page.data.manage,false)
})

test('company submission cannot change panel or idempotency key while in flight',()=>{
  const {page}=harness()
  page.createKey='pending-key'
  page.setData({submitting:true,panel:'create',companyName:'公司甲'})
  page.openPanel({currentTarget:{dataset:{panel:'join'}}})
  assert.equal(page.data.panel,'create')
  assert.equal(page.createKey,'pending-key')
})

test('old company submission failure cannot clear a newly loaded account or its draft',async()=>{
  const {page,storage,requests}=harness(true)
  const first=page.load();ok(requests[0],{items:[]});await first
  page.setData({panel:'create',companyName:'旧公司'})
  const submission=page.submitPanel(),old=requests[1]
  storage.user={id:2,display_name:'新账号'};storage.token='token-2'
  const fresh=page.load();ok(requests[2],{items:[]});await fresh
  page.setData({panel:'join',inviteCode:'NEW'})
  old.fail();await submission
  assert.equal(page.data.loggedIn,true)
  assert.equal(page.data.panel,'join')
  assert.equal(page.data.inviteCode,'NEW')
})

test('ordinary members see company info without requesting company schedules',async()=>{
  const {page,requests}=harness()
  const pending=page.load();ok(requests[0],{items:[{id:1,name:'公司甲',role:'member'}]});await pending
  assert.equal(page.data.current.name,'公司甲')
  assert.equal(page.data.manage,false)
  assert.deepEqual(page.data.items,[])
  assert.equal(requests.length,1)
  assert.equal(typeof page.logout,'undefined')
  assert.equal(typeof page.rename,'undefined')
})

test('company info is lightweight for operators and does not request schedules',async()=>{
  const {page,requests}=harness()
  const pending=page.load();ok(requests[0],{items:[{id:1,name:'公司甲',role:'operator'}]});await pending
  assert.equal(page.data.manage,true)
  assert.equal(requests.length,2)
  assert.equal(typeof page.add,'undefined')
})

test('company switching works for members and mixed roles without granting edit access',async()=>{
  const {page,storage,requests}=harness()
  const companies={items:[{id:1,name:'公司甲',role:'owner'},{id:2,name:'公司乙',role:'member'}]}
  let pending=page.load();ok(requests[0],companies);await pending
  page.switchCompany({detail:{value:1}})
  let request=requests.at(-1);ok(request,companies)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.data.current.id,2)
  assert.equal(page.data.manage,false)
  page.switchCompany({detail:{value:0}})
  assert.equal(storage['company-1'],1)
  request=requests.at(-1);ok(request,companies)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(page.data.current.id,1)
  assert.equal(page.data.manage,true)
})

test('401 when leaving a company clears private data and shows the login error',async()=>{
  const {page,requests}=harness(true)
  const pending=page.load();ok(requests[0],{items:[{id:1,name:'公司甲',role:'member'}]});await pending
  const leaving=page.leave()
  await new Promise(resolve=>setImmediate(resolve))
  requests[1].success({statusCode:401,data:{detail:{code:'unauthorized',message:'请重新登录'}}})
  await leaving
  assert.equal(page.data.loggedIn,false)
  assert.equal(page.data.current,null)
  assert.deepEqual(page.data.companies,[])
  assert.match(page.data.error,/重新登录/)
})

test('an old leave failure cannot clear the next account company information',async()=>{
  const {page,requests,storage}=harness(true)
  const pending=page.load();ok(requests[0],{items:[{id:1,name:'公司甲',role:'member'}]});await pending
  const leaving=page.leave()
  await new Promise(resolve=>setImmediate(resolve))
  const old=requests[1]
  storage.user={id:2};storage.token='token-2'
  const fresh=page.load();ok(requests[2],{items:[{id:2,name:'公司乙',role:'member'}]});await fresh
  old.success({statusCode:401,data:{detail:{code:'unauthorized',message:'旧请求失效'}}})
  await leaving
  assert.equal(page.data.loggedIn,true)
  assert.equal(page.data.current.name,'公司乙')
})

