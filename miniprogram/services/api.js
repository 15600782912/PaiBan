const {createTransport} = require('../utils/request')
const {baseURL,loginMode} = require('../config')
const loginLabel = loginMode==='development'?'开发测试登录':'微信登录'
const api = createTransport(wx, {baseURL, getToken:()=>wx.getStorageSync('token'),
  onUnauthorized:()=>{wx.removeStorageSync('token'); wx.removeStorageSync('user')}})
const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
const signedIn = () => Boolean(wx.getStorageSync('token'))
const confirm = message => new Promise(resolve=>wx.showModal({title:'请确认',content:message,
  success:r=>resolve(r.confirm),fail:()=>resolve(false)}))
const errorMessage = error => error.message || '操作失败，请稍后重试'

function chooseTestAccount() {
  const accounts=require('./demo-accounts')
  return new Promise((resolve,reject)=>{
    let settled=false
    const finish=(error,account)=>{
      if(settled) return
      settled=true
      if(error) reject(error);else resolve(account)
    }
    wx.navigateTo({url:'/pages/test-login/index',events:{
      testAccountSelected(event) {
        const account=accounts.find(item=>item.account===(event && event.account))
        if(!account) {finish(new Error('请选择有效的测试账号'));return}
        finish(null,{account:account.account,display_name:account.display_name})
      },
      testAccountCancelled() {finish(new Error('已取消测试登录'))}
    },fail:()=>finish(new Error('无法打开测试账号选择页，请重试'))})
  })
}

async function login() {
  let result
  if(loginMode==='development') {
    const account=await chooseTestAccount()
    result=await api('/auth/dev',{method:'POST',data:account})
  } else {
    const code = await new Promise((resolve,reject)=>wx.login({success:r=>r.code ? resolve(r.code) : reject(new Error('微信登录失败')),
      fail:()=>reject(new Error('微信登录失败，请重试'))}))
    result=await api('/auth/wechat',{method:'POST',data:{code}})
  }
  wx.setStorageSync('token',result.access_token)
  wx.setStorageSync('user',result.user)
  return result.user
}

function query(params) {
  return '?' + Object.keys(params).map(key=>`${key}=${encodeURIComponent(params[key])}`).join('&')
}
module.exports={api,newKey,signedIn,confirm,errorMessage,login,query,loginLabel}
