const {api,signedIn,login,confirm,errorMessage,query,loginLabel} = require('../../services/api')
const {beijingParts,weekRange,moveDay,toISO,displayScheduleInterval,hours} = require('../../utils/time')

Page({
  data:{name:'',accountBusy:false,loggedIn:false,loading:false,error:'',companies:[],
    companyOptions:[{id:null,name:'全部公司'}],companyIndex:0,companyMenuOpen:false,showCancelled:false,cancelledCount:0,activeCount:0,items:[],loginLabel,
    selectedDay:beijingParts().date,weekStart:'',weekEnd:'',singleDay:false},
  actorMatches(actor) {
    const user=wx.getStorageSync('user')
    return Boolean(actor && signedIn() && user && user.id===actor && this.userId===actor && wx.getStorageSync('token')===this.actorToken)
  },
  clearPrivate() {
    this.generation=(this.generation||0)+1
    this.userId=null;this.actorToken=null;this.schedules=[];this.cancelContext=null
    this.setData({name:'',loggedIn:false,loading:false,error:'',companies:[],companyOptions:[{id:null,name:'全部公司'}],companyIndex:0,companyMenuOpen:false,showCancelled:false,cancelledCount:0,activeCount:0,items:[],accountBusy:false,
      selectedDay:beijingParts().date,weekStart:'',weekEnd:'',singleDay:false})
  },
  ensureActor() {
    if(this.actorMatches(this.userId)) return true
    this.clearPrivate()
    return false
  },
  onShow() { if(this.userId) this.ensureActor(); return this.load() },
  onHide() {this.closeCompanyMenu()},
  onPageScroll() {if(this.data.companyMenuOpen) this.closeCompanyMenu()},
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async login() {
    if(this.data.accountBusy) return
    this.setData({accountBusy:true,error:''})
    try { await login(); this.clearPrivate(); await this.load() }
    catch(e) { this.setData({error:errorMessage(e)}) }
    finally { this.setData({accountBusy:false}) }
  },
  logout() {
    if(this.data.accountBusy) return
    wx.removeStorageSync('token');wx.removeStorageSync('user')
    this.clearPrivate()
  },
  rename() {
    if(!this.ensureActor() || this.data.accountBusy) return
    const actor=this.userId,requestToken=this.actorToken
    wx.showModal({title:'设置姓名',editable:true,placeholderText:'输入排班时显示的姓名',content:this.data.name,
      success:async result=>{
        if(!result.confirm || !this.actorMatches(actor)) return
        this.setData({accountBusy:true,error:''})
        try {
          const me=await api('/me',{method:'PATCH',data:{display_name:result.content}})
          if(!this.actorMatches(actor)) return
          wx.setStorageSync('user',me);this.setData({name:me.display_name})
          await this.load()
        } catch(e) {
          if(this.actorMatches(actor)) this.setData({error:errorMessage(e)})
          else if(this.userId===actor && this.actorToken===requestToken && !signedIn()) {
            this.clearPrivate();this.setData({error:errorMessage(e)})
          }
        }
        finally { if(this.actorMatches(actor)) this.setData({accountBusy:false}) }
      }})
  },
  async load() {
    if(this.userId) this.ensureActor()
    if(!signedIn()) {this.clearPrivate();return}
    const user=wx.getStorageSync('user') || {}
    this.userId=user.id;this.actorToken=wx.getStorageSync('token')
    const actor=this.userId,requestToken=this.actorToken
    const generation=(this.generation||0)+1;this.generation=generation
    const range=weekRange(this.data.selectedDay)
    const start=this.data.singleDay?this.data.selectedDay:range.start
    const end=this.data.singleDay?moveDay(start,1):range.end
    const selected=(this.data.companyOptions[this.data.companyIndex] || {}).id
    this.schedules=[]
    this.setData({loggedIn:true,name:user.display_name || '主播',loading:true,error:'',items:[],companyMenuOpen:false,cancelledCount:0,activeCount:0,
      weekStart:range.start,weekEnd:moveDay(range.end,-1)})
    const current=()=>generation===this.generation && this.actorMatches(actor) && wx.getStorageSync('token')===requestToken
    try {
      const companies=await api('/companies')
      if(!current()) return
      const options=[{id:null,name:'全部公司'},...companies.items]
      this.setData({companies:companies.items,companyOptions:options,companyIndex:Math.max(0,options.findIndex(c=>c.id===selected))})
      if(!companies.items.length) return
      const result=await api('/my-schedules'+query({start_at:toISO(start,'00:00'),end_at:toISO(end,'00:00')}))
      if(!current()) return
      this.schedules=result.items.map(item=>({...item,interval:displayScheduleInterval(item.start_at,item.end_at),
        duration:hours(item.minutes),hasConflict:Boolean(item.has_conflict)}))
      this.renderSchedules()
    } catch(e) {
      if(generation!==this.generation) return
      if(!this.actorMatches(actor)) {
        if(!signedIn() && this.actorToken===requestToken) {this.clearPrivate();this.setData({error:errorMessage(e)})}
        return
      }
      this.schedules=[]
      this.setData({items:[],error:errorMessage(e)})
    } finally {if(generation===this.generation) this.setData({loading:false})}
  },
  renderSchedules() {
    const selected=(this.data.companyOptions[this.data.companyIndex] || {}).id
    const context=[selected || 'all',this.data.selectedDay,this.data.singleDay].join('|')
    const showCancelled=context===this.cancelContext && this.data.showCancelled
    this.cancelContext=context
    const rows=(this.schedules || []).filter(item=>selected==null || item.company_id===selected)
    const cancelledCount=rows.filter(item=>item.status==='cancelled').length
    this.setData({showCancelled,cancelledCount,activeCount:rows.length-cancelledCount,
      items:rows.filter(item=>showCancelled || item.status!=='cancelled')})
  },
  toggleCancelled() {
    if(!this.ensureActor() || this.data.loading) return
    this.setData({showCancelled:!this.data.showCancelled});this.renderSchedules()
  },
  switchCompany(e) {
    if(!this.ensureActor()) return
    const index=Number(e.detail.value)
    if(!Number.isInteger(index) || !this.data.companyOptions[index]) return
    this.setData({companyIndex:index,companyMenuOpen:false});this.renderSchedules()
  },
  toggleCompanyMenu() {
    if(!this.ensureActor() || this.data.loading || this.data.accountBusy || !this.data.companies.length) return
    this.setData({companyMenuOpen:!this.data.companyMenuOpen})
  },
  closeCompanyMenu() {this.setData({companyMenuOpen:false})},
  selectCompany(e) {this.switchCompany({detail:{value:e.currentTarget.dataset.index}})},
  stopTap() {},
  selectDay(e) {this.setData({selectedDay:e.detail.value});return this.load()},
  week(e) {this.setData({selectedDay:moveDay(this.data.selectedDay,Number(e.currentTarget.dataset.days))});return this.load()},
  toggleDay() {this.setData({singleDay:!this.data.singleDay});return this.load()},
  goCompany() {wx.switchTab({url:'/pages/company/index'})}
})
