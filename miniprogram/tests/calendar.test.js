const test=require('node:test')
const assert=require('node:assert/strict')
const {buildCalendar,moveMonth,parseRate,formatMoney,parseMinutes,makeDraft,draftPayload}=require('../utils/calendar')

test('calendar is Monday-first, handles leap February and selected/today cells',()=>{
  const cells=buildCalendar('2024-02',{daily_minutes:{'2024-02-29':90},daily_income_fen:{'2024-02-29':12000}},'2024-02-29','2024-02-01',false)
  assert.equal(cells.length,42)
  assert.equal(cells[0].date,'')
  assert.equal(cells[3].date,'2024-02-01')
  assert.equal(cells.filter(c=>c.date).length,29)
  assert.equal(cells.find(c=>c.date==='2024-02-29').selected,true)
  assert.equal(cells.find(c=>c.date==='2024-02-01').today,true)
  assert.equal(cells.find(c=>c.date==='2024-02-29').hoursText,'1.5h')
  assert.equal(cells.find(c=>c.date==='2024-02-29').incomeText,'¥120.00')
  assert.equal(moveMonth('2030-01',-1),'2029-12')
  assert.equal(moveMonth('2029-12',1),'2030-01')
  assert.throws(()=>moveMonth('2000-01',-1),/范围/)
})

test('unpriced and mixed days do not pretend that missing income is zero',()=>{
  const summary={daily_minutes:{'2030-01-01':60},daily_income_fen:{'2030-01-01':0},daily_unpriced_count:{'2030-01-01':1},items:[{daily_minutes:{'2030-01-01':60},hourly_rate_fen:null}]}
  const day=buildCalendar('2030-01',summary,'2030-01-01','2030-01-01',false).find(c=>c.date==='2030-01-01')
  assert.equal(day.incomeText,'待设时薪')
  summary.items.push({daily_minutes:{'2030-01-01':60},hourly_rate_fen:0})
  const mixed=buildCalendar('2030-01',summary,'2030-01-01','2030-01-01',false).find(c=>c.date==='2030-01-01')
  assert.equal(mixed.incomeText,'¥0.00*')
  assert.equal(buildCalendar('2030-01',summary,'','',true).find(c=>c.date==='2030-01-01').incomeText,'****')
})

test('rate parsing converts decimal yuan to fen exactly and accepts zero',()=>{
  assert.equal(parseRate('80.01'),8001)
  assert.equal(parseRate('0'),0)
  assert.equal(parseRate('1.1'),110)
  for(const value of ['', '-1', '1.001','1e2','NaN']) assert.throws(()=>parseRate(value))
  assert.equal(formatMoney(15002),'150.02')
  assert.equal(parseMinutes('1','30'),90)
  assert.equal(parseMinutes('24','0'),1440)
  for(const [h,m] of [['0','0'],['24','1'],['1','60'],['1.5','0']]) assert.throws(()=>parseMinutes(h,m))
})

test('draft defaults preserve zero, and duration entries use a date without timestamps',()=>{
  const draft=makeDraft({hourly_rate_fen:0,duration_minutes:90,note:'正常直播'})
  assert.deepEqual(draft,{rate:'0.00',hours:'1',minutes:'30',note:'正常直播'})
  assert.deepEqual(draftPayload('2030-01-31',draft),{entry_type:'duration',record_date:'2030-01-31',duration_minutes:90,hourly_rate_fen:0,note:'正常直播'})
  assert.equal(makeDraft({hourly_rate_fen:null,duration_minutes:null,note:''}).rate,'')
})
