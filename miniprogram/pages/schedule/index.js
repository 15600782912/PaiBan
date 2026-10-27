const {api,login,loginLabel,query}=require('../../services/api')
const {beijingParts,toISO,moveDay,weekRange}=require('../../utils/time')
const {groupSchedules,scheduleView}=require('../../utils/schedule')
const session=require('../../utils/page-session')
Page({
  ...session,
  data:{loggedIn:false,loginLabel,accountBusy:false,loading:false,error:'',companies:[],companyIndex:0,current:null,manage:false,
    companyMenuOpen:false,roomMenuOpen:false,anchorMenuOpen:false,members:[],anchorFilterKey:'all',anchorFilterLabel:'全部主播',viewMode:'day',rangeLabel:'',showCancelled:false,cancelledCount:0,activeCount:0,roomFilterKey:'all',roomFilterLabel:'全部直播间',roomOptions:[{key:'all',name:'全部直播间'}],selectedDay:beijingParts().date,groups:[],rooms:[]},
  clearPrivate() {
    this.generation=(this.generation||0)+1;this.userId=null;this.actorToken=null;this.allGroups=[];this.scheduleItems=[];this.filterCompanyId=null;this.cancelContext=null
    this.setData({loggedIn:false,accountBusy:false,loading:false,error:'',companies:[],companyIndex:0,current:null,manage:false,
      companyMenuOpen:false,roomMenuOpen:false,anchorMenuOpen:false,members:[],anchorFilterKey:'all',anchorFilterLabel:'全部主播',viewMode:'day',rangeLabel:'',showCancelled:false,cancelledCount:0,activeCount:0,roomFilterKey:'all',roomFilterLabel:'全部直播间',roomOptions:[{key:'all',name:'全部直播间'}],selectedDay:beijingParts().date,groups:[],rooms:[]})
  },
  onShow() {return this.load()},
  onHide() {this.closeMenus()},
  onPageScroll() {if(this.data.companyMenuOpen || this.data.roomMenuOpen || this.data.anchorMenuOpen) this.closeMenus()},
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
    this.setData({loading:true,error:'',groups:[],rooms:[],members:[],anchorMenuOpen:false,cancelledCount:0,activeCount:0,current:null,manage:false,companyMenuOpen:false,roomMenuOpen:false,roomOptions:[{key:'all',name:'全部直播间'}]})
    const current=()=>generation===this.generation && this.actorMatches(actor,token)
    try {
      const companies=await api('/companies');if(!current()) return
      const preferred=Number(wx.getStorageSync('company-'+actor))
      const index=Math.max(0,companies.items.findIndex(co=>co.id===preferred)),company=companies.items[index] || null
      this.setData({companies:companies.items,companyIndex:index,current:company,manage:Boolean(company && company.role!=='member')})
      if(!company || this.filterCompanyId!==company.id) this.setData({roomFilterKey:'all',roomFilterLabel:'全部直播间',anchorFilterKey:'all',anchorFilterLabel:'全部主播'})
      this.filterCompanyId=company?company.id:null
      if(!company) return
      const range=this.data.viewMode==='week'?weekRange(this.data.selectedDay):{start:this.data.selectedDay,end:moveDay(this.data.selectedDay,1)}
      const {start,end}=range
      this.setData({rangeLabel:start+' — '+moveDay(end,-1)})
      const q=query({start_at:toISO(start,'00:00'),end_at:toISO(end,'00:00')})
      const [rooms,schedules,members]=await Promise.all([api(`/companies/${company.id}/rooms`),api(`/companies/${company.id}/schedules${q}`),this.data.manage?api(`/companies/${company.id}/members`):Promise.resolve({items:[]})])
      if(!current()) return
      this.scheduleItems=schedules.items
      this.allGroups=[]
      for(let day=start;day<end;day=moveDay(day,1)) this.allGroups.push(...groupSchedules(rooms.items,schedules.items,day,this.data.manage))
      const selected=members.items.find(item=>item.user_id===Number(this.data.anchorFilterKey))
      this.setData({rooms:rooms.items,members:members.items,anchorFilterKey:selected?selected.user_id:'all',anchorFilterLabel:selected?selected.display_name:'全部主播'});this.renderRoomGroups()
    } catch(e) {this.handleError(e,actor,token,generation)}
    finally {if(generation===this.generation) this.setData({loading:false})}
  },
  renderRoomGroups() {
    const groups=this.allGroups || []
    const unique=[...new Map(groups.map(room=>[room.key,room])).values()]
    const options=[{key:'all',name:'全部直播间'},...unique.map(room=>({key:room.key,name:room.name+(room.id!=null && !room.active?'（已停用）':'')}))]
    const selected=options.find(option=>option.key===this.data.roomFilterKey) || options[0]
    const context=[this.filterCompanyId,this.data.selectedDay,this.data.viewMode,this.data.anchorFilterKey,selected.key].join('|')
    const showCancelled=context===this.cancelContext && this.data.showCancelled
    this.cancelContext=context
    const view=scheduleView(this.data.rooms,this.scheduleItems || [],this.data.selectedDay,this.data.viewMode,this.data.manage,this.data.anchorFilterKey,selected.key,showCancelled)
    this.setData({roomOptions:options,roomFilterKey:selected.key,roomFilterLabel:selected.name,showCancelled,
      cancelledCount:view.cancelledCount,activeCount:view.activeCount,groups:view.groups})
  },
  selectAnchor(e) {
    if(!this.ensureActor() || this.data.loading || !this.data.manage) return
    const key=e.currentTarget.dataset.key
    const member=this.data.members.find(item=>item.user_id===Number(key))
    if(key!=='all' && !member) return
    this.setData({anchorFilterKey:member?member.user_id:'all',anchorFilterLabel:member?member.display_name:'全部主播',anchorMenuOpen:false})
    this.renderRoomGroups()
  },
  toggleAnchorMenu() {
    if(this.ensureActor() && !this.data.loading && this.data.manage) this.setData({anchorMenuOpen:!this.data.anchorMenuOpen,roomMenuOpen:false,companyMenuOpen:false})
  },
  setViewMode(e) {
    const mode=e.currentTarget.dataset.mode
    if(!this.ensureActor() || this.data.loading || !['day','week'].includes(mode) || mode===this.data.viewMode) return
    this.setData({viewMode:mode});return this.load()
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
  toggleRoomMenu() {if(this.ensureActor() && !this.data.loading && this.data.current) this.setData({roomMenuOpen:!this.data.roomMenuOpen,companyMenuOpen:false,anchorMenuOpen:false})},
  closeMenus() {if(this.data.companyMenuOpen || this.data.roomMenuOpen || this.data.anchorMenuOpen) this.setData({companyMenuOpen:false,roomMenuOpen:false,anchorMenuOpen:false})},
  toggleCompanyMenu() {if(this.ensureActor() && !this.data.loading) this.setData({companyMenuOpen:!this.data.companyMenuOpen,roomMenuOpen:false,anchorMenuOpen:false})},
  closeCompanyMenu() {if(this.data.companyMenuOpen) this.setData({companyMenuOpen:false})},
  stopTap() {},
  switchCompany(e) {
    if(!this.ensureActor()) return
    const index=Number(e.currentTarget.dataset.index),company=this.data.companies[index]
    if(!company) return
    wx.setStorageSync('company-'+this.userId,company.id);return this.load()
  },
  selectDay(e) {this.setData({selectedDay:e.detail.value});return this.load()},
  day(e) {this.setData({selectedDay:moveDay(this.data.selectedDay,Number(e.currentTarget.dataset.days)*(this.data.viewMode==='week'?7:1))});return this.load()},
  add(e) {
    if(!this.ensureActor() || !this.data.manage || this.data.loading || !this.data.current) return
    const room=Number(e.currentTarget.dataset.room)
    if(!this.data.rooms.some(item=>item.id===room && item.active)) return
    wx.navigateTo({url:`/pages/editor/index?cid=${this.data.current.id}&room_id=${room}&date=${e.currentTarget.dataset.date || this.data.selectedDay}`})
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
