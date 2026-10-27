const test=require('node:test')
const assert=require('node:assert/strict')

test('salary creation preserves body and key after an uncertain response',async()=>{
  let definition
  const writes=[]
  global.Page=value=>{definition=value}
  global.wx={getStorageSync:k=>k==='token'?'token':{id:1},setStorageSync:()=>{},
    request(o){
      if(o.method==='POST') { writes.push(o); if(writes.length===1) o.fail({errMsg:'timeout'}); else o.success({statusCode:201,data:{id:1,name:'常规场',hourly_rate_fen:8000}}) }
      else o.success({statusCode:200,data:o.url.endsWith('/me')?{id:1,display_name:'主播'}:{items:[]}})
    }}
  for(const p of ['../pages/salary/index','../services/api']) {try{delete require.cache[require.resolve(p)]}catch(_){}}
  require('../pages/salary/index')
  const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(v){Object.assign(this.data,v)}}
  await page.load()
  page.openAdd()
  page.change({currentTarget:{dataset:{field:'name'}},detail:{value:'常规场'}})
  page.change({currentTarget:{dataset:{field:'rate'}},detail:{value:'80'}})
  await page.save()
  assert.equal(page.data.uncertain,true)
  page.change({currentTarget:{dataset:{field:'rate'}},detail:{value:'90'}})
  assert.equal(page.data.draft.rate,'80')
  await page.save()
  assert.equal(writes[0].header['Idempotency-Key'],writes[1].header['Idempotency-Key'])
  assert.deepEqual(writes[0].data,writes[1].data)
})

test('switching accounts clears a pending salary form and cannot submit it as the new user',async()=>{
  let definition,uid=1,posts=0
  global.Page=value=>{definition=value}
  global.wx={getStorageSync:k=>k==='token'?'token':{id:uid},setStorageSync:()=>{},
    request(o){if(o.method==='POST'){posts++;o.fail({errMsg:'timeout'})}
      else o.success({statusCode:200,data:o.url.endsWith('/me')?{id:uid}:{items:[]}})}}
  for(const p of ['../pages/salary/index','../services/api']) delete require.cache[require.resolve(p)]
  require('../pages/salary/index')
  const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(v){Object.assign(this.data,v)}}
  await page.load();page.openAdd()
  page.change({currentTarget:{dataset:{field:'name'}},detail:{value:'账号1薪资'}})
  page.change({currentTarget:{dataset:{field:'rate'}},detail:{value:'80'}})
  await page.save();assert.equal(page.data.uncertain,true)
  uid=2;page.onShow();await page.save()
  assert.equal(posts,1)
  assert.equal(page.data.editorOpen,false)
  assert.equal(page.data.draft.name,'')
})
