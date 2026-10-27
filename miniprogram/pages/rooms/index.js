const {api,newKey,confirm}=require('../../services/api')
const session=require('../../utils/page-session')
Page({
  ...session,
  data:{cid:null,loggedIn:false,loading:false,error:'',manage:false,rooms:[],busy:false,uncertain:false,editorOpen:false,editingId:null,draft:''},
  clearPrivate() {
    this.generation=(this.generation||0)+1;this.userId=null;this.actorToken=null;this.pending=null;this.createKey=null
    this.setData({loggedIn:false,loading:false,error:'',manage:false,rooms:[],busy:false,uncertain:false,editorOpen:false,editingId:null,draft:''})
  },
  onLoad(options) {this.setData({cid:Number(options.cid)});return this.load()},
  onShow() {if(this.userId && !this.ensureActor()) return;if(!this.data.loading && !this.data.busy && !this.data.uncertain && this.data.cid) return this.load()},
  async onPullDownRefresh() {if(!this.data.busy && !this.data.uncertain) await this.load();wx.stopPullDownRefresh()},
  async load() {
    const state=this.prepareActor();if(!state) {this.setData({error:'请先登录'});return}
    const {actor,token}=state,generation=(this.generation||0)+1;this.generation=generation
    this.setData({loading:true,error:'',rooms:[],manage:false})
    try {
      const companies=await api('/companies')
      if(generation!==this.generation || !this.actorMatches(actor,token)) return
      const company=companies.items.find(co=>co.id===this.data.cid)
      if(!company || !['owner','operator'].includes(company.role)) throw new Error('无直播间管理权限')
      const rooms=await api(`/companies/${this.data.cid}/rooms`)
      if(generation!==this.generation || !this.actorMatches(actor,token)) return
      this.setData({manage:true,rooms:rooms.items})
    } catch(e) {this.handleError(e,actor,token,generation)}
    finally {if(generation===this.generation) this.setData({loading:false})}
  },
  openAdd() {
    if(!this.ensureActor() || !this.data.manage || this.data.busy || this.data.uncertain || this.data.loading) return
    this.createKey=newKey();this.setData({editorOpen:true,editingId:null,draft:'',error:''})
  },
  openEdit(e) {
    if(!this.ensureActor() || !this.data.manage || this.data.busy || this.data.uncertain) return
    const room=this.data.rooms.find(room=>room.id===Number(e.currentTarget.dataset.id));if(!room) return
    this.setData({editorOpen:true,editingId:room.id,draft:room.name,error:''})
  },
  change(e) {if(!this.data.busy && !this.data.uncertain) this.setData({draft:e.detail.value})},
  closeEditor() {if(!this.data.busy && !this.data.uncertain) this.setData({editorOpen:false})},
  async save() {
    if(!this.ensureActor() || !this.data.manage || this.data.busy || this.data.uncertain) return
    const name=this.data.draft.trim()
    if(!name || name.length>80) {this.setData({error:'请输入1–80字的直播间名称'});return}
    const id=this.data.editingId
    this.pending={path:`/companies/${this.data.cid}/rooms`+(id?'/'+id:''),method:id?'PATCH':'POST',data:{name},key:id?undefined:(this.createKey || newKey())}
    return this.submit()
  },
  async disable(e) {
    if(!this.ensureActor() || !this.data.manage || this.data.busy || this.data.uncertain) return
    const actor=this.userId,token=this.actorToken
    const room=this.data.rooms.find(room=>room.id===Number(e.currentTarget.dataset.id))
    if(!room || !room.active || !await confirm('停用“'+room.name+'”？历史排班会保留，新排班将不能选择该直播间。')) return
    if(!this.actorMatches(actor,token)) return
    this.pending={path:`/companies/${this.data.cid}/rooms/${room.id}`,method:'PATCH',data:{active:false}}
    return this.submit()
  },
  retry() {if(this.data.uncertain && this.pending) return this.submit()},
  async submit() {
    if(!this.ensureActor() || !this.data.manage || this.data.busy || !this.pending) return
    const actor=this.userId,token=this.actorToken,pending=this.pending
    this.setData({busy:true,error:''})
    try {
      await api(pending.path,pending)
      if(!this.actorMatches(actor,token)) return
      this.pending=null;this.createKey=null
      this.setData({busy:false,uncertain:false,editorOpen:false,editingId:null,draft:''})
      await this.load()
    } catch(e) {
      if(this.actorMatches(actor,token)) this.setData({error:e.message || '保存失败',uncertain:e.code==='network' || e.status>=500})
      else this.handleError(e,actor,token)
    } finally {if(this.actorMatches(actor,token)) this.setData({busy:false})}
  }
})
