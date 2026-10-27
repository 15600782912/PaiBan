const {api,confirm,errorMessage} = require('../../services/api')

Page({
  data:{cid:null,company:null,members:[],owner:false,name:'',loading:false,busy:false,error:''},
  onLoad(options) { this.setData({cid:Number(options.cid)}); return this.load() },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async load() {
    this.setData({loading:true,error:'',company:null,members:[],owner:false})
    try {
      const [companies,members]=await Promise.all([api('/companies'),api(`/companies/${this.data.cid}/members`)])
      const company=companies.items.find(co=>co.id===this.data.cid)
      if(!company || company.role==='member') throw new Error('无公司管理权限')
      this.setData({company,members:members.items.map(item=>({...item,
        roleName:item.role==='owner'?'创建者':item.role==='operator'?'可排班成员':'普通成员'})),owner:company.role==='owner',name:company.name})
    } catch(e) { this.setData({error:errorMessage(e)}) }
    finally { this.setData({loading:false}) }
  },
  input(e) { this.setData({name:e.detail.value}) },
  async action(work) {
    if(this.data.busy) return
    this.setData({busy:true,error:''})
    try { await work(); await this.load() }
    catch(e) { this.setData({error:errorMessage(e)}) }
    finally { this.setData({busy:false}) }
  },
  rename() { return this.action(()=>api(`/companies/${this.data.cid}`,{method:'PATCH',data:{name:this.data.name}})) },
  copyCode() { wx.setClipboardData({data:this.data.company.invite_code}) },
  async resetCode() {
    if(!await confirm('重置后旧邀请码立即失效。确定重置？')) return
    return this.action(()=>api(`/companies/${this.data.cid}/invite/reset`,{method:'POST'}))
  },
  async role(e) {
    const item=this.data.members.find(row=>row.user_id===Number(e.currentTarget.dataset.id))
    if(!item || item.role==='owner') return
    const role=item.role==='operator'?'member':'operator'
    if(!await confirm(`确定${role==='operator'?'授予':'取消'}「${item.display_name}」的排班授权？`)) return
    return this.action(()=>api(`/companies/${this.data.cid}/members/${item.user_id}`,{method:'PATCH',data:{role}}))
  },
  async remove(e) {
    const item=this.data.members.find(row=>row.user_id===Number(e.currentTarget.dataset.id))
    if(!item || !await confirm(`移除「${item.display_name}」后，未开始的排班会自动取消。确定移除？`)) return
    return this.action(()=>api(`/companies/${this.data.cid}/members/${item.user_id}`,{method:'DELETE'}))
  },
  async leave() {
    if(!await confirm('退出此公司并取消尚未开始的排班？')) return
    if(this.data.busy) return
    this.setData({busy:true,error:''})
    try { await api(`/companies/${this.data.cid}/leave`,{method:'POST'}); wx.navigateBack() }
    catch(e) { this.setData({error:errorMessage(e)}) }
    finally { this.setData({busy:false}) }
  }
})
