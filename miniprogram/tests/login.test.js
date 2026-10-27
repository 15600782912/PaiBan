const test=require('node:test')
const assert=require('node:assert/strict')
const accounts=require('../services/demo-accounts')

function developmentHarness(selection) {
  const storage={token:'old-token',user:{id:99}},requests=[],navigation=[],writes=[]
  global.wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>{writes.push(k);storage[k]=v},
    login:()=>{throw new Error('development must not call wx.login')},
    showActionSheet:()=>{throw new Error('must not classify users by role')},
    navigateTo:options=>{
      navigation.push(options)
      if(selection==='navigation-failure') options.fail()
      else if(selection==='cancel') options.events.testAccountCancelled()
      else {
        options.events.testAccountSelected({account:selection})
        options.events.testAccountSelected({account:selection})
        options.events.testAccountCancelled()
      }
    },
    request(options){requests.push(options);options.success({statusCode:200,data:{access_token:'dev-token',user:{id:2,display_name:options.data.display_name}}})}}
  delete require.cache[require.resolve('../services/api')]
  return {login:require('../services/api').login,storage,requests,navigation,writes}
}

test('test login directly chooses from nine stable accounts without role classification',async()=>{
  assert.equal(accounts.length,9)
  assert.equal(new Set(accounts.map(account=>account.account)).size,9)
  assert.equal(accounts[0].display_name,'测试用户阿辰')
  assert.equal(accounts.some(account=>'accounts' in account || 'label' in account),false)
  for(const account of accounts) {
    const h=developmentHarness(account.account),user=await h.login()
    assert.equal(h.navigation[0].url,'/pages/test-login/index')
    assert.equal(h.requests.length,1)
    assert.deepEqual(h.requests[0].data,{account:account.account,display_name:account.display_name})
    assert.equal(user.display_name,account.display_name)
    assert.equal(h.storage.token,'dev-token')
  }
})

test('cancel and navigation failure do not login or overwrite the existing session',async()=>{
  for(const selection of ['cancel','navigation-failure']) {
    const h=developmentHarness(selection)
    await assert.rejects(h.login(),/取消|打开/)
    assert.equal(h.requests.length,0);assert.equal(h.writes.length,0)
    assert.equal(h.storage.token,'old-token');assert.equal(h.storage.user.id,99)
  }
})

test('invalid selected accounts are rejected without network requests',async()=>{
  for(const selection of [undefined,'','admin','demo-operator-6','__proto__']) {
    const h=developmentHarness(selection)
    await assert.rejects(h.login(),/有效/)
    assert.equal(h.requests.length,0);assert.equal(h.writes.length,0)
  }
})

test('opening the account page alone does not issue requests',async()=>{
  const h=developmentHarness('unused')
  global.wx.navigateTo=options=>h.navigation.push(options)
  const pending=h.login()
  assert.equal(h.requests.length,0);assert.equal(h.writes.length,0)
  h.navigation[0].events.testAccountCancelled()
  await assert.rejects(pending,/取消/)
})

test('wechat login mode continues to exchange wx.login code with real backend endpoint',async()=>{
  const config=require('../config'),oldMode=config.loginMode
  config.loginMode='wechat'
  let request
  global.wx={getStorageSync:()=>'',setStorageSync:()=>{},
    navigateTo:()=>{throw new Error('must not show test accounts')},
    login:options=>options.success({code:'real-wechat-code'}),
    request(options){request=options;options.success({statusCode:200,data:{access_token:'real-token',user:{id:1}}})}}
  try {
    delete require.cache[require.resolve('../services/api')]
    await require('../services/api').login()
    assert.ok(request.url.endsWith('/auth/wechat'))
    assert.deepEqual(request.data,{code:'real-wechat-code'})
  } finally {config.loginMode=oldMode}
})
