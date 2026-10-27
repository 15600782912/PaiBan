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
function scheduleView(rooms,items,date,mode,manage,anchor,roomKey,showCancelled) {
  const {weekRange}=require('./time')
  const range=mode==='week'?weekRange(date):{start:date,end:moveDay(date,1)}
  const lo=Date.parse(toISO(range.start,'00:00')),hi=Date.parse(toISO(range.end,'00:00'))
  const scoped=items.filter(row=>Date.parse(row.start_at)<hi && Date.parse(row.end_at)>lo &&
    (anchor==='all' || row.user_id===Number(anchor)) &&
    (roomKey==='all' || (row.room_id==null?'unassigned':'room-'+row.room_id)===roomKey))
  const cancelledCount=scoped.filter(row=>row.status==='cancelled').length
  const groups=[]
  for(let day=range.start;day<range.end;day=moveDay(day,1)) {
    const daily=groupSchedules(rooms,scoped,day,manage).filter(g=>roomKey==='all' || g.key===roomKey)
    for(const group of daily) {
      const cancelled=group.items.filter(row=>row.status==='cancelled').length
      const visible=group.items.filter(row=>showCancelled || row.status!=='cancelled')
      if(!visible.length && (anchor!=='all' || !manage || !group.active)) continue
      groups.push({...group,key:mode==='week'?day+'|'+group.key:group.key,date:day,
        dayLabel:mode==='week'?day:'',items:visible,cancelledCount:cancelled,
        hasConflict:visible.some(row=>row.hasConflict)})
    }
  }
  return {...range,groups,cancelledCount,activeCount:scoped.length-cancelledCount}
}
module.exports={groupSchedules,scheduleView}
