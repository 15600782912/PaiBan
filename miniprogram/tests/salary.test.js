const test=require('node:test')
const assert=require('node:assert/strict')
const {salaryOptions,makeSalaryDraft,applySalary,selectionFields,salaryDraftPayload,pickerState}=require('../utils/salary')

const salaries=[{id:7,name:'常规场',hourly_rate_fen:8000},{id:8,name:'短场',hourly_rate_fen:12000}]

test('new entries have an explicit placeholder rather than selecting the first salary',()=>{
  const options=salaryOptions(salaries)
  assert.equal(options[0].kind,'empty')
  assert.match(options[1].label,/常规场.*80.00/)
  assert.throws(()=>selectionFields(makeSalaryDraft()),/选择薪资/)
  const draft=applySalary(makeSalaryDraft({duration_minutes:240,note:'直播'}),options[1])
  assert.deepEqual(selectionFields(draft),{salary_id:7,hourly_rate_fen:8000})
  assert.equal(salaryDraftPayload('2030-01-31',draft).duration_minutes,240)
})

test('historical records keep original snapshots even after salary deletion or repricing',()=>{
  const original={salary_id:7,salary_name:'原常规场',hourly_rate_fen:8000,duration_minutes:240,note:'原备注'}
  const options=salaryOptions([],original)
  const draft=makeSalaryDraft(original,true)
  assert.match(options[0].label,/保留原薪资.*80.00/)
  assert.deepEqual(selectionFields(draft,true),{})
  const body=salaryDraftPayload('2030-01-31',{...draft,hours:'2'},true)
  assert.equal(body.duration_minutes,120)
  assert.equal('hourly_rate_fen' in body,false)
  assert.equal('salary_id' in body,false)
  const selected=applySalary(draft,salaryOptions(salaries)[2])
  assert.deepEqual(selectionFields(selected,true),{salary_id:8,hourly_rate_fen:12000})
})

test('picker detects a deleted or repriced selection and never silently adopts current price',()=>{
  const draft=makeSalaryDraft({salary_id:7,hourly_rate_fen:8000})
  const state=pickerState([{id:7,name:'改价',hourly_rate_fen:9000}],draft)
  assert.match(state.label,/重新选择/)
  assert.equal(draft.rate,'80.00')
  assert.match(pickerState([],draft).label,/重新选择/)
  assert.equal(applySalary(draft,salaryOptions([{id:7,name:'改价',hourly_rate_fen:9000}])[1]).rate,'90.00')
})
