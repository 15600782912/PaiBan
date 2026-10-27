const {api,signedIn,newKey,confirm,errorMessage} = require('../../services/api')
const {saveWithOverlap} = require('../../utils/request')
const {beijingParts,toISO,duration,hours,moveDay,displayScheduleInterval} = require('../../utils/time')
const {normalizeDates,weeklyDates,buildBatchItems}=require('../../utils/repeat-schedule')

Page({
  data:{copyMode:false,repeatEnabled:false,repeatStart:'',repeatEnd:'',repeatWeekdays:[],weekdayOptions:[{value:'1',label:'一'},{value:'2',label:'二'},{value:'3',label:'三'},{value:'4',label:'四'},{value:'5',label:'五'},{value:'6',label:'六'},{value:'0',label:'日'}],targetDates:[],targetDateDraft:'',batchReady:false,batchPreviewItems:[],id:null,cid:null,startDate:'',endDate:'',startTime:'19:00',endTime:'21:00',note:'',
    members:[],memberOptions:[{display_name:'请选择主播'}],memberIndex:-1,rooms:[],roomOptions:[{name:'请选择直播间'}],roomIndex:-1,roomWarning:'',version:1,preview:'2小时',validation:'',error:'',loading:false,
    ready:false,busy:false,uncertain:false,stale:false,cancelled:false,removedMemberName:''},
  async onLoad(options) {
    if(options.mode==='log') {this.setData({error:'个人工时功能已停用，请返回排班页查看安排'});return}
    this.actorId=(wx.getStorageSync('user') || {}).id;this.actorToken=wx.getStorageSync('token')
    this.key=newKey()
    this.repeatInitialized=false
    this.copySourceId=options.copy_from?Number(options.copy_from):null
    if(options.copy_from && (!Number.isInteger(this.copySourceId) || this.copySourceId<=0)) {this.setData({error:'无效的复制来源'});return}
    const today=beijingParts().date
    this.initialRoomId=options.room_id?Number(options.room_id):null
    let selectedDate=options.date || today
    try {toISO(selectedDate,'00:00')} catch(e) {this.setData({error:e.message});return}
    this.setData({copyMode:Boolean(this.copySourceId),id:this.copySourceId?null:options.id?Number(options.id):null,
      cid:options.cid?Number(options.cid):null,startDate:selectedDate,endDate:selectedDate,repeatStart:selectedDate,repeatEnd:selectedDate,targetDateDraft:selectedDate,repeatWeekdays:[],targetDates:[]})
    if(!signedIn()) { this.setData({error:'请先在公司页登录'}); return }
    if(!Number.isInteger(this.data.cid) || this.data.cid<=0) {this.setData({error:'请选择公司后编辑排班'});return}
    await this.load()
  },
  ensureActor() {
    const user=wx.getStorageSync('user') || {}
    if(signedIn() && user.id===this.actorId && wx.getStorageSync('token')===this.actorToken) return true
    this.pendingBody=null;this.key=null;this.batchBody=null;this.pendingIsBatch=false;this.copySourceId=null;this.copySourceDate=null;this.repeatInitialized=false
    this.setData({copyMode:false,repeatEnabled:false,repeatStart:'',repeatEnd:'',repeatWeekdays:[],targetDates:[],targetDateDraft:'',batchReady:false,batchPreviewItems:[],startDate:'',endDate:'',ready:false,uncertain:false,busy:false,members:[],memberOptions:[{display_name:'请选择主播'}],memberIndex:-1,rooms:[],roomOptions:[{name:'请选择直播间'}],roomIndex:-1,roomWarning:'',note:'',removedMemberName:'',
      error:'登录状态已变化，请返回排班页重新打开排班'})
    return false
  },
  onShow() { if(this.actorId) this.ensureActor() },
  async load() {
    if(!this.data.cid || !this.ensureActor()) return
    this.invalidateBatch()
    this.setData({loading:true,error:'',ready:false,stale:false})
    try {
      let row
      {
        const [companies,members,roomList]=await Promise.all([api('/companies'),api(`/companies/${this.data.cid}/members`),api(`/companies/${this.data.cid}/rooms`)])
        if(!this.ensureActor()) return
        const company=companies.items.find(item=>item.id===this.data.cid)
        if(!company || company.role==='member') throw new Error('你没有此公司的排班管理权限')
        const rooms=roomList.items.filter(room=>room.active)
        const chosenRoom=this.data.rooms[this.data.roomIndex]
        this.setData({members:members.items,memberOptions:[{display_name:'请选择主播'},...members.items],rooms,roomOptions:[{name:'请选择直播间'},...rooms],roomIndex:rooms.findIndex(room=>room.id===(chosenRoom?chosenRoom.id:this.initialRoomId)),roomWarning:''})
        if(this.data.id || this.copySourceId) {
          const result=await api(`/companies/${this.data.cid}/schedules`)
          if(!this.ensureActor()) return
          row=result.items.find(item=>item.id===(this.data.id || this.copySourceId))
          if(!row) throw new Error('排班不存在')
          if(this.copySourceId && row.status!=='active') throw new Error('已取消的排班不能复制')
          // Preserve departed-member identity instead of silently selecting a different user.
          const index=members.items.findIndex(item=>item.user_id===row.user_id)
          this.setData({memberIndex:index,removedMemberName:index<0?row.display_name:'',
            version:row.version,cancelled:!this.copySourceId && row.status==='cancelled',
            roomIndex:rooms.findIndex(room=>room.id===row.room_id),
            roomWarning:row.room_id==null?'待分配直播间，请明确选择后保存':rooms.some(room=>room.id===row.room_id)?'':`${row.room_name || '原直播间'}已停用或不可用，请重新选择`})
        }
      }
      if(row) {
        const start=beijingParts(row.start_at),end=beijingParts(row.end_at)
        this.copySourceDate=this.copySourceId?start.date:null
        this.setData({startDate:start.date,startTime:start.time,endDate:end.date,endTime:end.time,note:row.note,repeatStart:start.date,repeatEnd:start.date})
        if(this.copySourceId) this.applyCopyDate(moveDay(beijingParts().date,1))
      }
      this.setData({ready:true})
      this.preview()
    } catch(e) { if(this.ensureActor()) this.setData({error:errorMessage(e)}) }
    finally { this.setData({loading:false}) }
  },
  change(e) {
    if(this.data.busy || this.data.uncertain || this.data.cancelled) return
    const field=e.currentTarget.dataset.field
    if(!['startDate','startTime','endDate','endTime','note'].includes(field)) return
    this.invalidateBatch()
    this.setData({[field]:e.detail.value,error:''})
    this.preview()
    if(wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({message:'修改尚未保存，确定离开？'})
  },
  memberChange(e) {
    if(this.data.busy || this.data.uncertain || this.data.cancelled) return
    const index=Number(e.detail.value)-1
    if(Number.isInteger(index) && index>=-1 && index<this.data.members.length) {this.invalidateBatch();this.setData({memberIndex:index,error:''})}
  },
  roomChange(e) {
    if(this.data.busy || this.data.uncertain || this.data.cancelled) return
    const index=Number(e.detail.value)-1
    if(Number.isInteger(index) && index>=-1 && index<this.data.rooms.length) {this.invalidateBatch();this.setData({roomIndex:index,roomWarning:'',error:''})}
  },
  async refreshRooms() {
    this.invalidateBatch()
    this.setData({roomIndex:-1,roomWarning:'直播间已变更，请重新选择；日期、主播和备注已保留'})
    try {
      const result=await api(`/companies/${this.data.cid}/rooms`)
      if(!this.ensureActor()) return
      const rooms=result.items.filter(room=>room.active)
      this.setData({rooms,roomOptions:[{name:'请选择直播间'},...rooms]})
    } catch(e) {if(this.ensureActor()) this.setData({error:errorMessage(e)})}
  },
  preview() {
    try {
      const d=this.data
      this.setData({preview:hours(duration(d.startDate,d.startTime,d.endDate,d.endTime)),validation:''})
    } catch(e) { this.setData({preview:'—',validation:e.message}) }
  },
  payload() {
    const d=this.data
    duration(d.startDate,d.startTime,d.endDate,d.endTime)
    const body={start_at:toISO(d.startDate,d.startTime),end_at:toISO(d.endDate,d.endTime),note:d.note}
    {
      const member=d.members[d.memberIndex]
      if(!member) throw new Error(this.data.removedMemberName?'原主播已退出，请明确选择新主播后再保存；原历史记录不会自动改派':this.data.members.length?'请明确选择要安排的主播':'公司暂无可排班成员')
      const room=d.rooms[d.roomIndex]
      if(!room || !room.active) throw new Error('请选择有效的直播间；如无可用直播间，请返回排班页管理')
      body.user_id=member.user_id
      body.room_id=room.id
      if(d.id) body.version=d.version
    }
    return body
  },
  isBatch() {return !this.data.id && (this.data.copyMode || this.data.repeatEnabled)},
  locked() {return this.data.busy || this.data.uncertain || this.data.cancelled},
  invalidateBatch() {
    if(this.data.uncertain) return
    this.batchBody=null
    this.setData({batchReady:false,batchPreviewItems:[]})
  },
  applyCopyDate(date) {
    toISO(date,'00:00')
    const offset=(Date.parse(this.data.endDate+'T00:00:00Z')-Date.parse(this.data.startDate+'T00:00:00Z'))/86400000
    const end=moveDay(date,offset);toISO(end,'00:00')
    this.invalidateBatch()
    this.setData({startDate:date,endDate:end,targetDates:[date],targetDateDraft:date,repeatStart:date,repeatEnd:date,error:''})
    this.preview()
  },
  copyShortcut(e) {
    if(this.locked() || !this.data.copyMode) return
    try {
      const kind=e.currentTarget.dataset.kind
      if(kind!=='tomorrow' && kind!=='next-week') return
      const target=kind==='tomorrow'?moveDay(beijingParts().date,1):moveDay(this.copySourceDate,7)
      this.applyCopyDate(target)
    } catch(e) {this.setData({error:errorMessage(e)})}
  },
  toggleRepeat(e) {
    if(this.locked() || this.data.id) return
    this.invalidateBatch()
    if(e.detail.value && !this.repeatInitialized) {
      const end=moveDay(this.data.startDate,7)
      this.setData({repeatStart:this.data.startDate,repeatEnd:end>'2100-12-31'?this.data.startDate:end})
      this.repeatInitialized=true
    }
    this.setData({repeatEnabled:Boolean(e.detail.value),error:''})
  },
  repeatChange(e) {
    if(this.locked()) return
    const field=e.currentTarget.dataset.field
    if(!['repeatStart','repeatEnd','targetDateDraft'].includes(field)) return
    this.invalidateBatch();this.setData({[field]:e.detail.value,error:''})
  },
  weekdaysChange(e) {
    if(this.locked()) return
    this.invalidateBatch()
    const values=e.detail.value || []
    this.setData({repeatWeekdays:values,weekdayOptions:this.data.weekdayOptions.map(day=>({...day,checked:values.includes(day.value)})),error:''})
  },
  addTargetDate() {
    if(this.locked()) return
    try {
      const dates=normalizeDates([...this.data.targetDates,this.data.targetDateDraft])
      this.invalidateBatch();this.setData({targetDates:dates,error:''})
    } catch(e) {this.setData({error:errorMessage(e)})}
  },
  removeTargetDate(e) {
    if(this.locked()) return
    const date=e.currentTarget.dataset.date
    this.invalidateBatch();this.setData({targetDates:this.data.targetDates.filter(item=>item!==date),error:''})
  },
  previewBatch() {
    if(!this.ensureActor() || this.locked() || !this.data.ready || !this.isBatch()) return
    this.invalidateBatch()
    try {
      const dates=this.data.repeatEnabled?weeklyDates(this.data.repeatStart,this.data.repeatEnd,this.data.repeatWeekdays):normalizeDates(this.data.targetDates)
      const items=buildBatchItems(this.payload(),dates)
      this.batchBody={items,confirm_overlap:false};this.key=newKey()
      this.setData({batchReady:true,error:'',batchPreviewItems:items.map((item,index)=>({...item,key:index,date:beijingParts(item.start_at).date,interval:displayScheduleInterval(item.start_at,item.end_at)}))})
    } catch(e) {this.setData({error:errorMessage(e)})}
  },
  async save() {
    if(!this.ensureActor()) return
    if(this.data.busy || !this.data.ready || this.data.stale || this.data.cancelled) return
    this.setData({busy:true,error:''})
    try {
      const isBatch=this.data.uncertain?this.pendingIsBatch:this.isBatch()
      if(isBatch && !this.data.uncertain && (!this.data.batchReady || !this.batchBody)) throw new Error('请先预览并确认本批次排班')
      const payload=this.data.uncertain ? this.pendingBody : isBatch?this.batchBody:this.payload()
      this.pendingIsBatch=isBatch
      const d=this.data
      const base=`/companies/${d.cid}/schedules`
      const path=isBatch?`${base}/batch`:d.id?`${base}/${d.id}`:base
      await saveWithOverlap(payload,async body=>{
        this.pendingBody=body
        return api(path,{method:d.id?'PUT':'POST',data:body,key:d.id?undefined:this.key})
      },async message=>await confirm(message) && this.ensureActor())
      if(!this.ensureActor()) return
      this.setData({uncertain:false})
      this.finish()
    } catch(e) {
      if(!this.ensureActor()) return
      const uncertain=e.code==='network' || e.status>=500
      this.setData({error:errorMessage(e),uncertain,stale:e.code==='stale_version'})
      if(['room_inactive','room_unavailable'].includes(e.code)) await this.refreshRooms()
      if(uncertain && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({message:'保存结果未确认，建议留在本页重试。'})
    } finally { this.setData({busy:false}) }
  },
  async remove() {
    if(!this.ensureActor() || this.data.busy || this.data.uncertain || !this.data.ready) return
    if(!await confirm('确定取消这条排班？历史记录会保留。')) return
    if(!this.ensureActor()) return
    this.setData({busy:true,error:''})
    try {
      await api(`/companies/${this.data.cid}/schedules/${this.data.id}/cancel`,{method:'POST',data:{version:this.data.version}})
      if(this.ensureActor()) this.finish()
    } catch(e) { if(this.ensureActor()) this.setData({error:errorMessage(e),stale:e.code==='stale_version'}) }
    finally { this.setData({busy:false}) }
  },
  async reload() {
    if(await confirm('重新载入会覆盖本页尚未保存的修改，是否继续？')) await this.load()
  },
  finish() {
    if(wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
    if(getCurrentPages().length>1) wx.navigateBack()
    else wx.switchTab({url:'/pages/schedule/index'})
  }
})
