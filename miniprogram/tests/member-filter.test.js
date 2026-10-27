const test=require('node:test')
const assert=require('node:assert/strict')
const {scheduleView}=require('../utils/schedule')
const rooms=[{id:1,name:'一号',active:true},{id:2,name:'空房间',active:true}]
const rows=[{id:1,user_id:7,room_id:1,start_at:'2030-01-01T23:00:00+08:00',end_at:'2030-01-02T01:00:00+08:00',status:'active',has_room_conflict:true},
  {id:2,user_id:8,room_id:1,start_at:'2030-01-01T12:00:00+08:00',end_at:'2030-01-01T13:00:00+08:00',status:'cancelled'}]
test('weekly view clips midnight rows per day and counts each cancelled record once',()=>{
  const view=scheduleView(rooms,rows,'2030-01-01','week',true,'all','all',false)
  assert.equal(view.start,'2029-12-31');assert.equal(view.end,'2030-01-07')
  assert.equal(view.cancelledCount,1);assert.equal(view.activeCount,1)
  assert.equal(view.groups.filter(g=>g.items.some(r=>r.id===1)).length,2)
  assert.equal(view.groups.find(g=>g.items.length).hasConflict,true)
})
test('anchor and room intersect, hide empty groups and preserve original conflict flags',()=>{
  const view=scheduleView(rooms,rows,'2030-01-01','day',true,7,'all',false)
  assert.equal(view.groups.length,1);assert.equal(view.groups[0].items[0].hasConflict,true)
  assert.equal(view.cancelledCount,0)
  assert.equal(scheduleView(rooms,rows,'2030-01-01','day',true,7,'room-2',false).groups.length,0)
})
