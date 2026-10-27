const test = require('node:test')
const assert = require('node:assert/strict')

test('company creation freezes unchanged input on 5xx and retries the same key',async()=>{
  let page
  const posts=[]
  global.Page=value=>{page=value}
  global.wx={getStorageSync:key=>key==='token'?'token':{id:1},setStorageSync:()=>{},
    request(options) {
      if(options.method==='POST') {
        posts.push(options)
        if(posts.length===1) options.success({statusCode:503,data:{detail:{code:'database_unavailable',message:'稍后重试'}}})
        else options.success({statusCode:201,data:{id:1}})
      } else options.success({statusCode:200,data:{items:[]}})
    }}
  for(const path of ['../pages/company/index','../services/api']) delete require.cache[require.resolve(path)]
  require('../pages/company/index')
  const instance={...page,data:JSON.parse(JSON.stringify(page.data)),setData(v){Object.assign(this.data,v)}}
  instance.setData({panel:'create',companyName:'公司甲'})
  await instance.submitPanel()
  assert.equal(instance.data.uncertain,true)
  instance.input({currentTarget:{dataset:{field:'companyName'}},detail:{value:'公司乙'}})
  assert.equal(instance.data.companyName,'公司甲')
  await instance.submitPanel()
  assert.equal(posts[0].header['Idempotency-Key'],posts[1].header['Idempotency-Key'])
  assert.deepEqual(posts[0].data,posts[1].data)
})
