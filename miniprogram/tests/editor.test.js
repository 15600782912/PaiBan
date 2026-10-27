const test=require('node:test')
const assert=require('node:assert/strict')
const activeRoom={id:3,company_id:1,name:'一号直播间',active:true}
function harness({write,rooms=[activeRoom],members=[{user_id:1,display_name:'管理员'}],row=null}={}) {
  let definition
  const requests=[],writes=[],navigation=[]
  global.Page=value=>{definition=value}
  global.wx={getStorageSync:key=>key==='token'?'token':{id:1},request(o){
    requests.push(o)
    if(o.method==='POST'||o.method==='PUT') {writes.push(o);if(write) write(o);else o.success({statusCode:201,data:{id:10}})}
    else if(o.url.endsWith('/companies')) o.success({statusCode:200,data:{items:[{id:1,role:'owner'}]}})
    else if(o.url.endsWith('/members')) o.success({statusCode:200,data:{items:members}})
    else if(o.url.endsWith('/rooms')) o.success({statusCode:200,data:{items:rooms}})
    else if(o.url.endsWith('/schedules')) o.success({statusCode:200,data:{items:row?[row]:[]}})
    else throw new Error('Unexpected request '+o.url)
  },showModal:o=>o.success({confirm:true}),navigateBack:()=>navigation.push('back'),switchTab:o=>navigation.push(o.url),enableAlertBeforeUnload:()=>{},disableAlertBeforeUnload:()=>{}}
  global.getCurrentPages=()=>[{},{}]
  for(const p of ['../pages/editor/index','../services/api']) delete require.cache[require.resolve(p)]
  require('../pages/editor/index')
  return {requests,writes,navigation,editor:{...definition,data:structuredClone(definition.data),setData(values){Object.assign(this.data,values)}}}
}
function select(editor) {editor.memberChange({detail:{value:1}});editor.roomChange({detail:{value:1}})}
function historical(values={}) {return {id:8,user_id:1,display_name:'管理员',room_id:3,room_name:'一号直播间',room_active:true,version:1,status:'active',start_at:'2030-01-01T12:00:00+08:00',end_at:'2030-01-01T13:00:00+08:00',note:'历史直播',...values}}

test('new schedule requires explicit member and active room choices',async()=>{
  const {editor,writes}=harness();await editor.onLoad({cid:'1'})
  assert.equal(editor.data.memberIndex,-1);assert.equal(editor.data.roomIndex,-1)
  await editor.save();assert.equal(writes.length,0);assert.match(editor.data.error,/选择.*主播/)
  editor.memberChange({detail:{value:1}});await editor.save()
  assert.equal(writes.length,0);assert.match(editor.data.error,/选择.*直播间/)
  editor.roomChange({detail:{value:1}});await editor.save()
  assert.equal(writes[0].data.room_id,3);assert.equal(writes[0].data.user_id,1)
})

test('room and day links prefill without silently selecting a member',async()=>{
  const {editor}=harness();await editor.onLoad({cid:'1',room_id:'3',date:'2030-02-01'})
  assert.equal(editor.data.roomIndex,0);assert.equal(editor.data.memberIndex,-1)
  assert.equal(editor.data.startDate,'2030-02-01');assert.equal(editor.data.endDate,'2030-02-01')
})

test('inactive or unknown prefilled rooms never select the first room',async()=>{
  const {editor}=harness({rooms:[activeRoom,{id:4,name:'已停用',active:false}]})
  await editor.onLoad({cid:'1',room_id:'4'})
  assert.equal(editor.data.roomIndex,-1);assert.equal(editor.data.rooms.length,1)
})

test('invalid selected day is rejected before making API requests',async()=>{
  const {editor,requests}=harness();await editor.onLoad({cid:'1',date:'2030-02-30'})
  assert.equal(editor.data.ready,false);assert.equal(requests.length,0);assert.match(editor.data.error,/日期/)
})

