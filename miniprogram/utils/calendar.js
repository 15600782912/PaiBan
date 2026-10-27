const {toISO,moveDay} = require('./time')
const {lunarLabel} = require('./lunar')

function formatMoney(fen) {
  if(!Number.isSafeInteger(fen) || fen<0) throw new Error('金额无效')
  return `${Math.floor(fen/100)}.${String(fen%100).padStart(2,'0')}`
}

function parseRate(value) {
  const text=String(value).trim()
  if(!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('请输入有效时薪，最多两位小数')
  const [whole,fraction='']=text.split('.')
  const fen=Number(whole)*100+Number(fraction.padEnd(2,'0'))
  if(!Number.isSafeInteger(fen) || fen>100000000) throw new Error('时薪超出范围，最高为100万元/小时')
  return fen
}

function parseMinutes(hours,minutes) {
  const h=String(hours).trim() || '0',m=String(minutes).trim() || '0'
  if(!/^\d+$/.test(h) || !/^\d+$/.test(m) || Number(m)>59) throw new Error('时长请填写整数小时和0–59分钟')
  const total=Number(h)*60+Number(m)
  if(!Number.isSafeInteger(total) || total<1 || total>1440) throw new Error('时长须为1分钟至24小时')
  return total
}

function makeDraft(values={}) {
  const minutes=values.duration_minutes
  return {rate:values.hourly_rate_fen==null?'':formatMoney(values.hourly_rate_fen),
    hours:minutes==null?'':String(Math.floor(minutes/60)),minutes:minutes==null?'0':String(minutes%60),note:values.note||''}
}

function draftPayload(date,draft) {
  toISO(date,'00:00')
  if(draft.note.length>500) throw new Error('备注最多500字')
  return {entry_type:'duration',record_date:date,duration_minutes:parseMinutes(draft.hours,draft.minutes),
    hourly_rate_fen:parseRate(draft.rate),note:draft.note}
}

function moveMonth(month,offset) {
  toISO(`${month}-01`,'00:00')
  const [y,m]=month.split('-').map(Number)
  const next=new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7)
  if(next<'2000-01' || next>'2100-12') throw new Error('月份超出支持范围：2000–2100年')
  return next
}

function compactHours(minutes) {
  if(minutes<60) return `${minutes}m`
  if(minutes%30===0) return `${minutes/60}h`
  return `${Math.floor(minutes/60)}h${minutes%60}m`
}

function buildCalendar(month,summary={},selected='',today='',hidden=false) {
  toISO(`${month}-01`,'00:00')
  const weekday=new Date(`${month}-01T00:00:00Z`).getUTCDay()
  const leading=(weekday+6)%7
  const cells=[]
  const minutes=summary.daily_minutes||{},income=summary.daily_income_fen||{},unpriced=summary.daily_unpriced_count||{}
  const priced={}
  ;(summary.items||[]).forEach(row=>{
    if(row.hourly_rate_fen!=null) Object.keys(row.daily_minutes||{}).forEach(day=>{priced[day]=true})
  })
  for(let index=0;index<42;index++) {
    const date=moveDay(`${month}-01`,index-leading)
    const valid=date.slice(0,7)===month
    const has=valid && Object.prototype.hasOwnProperty.call(minutes,date)
    let amount=''
    if(has) {
      amount=unpriced[date] && !priced[date]?'待设时薪':`¥${formatMoney(income[date]||0)}${unpriced[date]?'*':''}`
      if(hidden) amount='****'
    }
    cells.push({key:index,date:valid?date:'',day:valid?Number(date.slice(8)):0,
      lunarText:valid?lunarLabel(date):'',today:valid&&date===today,selected:valid&&date===selected,hasRecord:has,
      hoursText:has?compactHours(minutes[date]):'',incomeText:amount,unpriced:has&&Boolean(unpriced[date])})
  }
  return cells
}

module.exports={formatMoney,parseRate,parseMinutes,makeDraft,draftPayload,moveMonth,buildCalendar,compactHours}
