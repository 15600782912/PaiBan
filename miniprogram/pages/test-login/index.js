const accounts=require('../../services/demo-accounts')
const {loginMode}=require('../../config')
Page({
  data:{accounts,enabled:loginMode==='development',returning:false,error:''},
  selectAccount(e) {
    if(!this.data.enabled || this.data.returning || this.finalized) return
    const account=accounts.find(item=>item.account===e.currentTarget.dataset.account)
    if(!account) {this.setData({error:'请选择有效的测试账号'});return}
    const channel=this.getOpenerEventChannel()
    this.setData({returning:true,error:''})
    wx.navigateBack({
      success:()=>{
        if(this.finalized) return
        this.finalized=true
        channel.emit('testAccountSelected',{account:account.account})
      },
      fail:()=>this.setData({returning:false,error:'返回失败，请重试或使用左上角返回'})
    })
  },
  cancel() {
    if(this.data.returning) return
    wx.navigateBack({fail:()=>this.setData({error:'请使用左上角返回上一页'})})
  },
  onUnload() {
    // navigateBack unloads this page before its success callback. In a selected
    // return, the callback owns resolution; a system/back cancellation settles here.
    if(this.finalized || this.data.returning) return
    this.finalized=true
    this.getOpenerEventChannel().emit('testAccountCancelled')
  }
})
