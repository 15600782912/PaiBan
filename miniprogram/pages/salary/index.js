const {api,signedIn,login,loginLabel,newKey,confirm,errorMessage} = require('../../services/api')
const {parseRate,formatMoney} = require('../../utils/calendar')

Page({
  data:{loggedIn:false,loginLabel,loading:false,busy:false,uncertain:false,error:'',editorError:'',items:[],
    editorOpen:false,editingId:null,draft:{name:'',rate:''}},
  onShow() { if(this.userId) this.ensureActor(); if(!this.data.busy && !this.data.uncertain) this.load() },
  actorMatches(actor) {const user=wx.getStorageSync('user');return Boolean(actor && signedIn() && user && user.id===actor && this.userId===actor)},
  ensureActor() {
    if(this.actorMatches(this.userId)) return true
    this.generation=(this.generation||0)+1;this.clearPrivate()
    this.setData({loggedIn:signedIn()})
    return false
  },
  async onPullDownRefresh() { if(!this.data.busy && !this.data.uncertain) await this.load(); wx.stopPullDownRefresh() },
  async login() {
    if(this.data.loading) return
    this.setData({loading:true,error:''})
    try {await login();await this.load()} catch(e) {this.setData({error:errorMessage(e)})}
    finally {this.setData({loading:false})}
  },
  async load() {
    if(this.userId) this.ensureActor()
    const requestToken=wx.getStorageSync('token')
    const generation=(this.generation||0)+1;this.generation=generation
    this.setData({loggedIn:signedIn(),loading:true,error:''})
    if(!signedIn()) {this.clearPrivate();return}
    try {
      const [result,me]=await Promise.all([api('/salaries'),api('/me')])
      if(generation!==this.generation || wx.getStorageSync('token')!==requestToken) return
      if(this.userId && this.userId!==me.id) this.clearPrivate()
      this.userId=me.id
      this.setData({loggedIn:true,items:result.items.map(row=>({...row,rateText:formatMoney(row.hourly_rate_fen)}))})
    } catch(e) {
      if(generation===this.generation && wx.getStorageSync('token')===requestToken) {
        if(!signedIn()) this.clearPrivate()
        this.setData({error:errorMessage(e),items:[],loggedIn:signedIn()})
      }
    } finally {if(generation===this.generation) this.setData({loading:false})}
  },
  clearPrivate() {
    this.userId=null;this.pending=null;this.createKey=null
    this.setData({loggedIn:false,items:[],editorOpen:false,editingId:null,draft:{name:'',rate:''},loading:false,uncertain:false,busy:false,editorError:''})
  },
  openAdd() {
    if(this.data.busy || this.data.uncertain || this.data.loading || !signedIn()) return
    this.createKey=newKey()
    this.setData({editorOpen:true,editingId:null,draft:{name:'',rate:''},editorError:''})
  },
  openEdit(e) {
    if(this.data.busy || this.data.uncertain) return
    const row=this.data.items.find(item=>item.id===Number(e.currentTarget.dataset.id))
    if(!row) return
    this.setData({editorOpen:true,editingId:row.id,draft:{name:row.name,rate:formatMoney(row.hourly_rate_fen)},editorError:''})
  },
  closeEditor() {if(!this.data.busy && !this.data.uncertain) this.setData({editorOpen:false,editorError:''})},
  stopTap() {},
  change(e) {
    if(this.data.busy || this.data.uncertain) return
    const field=e.currentTarget.dataset.field
    if(['name','rate'].includes(field)) this.setData({draft:{...this.data.draft,[field]:e.detail.value},editorError:''})
  },
  async save() {
    if(!this.ensureActor()) return
    const actor=this.userId
    if(this.data.busy) return
    this.setData({busy:true,editorError:''})
    try {
      const body=this.data.uncertain?this.pending:{name:this.data.draft.name.trim(),hourly_rate_fen:parseRate(this.data.draft.rate)}
      if(!body.name || body.name.length>80) throw new Error('请填写1–80字的薪资名称')
      this.pending=body
      const id=this.data.editingId
      await api(id?'/salaries/'+id:'/salaries',{method:id?'PUT':'POST',data:body,key:id?undefined:this.createKey})
      if(!this.actorMatches(actor)) return
      this.pending=null;this.createKey=null
      this.setData({editorOpen:false,uncertain:false,busy:false})
      await this.load()
    } catch(e) {if(this.actorMatches(actor)) this.setData({editorError:errorMessage(e),uncertain:e.code==='network'||e.status>=500})}
    finally {if(this.userId===actor) this.setData({busy:false})}
  },
  async remove(e) {
    if(!this.ensureActor()) return
    const actor=this.userId
    if(this.data.busy || this.data.uncertain) return
    const id=Number(e.currentTarget.dataset.id)
    if(!await confirm('确定删除这项薪资？')) return
    if(!this.actorMatches(actor)) return
    this.setData({busy:true,error:''})
    try {await api('/salaries/'+id,{method:'DELETE'});if(!this.actorMatches(actor)) return;this.setData({busy:false});await this.load()}
    catch(error) {if(this.actorMatches(actor)) this.setData({error:errorMessage(error)})}
    finally {if(this.userId===actor) this.setData({busy:false})}
  }
})
