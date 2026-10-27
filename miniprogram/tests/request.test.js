const test = require('node:test')
const assert = require('node:assert/strict')
const { createTransport, saveWithOverlap } = require('../utils/request')

test('transport attaches bearer and idempotency headers and handles 204', async () => {
  let options
  const transport = createTransport({request(o) { options = o; o.success({statusCode:204,data:''}) }},
    {baseURL:'https://example.com/api/v1', getToken:()=> 'token'})
  assert.equal(await transport('/work-logs/1', {method:'DELETE',key:'unique'}), null)
  assert.equal(options.url,'https://example.com/api/v1/work-logs/1')
  assert.equal(options.header.Authorization,'Bearer token')
  assert.equal(options.header['Idempotency-Key'],'unique')
})

test('network timeout is surfaced once without automatically repeating writes', async () => {
  let calls = 0
  const transport = createTransport({request(o) { calls++; o.fail({errMsg:'timeout'}) }},
    {baseURL:'https://example.com', getToken:()=>''})
  await assert.rejects(transport('/work-logs',{method:'POST',key:'same-key'}), err => err.code==='network')
  assert.equal(calls,1)
})

test('unauthorized response clears session and validation errors remain readable', async () => {
  let cleared = false
  const api = createTransport({request(o) { o.success({statusCode:401,data:{detail:{code:'unauthorized',message:'请登录'}}}) }},
    {baseURL:'https://example.com', getToken:()=>'', onUnauthorized:()=>{cleared=true}})
  await assert.rejects(api('/me'), err=>err.status===401 && err.message==='请登录')
  assert.equal(cleared,true)
  const invalid = createTransport({request(o) { o.success({statusCode:422,data:{detail:[{msg:'结束时间必须晚于开始时间'}]}}) }},
    {baseURL:'https://example.com', getToken:()=>''})
  await assert.rejects(invalid('/work-logs'), /结束时间/)
})

test('an old unauthorized response cannot clear a newer login session',async()=>{
  let token='old-token',cleared=false,complete
  const api=createTransport({request(o){complete=o.success}},
    {baseURL:'https://example.com',getToken:()=>token,onUnauthorized:()=>{cleared=true}})
  const pending=api('/me')
  token='new-token'
  complete({statusCode:401,data:{detail:{code:'unauthorized',message:'旧登录过期'}}})
  await assert.rejects(pending,err=>err.status===401)
  assert.equal(cleared,false)
})

test('overlap confirmation retries once with original payload and explicit consent', async () => {
  const calls=[]
  const result = await saveWithOverlap({note:'直播'}, async body=>{
    calls.push(body)
    if (!body.confirm_overlap) throw Object.assign(new Error('重叠'),{code:'overlap'})
    return {id:1}
  }, async ()=>true)
  assert.deepEqual(calls,[{note:'直播'},{note:'直播',confirm_overlap:true}])
  assert.equal(result.id,1)
})

test('declining overlap never retries and stale version never triggers overlap confirmation', async () => {
  let calls=0
  await assert.rejects(saveWithOverlap({}, async ()=>{calls++; throw Object.assign(new Error('重叠'),{code:'overlap'})},async()=>false), /重叠/)
  assert.equal(calls,1)
  await assert.rejects(saveWithOverlap({},async()=>{throw Object.assign(new Error('刷新'),{code:'stale_version'})},
    async()=>{throw new Error('must not ask')}), /刷新/)
})
