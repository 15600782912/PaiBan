const {api,login,loginLabel,query}=require('../../services/api')
const {beijingParts,toISO,moveDay}=require('../../utils/time')
const {groupSchedules}=require('../../utils/schedule')
const session=require('../../utils/page-session')
Page({
  ...session,
  data:{loggedIn:false,loginLabel,accountBusy:false,loading:false,error:'',companies:[],companyIndex:0,current:null,manage:false,
    companyMenuOpen:false,roomMenuOpen:false,showCancelled:false,cancelledCount:0,activeCount:0,roomFilterKey:'all',roomFilterLabel:'全部直播间',roomOptions:[{key:'all',name:'全部直播间'}],selectedDay:beijingParts().date,groups:[],rooms:[]},
  clearPrivate() {
    this.generation=(this.generation||0)+1;this.userId=null;this.actorToken=null;this.allGroups=[];this.filterCompanyId=null;this.cancelContext=null
    this.setData({loggedIn:false,accountBusy:false,loading:false,error:'',companies:[],companyIndex:0,current:null,manage:false,
      companyMenuOpen:false,roomMenuOpen:false,showCancelled:false,cancelledCount:0,activeCount:0,roomFilterKey:'all',roomFilterLabel:'全部直播间',roomOptions:[{key:'all',name:'全部直播间'}],selectedDay:beijingParts().date,groups:[],rooms:[]})
  },
  onShow() {return this.load()},
  onHide() {this.closeMenus()},
  onPageScroll() {if(this.data.companyMenuOpen || this.data.roomMenuOpen) this.closeMenus()},
  async onPullDownRefresh() {await this.load();wx.stopPullDownRefresh()},
  async login() {
    if(this.data.accountBusy) return
    this.setData({accountBusy:true,error:''})
    try {await login();this.clearPrivate();await this.load()}
    catch(e) {this.setData({error:e.message || '登录失败'})}
    finally {this.setData({accountBusy:false})}
  },
  async load() {
    const session=this.prepareActor();if(!session) return
    const {actor,token}=session,generation=(this.generation||0)+1;this.generation=generation
    this.allGroups=[]
    this.setData({loading:true,error:'',groups:[],rooms:[],cancelledCount:0,activeCount:0,current:null,manage:false,companyMenuOpen:false,roomMenuOpen:false,roomOptions:[{key:'all',name:'全部直播间'}]})
    const current=()=>generation===this.generation && this.actorMatches(actor,token)
    try {
      const companies=await api('/companies');if(!current()) return
      const preferred=Number(wx.getStorageSync('company-'+actor))
      const index=Math.max(0,companies.items.findIndex(co=>co.id===preferred)),company=companies.items[index] || null
      this.setData({companies:companies.items,companyIndex:index,current:company,manage:Boolean(company && company.role!=='member')})
      if(!company || this.filterCompanyId!==company.id) this.setData({roomFilterKey:'all',roomFilterLabel:'全部直播间'})
      this.filterCompanyId=company?company.id:null
      if(!company) return
      const start=this.data.selectedDay,end=moveDay(start,1)
      const q=query({start_at:toISO(start,'00:00'),end_at:toISO(end,'00:00')})
      const [rooms,schedules]=await Promise.all([api(`/companies/${company.id}/rooms`),api(`/companies/${company.id}/schedules${q}`)])
      if(!current()) return
      this.allGroups=groupSchedules(rooms.items,schedules.items,start,this.data.manage)
      this.setData({rooms:rooms.items});this.renderRoomGroups()
    } catch(e) {this.handleError(e,actor,token,generation)}
    finally {if(generation===this.generation) this.setData({loading:false})}
  },
  renderRoomGroups() {
    const groups=this.allGroups || []
    const options=[{key:'all',name:'全部直播间'},...groups.map(room=>({key:room.key,name:room.name+(room.id!=null && !room.active?'（已停用）':'')}))]
    const selected=options.find(option=>option.key===this.data.roomFilterKey) || options[0]
    const context=[this.filterCompanyId,this.data.selectedDay,selected.key].join('|')
    const showCancelled=context===this.cancelContext && this.data.showCancelled
    this.cancelContext=context
    const scoped=selected.key==='all'?groups:groups.filter(group=>group.key===selected.key)
    const rows=scoped.flatMap(group=>group.items)
    const cancelledCount=rows.filter(row=>row.status==='cancelled').length
    const visible=scoped.map(group=>({...group,cancelledCount:group.items.filter(row=>row.status==='cancelled').length,
      items:group.items.filter(row=>showCancelled || row.status!=='cancelled')}))
      .filter(group=>group.items.length || (this.data.manage && group.active))
    this.setData({roomOptions:options,roomFilterKey:selected.key,roomFilterLabel:selected.name,showCancelled,cancelledCount,
      activeCount:rows.length-cancelledCount,groups:visible})
  },
  toggleCancelled() {
    if(!this.ensureActor() || this.data.loading) return
    this.setData({showCancelled:!this.data.showCancelled});this.renderRoomGroups()
  },
  selectRoom(e) {
    if(!this.ensureActor() || this.data.loading) return
    const key=e.currentTarget.dataset.key
    if(!this.data.roomOptions.some(option=>option.key===key)) return
    this.setData({roomFilterKey:key,roomMenuOpen:false});this.renderRoomGroups()
  },
  toggleRoomMenu() {if(this.ensureActor() && !this.data.loading && this.data.current) this.setData({roomMenuOpen:!this.data.roomMenuOpen,companyMenuOpen:false})},
  closeMenus() {if(this.data.companyMenuOpen || this.data.roomMenuOpen) this.setData({companyMenuOpen:false,roomMenuOpen:false})},
  toggleCompanyMenu() {if(this.ensureActor() && !this.data.loading) this.setData({companyMenuOpen:!this.data.companyMenuOpen,roomMenuOpen:false})},
  closeCompanyMenu() {if(this.data.companyMenuOpen) this.setData({companyMenuOpen:false})},
  stopTap() {},
  switchCompany(e) {
    if(!this.ensureActor()) return
    const index=Number(e.currentTarget.dataset.index),company=this.data.companies[index]
    if(!company) return
    wx.setStorageSync('company-'+this.userId,company.id);return this.load()
  },
  selectDay(e) {this.setData({selectedDay:e.detail.value});return this.load()},
  day(e) {this.setData({selectedDay:moveDay(this.data.selectedDay,Number(e.currentTarget.dataset.days))});return this.load()},
  add(e) {
    if(!this.ensureActor() || !this.data.manage || this.data.loading || !this.data.current) return
    const room=Number(e.currentTarget.dataset.room)
    if(!this.data.rooms.some(item=>item.id===room && item.active)) return
    wx.navigateTo({url:`/pages/editor/index?cid=${this.data.current.id}&room_id=${room}&date=${this.data.selectedDay}`})
  },
  edit(e) {
    if(!this.ensureActor() || !this.data.manage || this.data.loading || !this.data.current) return
    wx.navigateTo({url:`/pages/editor/index?cid=${this.data.current.id}&id=${e.currentTarget.dataset.id}`})
  },
  copySchedule(e) {
    if(!this.ensureActor() || !this.data.manage || this.data.loading || !this.data.current) return
    const id=Number(e.currentTarget.dataset.id)
    const source=(this.allGroups || []).flatMap(group=>group.items).find(row=>row.id===id && row.status==='active')
    if(source) wx.navigateTo({url:`/pages/editor/index?cid=${this.data.current.id}&copy_from=${id}`})
  },
  manageRooms() {
    if(this.ensureActor() && this.data.manage && this.data.current) wx.navigateTo({url:`/pages/rooms/index?cid=${this.data.current.id}`})
  },
  goCompany() {wx.switchTab({url:'/pages/company/index'})}
})
