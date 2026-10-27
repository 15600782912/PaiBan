const test=require('node:test')
const assert=require('node:assert/strict')
const {lunarLabel}=require('../utils/lunar')
const {buildCalendar}=require('../utils/calendar')

test('lunar labels handle new year, month ends, leap months and supported boundaries',()=>{
  for(const [date,label] of Object.entries({
    '2000-01-01':'廿五','2024-02-09':'三十','2024-02-10':'正月',
    '2024-02-14':'初五','2024-02-15':'初六','2025-07-25':'闰六月',
    '2025-07-26':'初二','2026-10-24':'十五','2100-12-31':'腊月'
  })) assert.equal(lunarLabel(date),label,date)
})

test('calendar includes lunar labels without changing totals or empty cells',()=>{
  const cells=buildCalendar('2024-02',{daily_minutes:{'2024-02-14':60},daily_income_fen:{'2024-02-14':8000}},'2024-02-14','2024-02-14')
  const day=cells.find(c=>c.date==='2024-02-14')
  assert.equal(day.lunarText,'初五')
  assert.equal(day.hoursText,'1h')
  assert.equal(day.incomeText,'¥80.00')
  assert.ok(day.today && day.selected)
  assert.ok(cells.filter(c=>!c.date).every(c=>c.lunarText===''))
})

test('offline table agrees with ICU throughout the supported Gregorian range',()=>{
  const formatter=new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{timeZone:'UTC',month:'long',day:'numeric'})
  const labels=['','初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十']
  for(let ms=Date.UTC(2000,0,1);ms<=Date.UTC(2100,11,31);ms+=86400000){
    const date=new Date(ms),parts=formatter.formatToParts(date)
    const day=Number(parts.find(p=>p.type==='day').value)
    assert.equal(lunarLabel(date.toISOString().slice(0,10)),day===1?parts.find(p=>p.type==='month').value:labels[day])
  }
  for(const date of ['1999-12-31','2101-01-01','2024-02-30','invalid']) assert.throws(()=>lunarLabel(date))
})