test('uncertain creation freezes member, room, fields and original idempotency key',async()=>{
  let count=0
  const {editor,writes}=harness({write:o=>{if(++count===1)o.fail();else o.success({statusCode:201,data:{id:10}})}})
  await editor.onLoad({cid:'1'});select(editor)
  editor.setData({startDate:'2030-01-31',startTime:'23:30',endDate:'2030-02-01',endTime:'01:00'})
  await editor.save();assert.equal(editor.data.uncertain,true)
  editor.change({currentTarget:{dataset:{field:'note'}},detail:{value:'不可修改'}})
  editor.roomChange({detail:{value:-1}});editor.memberChange({detail:{value:-1}})
  assert.equal(editor.data.note,'');assert.equal(editor.data.roomIndex,0);assert.equal(editor.data.memberIndex,0)
  await editor.save()
  assert.equal(writes[0].header['Idempotency-Key'],writes[1].header['Idempotency-Key']);assert.deepEqual(writes[0].data,writes[1].data)
})

test('reversed and zero duration never submit',async()=>{
  const {editor,writes}=harness();await editor.onLoad({cid:'1'});select(editor)
  editor.setData({startTime:'23:30',endTime:'01:00'});await editor.save();assert.match(editor.data.error,/结束/)
  editor.setData({endTime:'23:30'});await editor.save();assert.equal(writes.length,0)
})

test('departed anchor and unassigned historical room must be selected explicitly',async()=>{
  const {editor}=harness({row:historical({user_id:2,display_name:'已退出主播',room_id:null,room_name:null,room_active:null})})
  await editor.onLoad({cid:'1',id:'8'})
  assert.equal(editor.data.memberIndex,-1);assert.equal(editor.data.roomIndex,-1)
  assert.throws(()=>editor.payload(),/主播已退出/)
  editor.memberChange({detail:{value:1}});assert.throws(()=>editor.payload(),/选择.*直播间/)
  editor.roomChange({detail:{value:1}});assert.equal(editor.payload().room_id,3);assert.equal(editor.payload().version,1)
})

test('inactive historical room is described and must be reassigned',async()=>{
  const {editor}=harness({row:historical({room_id:4,room_name:'旧直播间',room_active:false}),rooms:[activeRoom,{id:4,name:'旧直播间',active:false}]})
  await editor.onLoad({cid:'1',id:'8'})
  assert.equal(editor.data.roomIndex,-1);assert.match(editor.data.roomWarning,/旧直播间.*停用/)
  assert.throws(()=>editor.payload(),/选择.*直播间/)
  editor.roomChange({detail:{value:1}});assert.equal(editor.payload().room_id,3)
})

test('legacy log links remain disabled',async()=>{
  const {editor,requests}=harness();await editor.onLoad({mode:'log',id:'12'})
  assert.equal(editor.data.ready,false);assert.match(editor.data.error,/个人工时.*停用/);assert.equal(requests.length,0)
})

test('old uncertain schedule cannot be retried by a newly signed-in user',async()=>{
  const {editor,writes}=harness({write:o=>o.fail()});await editor.onLoad({cid:'1'});select(editor);await editor.save()
  global.wx.getStorageSync=key=>key==='token'?'new-token':{id:2};await editor.save()
  assert.equal(writes.length,1);assert.equal(editor.data.ready,false);assert.equal(editor.data.uncertain,false)
  assert.deepEqual(editor.data.rooms,[]);assert.equal(editor.data.roomIndex,-1)
})

test('room or anchor conflict is confirmed only once with the same payload and key',async()=>{
  let count=0
  const {editor,writes}=harness({write:o=>{if(++count===1)o.success({statusCode:409,data:{detail:{code:'overlap',message:'主播和直播间重叠'}}});else o.success({statusCode:201,data:{id:10}})}})
  await editor.onLoad({cid:'1'});select(editor);await editor.save()
  assert.equal(writes.length,2);assert.equal(writes[1].data.confirm_overlap,true)
  assert.equal(writes[1].data.room_id,3);assert.equal(writes[0].header['Idempotency-Key'],writes[1].header['Idempotency-Key'])
})

test('standalone editor finishes on the schedule tab',async()=>{
  const {editor,navigation}=harness();global.getCurrentPages=()=>[{}];editor.finish()
  assert.equal(navigation[0],'/pages/schedule/index')
})

