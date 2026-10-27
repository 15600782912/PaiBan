const {api,signedIn,login,newKey,confirm,errorMessage,loginLabel} = require('../../services/api')
const {beijingParts} = require('../../utils/time')

Page({
  data:{name:'',accountBusy:false,loggedIn:false,loading:false,error:'',companies:[],companyIndex:0,current:null,members:[],items:[],loginLabel,
    selectedDay:beijingParts().date,weekStart:'',weekEnd:'',singleDay:false,manage:false,
    panel:'',companyName:'',inviteCode:'',submitting:false,uncertain:false},
  actorMatches(actor) {
    const user=wx.getStorageSync('user')
    return Boolean(actor && signedIn() && user && user.id===actor && this.userId===actor && wx.getStorageSync('token')===this.actorToken)
  },
  clearPrivate() {
    this.generation=(this.generation||0)+1
    this.userId=null;this.actorToken=null;this.createKey=null
    this.setData({name:'',loggedIn:false,loading:false,error:'',companies:[],companyIndex:0,current:null,members:[],items:[],manage:false,
      panel:'',companyName:'',inviteCode:'',submitting:false,uncertain:false,accountBusy:false,
      selectedDay:beijingParts().date,weekStart:'',weekEnd:'',singleDay:false})
  },
  ensureActor() {
    if(this.actorMatches(this.userId)) return true
    this.clearPrivate()
    return false
  },
  onShow() { if(this.userId) this.ensureActor(); if(!this.data.submitting && !this.data.uncertain) return this.load() },
  async onPullDownRefresh() { if(!this.data.submitting && !this.data.uncertain) await this.load(); wx.stopPullDownRefresh() },
  async login() {
    if(this.data.accountBusy) return
    this.setData({accountBusy:true,error:''})
    try { await login(); this.clearPrivate(); await this.load() }
    catch(e) { this.setData({error:errorMessage(e)}) }
    finally { this.setData({accountBusy:false}) }
  },
  async load() {
    if(this.userId) this.ensureActor()
    if(!signedIn()) { this.clearPrivate(); return }
    const user=wx.getStorageSync('user') || {}
    this.userId=user.id;this.actorToken=wx.getStorageSync('token')
    const actor=this.userId
    this.setData({loggedIn:true,name:user.display_name || '主播'})
    const generation=(this.generation||0)+1; this.generation=generation
    this.setData({loading:true,error:'',members:[]})
    try {
      const result=await api('/companies')
      if(generation!==this.generation || !this.actorMatches(actor)) return
      const user=wx.getStorageSync('user') || {}
      const preferred=Number(wx.getStorageSync(`company-${user.id}`))
      const index=Math.max(0,result.items.findIndex(co=>co.id===preferred))
      const current=result.items[index] || null
      this.setData({companies:result.items,companyIndex:index,current,manage:current && current.role!=='member'})
      if(current && current.role!=='member') {
        const members=await api(`/companies/${current.id}/members`)
        if(generation!==this.generation || !this.actorMatches(actor)) return
        this.setData({members:members.items})
      }
    } catch(e) {
      if(generation===this.generation) {
        if(!this.actorMatches(actor)) {this.clearPrivate();this.setData({error:errorMessage(e)});return}
        this.setData({error:errorMessage(e),items:[],companies:[],current:null,manage:false})
      }
    }
    finally { if(generation===this.generation) this.setData({loading:false}) }
  },
  switchCompany(e) {
    const index=Number(e.detail.value), current=this.data.companies[index]
    if(!this.ensureActor() || !current) return
    const user=wx.getStorageSync('user') || {}
    wx.setStorageSync(`company-${user.id}`,current.id)
    return this.load()
  },
  openPanel(e) { if(!this.data.submitting && !this.data.uncertain) { this.createKey=null; this.setData({panel:e.currentTarget.dataset.panel,error:''}) } },
  input(e) { if(!this.data.submitting && !this.data.uncertain) this.setData({[e.currentTarget.dataset.field]:e.detail.value}) },
  async submitPanel() {
    if(this.userId && !this.ensureActor()) return
    if(!signedIn() || this.data.submitting) return
    if(!this.userId) {const user=wx.getStorageSync('user') || {};this.userId=user.id;this.actorToken=wx.getStorageSync('token')}
    const actor=this.userId,requestToken=this.actorToken
    const current=()=>this.actorToken===requestToken && this.actorMatches(actor)
    this.setData({submitting:true,error:''})
    try {
      let result
      if(this.data.panel==='create') {
        if(!this.data.companyName.trim()) throw new Error('请输入公司名称')
        this.createKey=this.createKey || newKey()
        result=await api('/companies',{method:'POST',key:this.createKey,data:{name:this.data.companyName}})
      } else {
        if(!this.data.inviteCode.trim()) throw new Error('请输入邀请码')
        result=await api('/companies/join',{method:'POST',data:{invite_code:this.data.inviteCode}})
      }
      if(!current()) return
      const user=wx.getStorageSync('user') || {}
      wx.setStorageSync(`company-${user.id}`,result.id)
      this.createKey=null
      this.setData({panel:'',companyName:'',inviteCode:'',uncertain:false})
      await this.load()
    } catch(e) {
      if(current()) this.setData({error:errorMessage(e),uncertain:e.code==='network' || e.status>=500})
      else if(this.userId===actor && this.actorToken===requestToken && !signedIn()) {this.clearPrivate();this.setData({error:errorMessage(e)})}
    } finally { if(current()) this.setData({submitting:false}) }
  },
  goPersonal() {wx.switchTab({url:'/pages/personal/index'})},
  copyCode() {if(this.ensureActor() && this.data.current && this.data.current.role==='owner') wx.setClipboardData({data:this.data.current.invite_code})},
  management() { wx.navigateTo({url:`/pages/manage/index?cid=${this.data.current.id}`}) },
  async leave() {
    if(!this.ensureActor() || !this.data.current) return
    const actor=this.userId,cid=this.data.current.id,requestToken=this.actorToken
    const current=()=>this.actorToken===requestToken && this.actorMatches(actor)
    if(!await confirm('退出后将无法查看此公司的排班，尚未开始的排班会自动取消。')) return
    if(!current()) return
    try { await api(`/companies/${cid}/leave`,{method:'POST'}); if(current()) await this.load() }
    catch(e) {
      if(current()) this.setData({error:errorMessage(e)})
      else if(this.userId===actor && this.actorToken===requestToken && !signedIn()) {
        this.clearPrivate();this.setData({error:errorMessage(e)})
      }
    }
  }
})
