const {makeDraft,formatMoney,parseRate,parseMinutes} = require('./calendar')
const {toISO} = require('./time')

function salaryOptions(items=[],snapshot=null) {
  const first=snapshot?{kind:'keep',...snapshot,label:'保留原薪资：'+(snapshot.salary_name||'历史时薪')+
    (snapshot.hourly_rate_fen==null?'（待设时薪）':('（'+formatMoney(snapshot.hourly_rate_fen)+'元/小时）'))}:
    {kind:'empty',label:'请选择薪资'}
  return [first,...items.map(item=>({...item,kind:'salary',label:item.name+'（'+formatMoney(item.hourly_rate_fen)+'元/小时）'}))]
}

function makeSalaryDraft(values={},keep=false) {
  return {...makeDraft(values),salary_id:values.salary_id||null,keep_salary:keep}
}

function applySalary(draft,choice) {
  if(choice.kind==='keep') return {...draft,rate:choice.hourly_rate_fen==null?'':formatMoney(choice.hourly_rate_fen),salary_id:choice.salary_id||null,keep_salary:true}
  if(choice.kind==='salary') return {...draft,rate:formatMoney(choice.hourly_rate_fen),salary_id:choice.id,keep_salary:false}
  return {...draft,rate:'',salary_id:null,keep_salary:false}
}

function selectionFields(draft,existing=false) {
  if(existing && draft.keep_salary) return {}
  if(!draft.salary_id) throw new Error('请先添加并选择薪资')
  return {salary_id:draft.salary_id,hourly_rate_fen:parseRate(draft.rate)}
}

function salaryDraftPayload(date,draft,existing=false) {
  toISO(date,'00:00')
  if(draft.note.length>500) throw new Error('备注最多500字')
  return {entry_type:'duration',record_date:date,duration_minutes:parseMinutes(draft.hours,draft.minutes),
    note:draft.note,...selectionFields(draft,existing)}
}

function pickerState(items,draft,snapshot=null) {
  const options=salaryOptions(items,snapshot)
  if(draft.keep_salary && snapshot) return {options,index:0,label:options[0].label}
  if(!draft.salary_id) return {options,index:0,label:'请选择薪资'}
  const index=options.findIndex(option=>option.kind==='salary' && option.id===draft.salary_id)
  let valid=false
  try {valid=index>0 && options[index].hourly_rate_fen===parseRate(draft.rate)} catch(_) {}
  return {options,index:valid?index:0,label:valid?options[index].label:'薪资已变更或删除，请重新选择'}
}

module.exports={salaryOptions,makeSalaryDraft,applySalary,selectionFields,salaryDraftPayload,pickerState}