test('an empty room list cannot create an unassigned frontend schedule',async()=>{
  const {editor,writes}=harness({rooms:[]});await editor.onLoad({cid:'1'})
  editor.memberChange({detail:{value:1}});await editor.save()
  assert.equal(writes.length,0);assert.match(editor.data.error,/有效.*直播间/)
})

test('cancelled schedules keep their assignment read-only',async()=>{
  const {editor,writes}=harness({row:historical({status:'cancelled'})});await editor.onLoad({cid:'1',id:'8'})
  editor.memberChange({detail:{value:0}});editor.roomChange({detail:{value:0}})
  editor.change({currentTarget:{dataset:{field:'note'}},detail:{value:'不允许修改'}})
  assert.equal(editor.data.memberIndex,0);assert.equal(editor.data.roomIndex,0);assert.equal(editor.data.note,'历史直播')
  await editor.save();assert.equal(writes.length,0)
})

test('room stopped during editing refreshes choices and preserves date and note',async()=>{
  const rooms=[{...activeRoom},{id:4,name:'备用直播间',active:true}]
  const {editor}=harness({rooms,write:o=>{rooms[0].active=false;o.success({statusCode:409,data:{detail:{code:'room_inactive',message:'直播间已停用'}}})}})
  await editor.onLoad({cid:'1'});select(editor);editor.setData({note:'保留备注',startDate:'2030-02-01',endDate:'2030-02-01'})
  await editor.save()
  assert.equal(editor.data.roomIndex,-1);assert.deepEqual(editor.data.rooms.map(r=>r.id),[4]);assert.equal(editor.data.note,'保留备注');assert.equal(editor.data.startDate,'2030-02-01')
  assert.match(editor.data.roomWarning,/重新选择/)
})

test('copy loads an active source as a new draft and preserves overnight span',async()=>{
  const row=historical({start_at:'2030-01-31T23:00:00+08:00',end_at:'2030-02-01T01:00:00+08:00'})
  const {editor,writes}=harness({row});await editor.onLoad({cid:'1',copy_from:'8'})
  assert.equal(editor.data.id,null);assert.equal(editor.data.copyMode,true)
  assert.equal(editor.data.memberIndex,0);assert.equal(editor.data.roomIndex,0)
  assert.equal(editor.data.note,'历史直播')
  assert.equal(editor.data.startTime,'23:00');assert.equal(editor.data.endTime,'01:00')
  await editor.save();assert.equal(writes.length,0);assert.match(editor.data.error,/预览/)
  editor.copyShortcut({currentTarget:{dataset:{kind:'next-week'}}})
  editor.previewBatch()
  assert.equal(editor.data.batchPreviewItems.length,1)
  assert.equal(editor.data.batchPreviewItems[0].start_at,'2030-02-07T23:00:00+08:00')
  assert.equal(editor.data.batchPreviewItems[0].end_at,'2030-02-08T01:00:00+08:00')
  await editor.save();assert.match(writes[0].url,/schedules\/batch$/)
  assert.equal(writes[0].data.items[0].room_id,3)
  assert.equal('version' in writes[0].data.items[0],false)
})

test('cancelled source is not copyable, unavailable source room requires explicit reassignment',async()=>{
  let h=harness({row:historical({status:'cancelled'})});await h.editor.onLoad({cid:'1',copy_from:'8'})
  assert.equal(h.editor.data.ready,false);assert.match(h.editor.data.error,/取消.*复制/)
  h=harness({row:historical({room_id:9,room_name:'停用旧房间',room_active:false})});await h.editor.onLoad({cid:'1',copy_from:'8'})
  h.editor.previewBatch();assert.equal(h.editor.data.batchReady,false);assert.match(h.editor.data.error,/有效.*直播间/)
  h.editor.roomChange({detail:{value:1}});h.editor.previewBatch();assert.equal(h.editor.data.batchReady,true)
})

