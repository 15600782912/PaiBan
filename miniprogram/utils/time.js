const OFFSET = 8 * 60 * 60 * 1000
const pad = value => String(value).padStart(2, '0')

function beijingParts(value = new Date()) {
  const shifted = new Date(new Date(value).getTime() + OFFSET)
  if (Number.isNaN(shifted.getTime())) throw new Error('日期无效')
  return { date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth()+1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}` }
}

function toISO(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期无效')
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month-1, day))
  if (year < 2000 || year > 2100 || parsed.toISOString().slice(0,10) !== date) throw new Error('日期无效')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('时间无效')
  return `${date}T${time}:00+08:00`
}

function duration(startDate, startTime, endDate, endTime) {
  const minutes = (Date.parse(toISO(endDate,endTime)) - Date.parse(toISO(startDate,startTime))) / 60000
  if (minutes <= 0) throw new Error('结束时间必须晚于开始时间；跨天请调整结束日期')
  return minutes
}

function moveDay(date, days) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate()+days)
  return value.toISOString().slice(0,10)
}

function weekRange(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const start = moveDay(date, -(weekday+6)%7)
  return {start,end:moveDay(start,7)}
}

function displayInterval(start, end) {
  const a = beijingParts(start), b = beijingParts(end)
  return `${a.date.slice(5)} ${a.time} → ${b.date.slice(5)} ${b.time}`
}

function displayScheduleInterval(start, end) {
  const a=beijingParts(start),b=beijingParts(end)
  const days=(Date.parse(b.date+'T00:00:00Z')-Date.parse(a.date+'T00:00:00Z'))/86400000
  const finish=days===1?`次日${b.time}`:days>1?`${b.time}（+${days}天）`:b.time
  return `${a.date.slice(5).replace('-','.')} ${a.time} - ${finish}`
}

function hours(minutes) { return `${Math.floor(minutes/60)}小时${minutes%60 ? ` ${minutes%60}分` : ''}` }
function monthToday(now) { return beijingParts(now).date.slice(0,7) }
module.exports = {beijingParts,toISO,duration,moveDay,weekRange,displayInterval,displayScheduleInterval,hours,monthToday}
