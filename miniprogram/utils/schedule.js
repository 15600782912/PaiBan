const {toISO,moveDay,beijingParts,hours}=require('./time')
function groupSchedules(rooms,items,date,manage) {
  const lo=Date.parse(toISO(date,'00:00')),hi=Date.parse(toISO(moveDay(date,1),'00:00'))
  const groups=rooms.filter(room=>manage && room.active).map(room=>({...room,key:'room-'+room.id,items:[],hasConflict:false}))
  const byId=new Map(groups.map(room=>[room.id,room]))
  for(const row of items) {
    const start=Date.parse(row.start_at),end=Date.parse(row.end_at)
    if(start>=hi || end<=lo) continue
    const roomId=row.room_id==null?null:row.room_id
    let group=byId.get(roomId)
    if(!group) {
      const room=rooms.find(room=>room.id===roomId)
      group={id:roomId,key:roomId==null?'unassigned':'room-'+roomId,name:room?room.name:(row.room_name || '待分配直播间'),active:room?room.active:Boolean(row.room_active),items:[],hasConflict:false}
      byId.set(roomId,group);groups.push(group)
    }
    const a=Math.max(start,lo),b=Math.min(end,hi),dayMinutes=(b-a)/60000
    const finish=b===hi?'24:00':beijingParts(b).time
    const carry=[start<lo?'承接前日':'',end>hi?'延续至次日':''].filter(Boolean).join(' · ')
    const hasConflict=row.status==='active' && Boolean(row.has_room_conflict || row.has_anchor_conflict || row.has_conflict)
    group.items.push({...row,interval:beijingParts(a).time+' - '+finish,dayMinutes,duration:hours(dayMinutes),carry,hasConflict})
    group.hasConflict=group.hasConflict || hasConflict
  }
  for(const group of groups) group.items.sort((a,b)=>Date.parse(a.start_at)-Date.parse(b.start_at) || a.id-b.id)
  return groups
}
module.exports={groupSchedules}