test('weekly batch previews before saving and form changes invalidate the previous preview',async()=>{
  const {editor,writes}=harness();await editor.onLoad({cid:'1'});select(editor)
  editor.setData({startDate:'2030-01-01',endDate:'2030-01-01'})
  editor.toggleRepeat({detail:{value:true}})
  editor.repeatChange({currentTarget:{dataset:{field:'repeatStart'}},detail:{value:'2030-01-01'}})
  editor.repeatChange({currentTarget:{dataset:{field:'repeatEnd'}},detail:{value:'2030-01-14'}})
  editor.weekdaysChange({detail:{value:['1','3']}})
  await editor.save();assert.equal(writes.length,0)
  editor.previewBatch();assert.equal(editor.data.batchPreviewItems.length,4)
  editor.change({currentTarget:{dataset:{field:'note'}},detail:{value:'新备注'}})
  assert.equal(editor.data.batchReady,false);await editor.save();assert.equal(writes.length,0)
  editor.previewBatch();await editor.save()
  assert.equal(writes[0].data.items.length,4);assert.equal(writes[0].data.items[0].note,'新备注')
})

test('batch timeout freezes preview body and request key, account change discards the draft',async()=>{
  let count=0
  const {editor,writes}=harness({row:historical(),write:o=>{if(++count===1)o.fail();else o.success({statusCode:201,data:{items:[],count:1}})}})
  await editor.onLoad({cid:'1',copy_from:'8'});editor.previewBatch();await editor.save()
  assert.equal(editor.data.uncertain,true)
  editor.copyShortcut({currentTarget:{dataset:{kind:'next-week'}}});editor.toggleRepeat({detail:{value:true}})
  editor.repeatChange({currentTarget:{dataset:{field:'targetDateDraft'}},detail:{value:'2030-01-01'}})
  editor.change({currentTarget:{dataset:{field:'note'}},detail:{value:'不可变更'}})
  assert.equal(editor.data.repeatEnabled,false);assert.equal(editor.data.note,'历史直播')
  await editor.save()
  assert.deepEqual(writes[0].data,writes[1].data);assert.equal(writes[0].header['Idempotency-Key'],writes[1].header['Idempotency-Key'])
  global.wx.getStorageSync=key=>key==='token'?'next':{id:2};await editor.save()
  assert.equal(editor.data.batchReady,false);assert.deepEqual(editor.data.batchPreviewItems,[])
  assert.deepEqual(editor.data.targetDates,[])
})

test('batch conflict confirmation covers the whole request once and declining writes no confirmed batch',async()=>{
  const {editor,writes}=harness({row:historical(),write:o=>o.success({statusCode:409,data:{detail:{code:'overlap',message:'2030-01-01 批次重叠'}}})})
  await editor.onLoad({cid:'1',copy_from:'8'});editor.previewBatch()
  global.wx.showModal=o=>o.success({confirm:false})
  await editor.save();assert.equal(writes.length,1);assert.equal(writes[0].data.confirm_overlap,false)
})

test('invalid copy source is rejected rather than silently creating a normal draft',async()=>{
  for(const value of ['abc','0','-1']) {
    const {editor,requests}=harness();await editor.onLoad({cid:'1',copy_from:value})
    assert.equal(editor.data.ready,false);assert.equal(requests.length,0)
    assert.match(editor.data.error,/复制来源/)
  }
})

test('member, room and target-date edits invalidate a generated batch preview',async()=>{
  const {editor}=harness({row:historical()});await editor.onLoad({cid:'1',copy_from:'8'})
  editor.previewBatch();assert.equal(editor.data.batchReady,true)
  editor.memberChange({detail:{value:1}});assert.equal(editor.data.batchReady,false)
  editor.previewBatch();editor.roomChange({detail:{value:1}});assert.equal(editor.data.batchReady,false)
  editor.previewBatch();editor.repeatChange({currentTarget:{dataset:{field:'targetDateDraft'}},detail:{value:'2030-01-01'}})
  assert.equal(editor.data.batchReady,false)
  editor.addTargetDate();editor.previewBatch();assert.equal(editor.data.batchPreviewItems.length,2)
  editor.removeTargetDate({currentTarget:{dataset:{date:'2030-01-01'}}});assert.equal(editor.data.batchReady,false)
})
