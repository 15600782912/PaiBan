const {toISO,moveDay,beijingParts,duration}=require('./time')

function normalizeDates(values) {
  if(!Array.isArray(values)) throw new Error('请选择目标日期')
  const dates=[...new Set(values)].sort()
  if(!dates.length) throw new Error('请至少选择一个目标日期')
  if(dates.length>60) throw new Error('每批最多生成60场排班')
  dates.forEach(value=>toISO(value,'00:00'))
  return dates
}

function weeklyDates(start,end,weekdays) {
  toISO(start,'00:00');toISO(end,'00:00')
  if(end<start) throw new Error('重复范围结束日期不能早于开始日期')
  const selected=new Set((weekdays || []).map(Number))
  if(!selected.size || [...selected].some(day=>!Number.isInteger(day) || day<0 || day>6)) throw new Error('请至少选择一个有效星期')
  const dates=[]
  for(let day=start;day<=end;day=moveDay(day,1)) {
    if(selected.has(new Date(day+'T00:00:00Z').getUTCDay())) dates.push(day)
    if(dates.length>60) throw new Error('每批最多生成60场排班，请缩小重复范围')
  }
  return normalizeDates(dates)
}

function buildBatchItems(template,dates) {
  const start=beijingParts(template.start_at),end=beijingParts(template.end_at)
  duration(start.date,start.time,end.date,end.time)
  const offset=(Date.parse(end.date+'T00:00:00Z')-Date.parse(start.date+'T00:00:00Z'))/86400000
  return normalizeDates(dates).map(date=>({
    user_id:template.user_id,room_id:template.room_id,note:template.note || '',
    start_at:toISO(date,start.time),end_at:toISO(moveDay(date,offset),end.time)
  }))
}

module.exports={normalizeDates,weeklyDates,buildBatchItems}
