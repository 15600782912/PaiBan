const test=require('node:test')
const assert=require('node:assert/strict')
function mount() {
  let definition
  global.Component=value=>{definition=value}
  const path=require.resolve('../components/salary-dropdown/index')
  delete require.cache[path]
  require(path)
  delete global.Component
  const events=[]
  const instance={data:{open:false},properties:{disabled:false,options:[{label:'请选择薪资'},{label:'常规场（80.00元/小时）'}],value:0},
    setData(value){Object.assign(this.data,value)},triggerEvent(name,detail){events.push({name,detail})}}
  Object.assign(instance,definition.methods)
  return {instance,events,definition}
}
test('salary dropdown opens inline and emits only an explicit selection, then closes',()=>{
  const {instance,events}=mount()
  instance.toggle()
  assert.equal(instance.data.open,true)
  assert.deepEqual(events,[])
  instance.select({currentTarget:{dataset:{index:1}}})
  assert.equal(instance.data.open,false)
  assert.deepEqual(events,[{name:'change',detail:{value:1}}])
})
test('disabled dropdown cannot open or select and disabled observer closes it',()=>{
  const {instance,events,definition}=mount()
  instance.properties.disabled=true
  instance.toggle()
  instance.select({currentTarget:{dataset:{index:1}}})
  assert.equal(instance.data.open,false)
  assert.deepEqual(events,[])
  instance.data.open=true
  definition.observers.disabled.call(instance,true)
  assert.equal(instance.data.open,false)
})
