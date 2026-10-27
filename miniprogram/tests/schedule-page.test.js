const test=require('node:test')
const assert=require('node:assert/strict')
function harness(pageName,role='owner',respond) {
  let definition
  const requests=[],links=[],storage={token:'token-1',user:{id:1}}
  global.Page=v=>{definition=v}
  global.wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>{storage[k]=v},removeStorageSync:k=>{delete storage[k]},
    navigateTo:o=>links.push(o.url),switchTab:o=>links.push(o.url),showModal:o=>o.success({confirm:true}),
    request:o=>{requests.push(o);if(respond && respond(o)) return
      const data=o.url.endsWith('/companies')?{items:[{id:1,name:'公司甲',role}]}:o.url.includes('/rooms')?{items:[{id:3,name:'直播间甲',active:true}]}:{items:[]}
      o.success({statusCode:200,data})}}
  for(const p of [`../pages/${pageName}/index`,'../services/api']) delete require.cache[require.resolve(p)]
  require(`../pages/${pageName}/index`)
  return {page:{...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v)}},requests,links,storage}
}
test('schedule defaults today, shows empty room, and prefills room/date when adding',async()=>{
  const {page,links,requests}=harness('schedule')
  await page.load()
  assert.equal(page.data.manage,true)
  assert.equal(page.data.groups[0].name,'直播间甲')
  page.add({currentTarget:{dataset:{room:3}}})
  assert.match(links[0],/cid=1&room_id=3&date=/)
  assert.ok(requests.some(o=>decodeURIComponent(o.url).includes('T00:00:00+08:00')))
})
test('members cannot create or edit schedules or enter room management',async()=>{
  const {page,links}=harness('schedule','member')
  await page.load()
  assert.deepEqual(page.data.groups,[])
  page.add({currentTarget:{dataset:{room:3}}});page.edit({currentTarget:{dataset:{id:4}}});page.manageRooms()
  assert.deepEqual(links,[])
})
test('schedule ignores old-account response and clears menus on hide',async()=>{
  let old
  const {page,storage}=harness('schedule','owner',o=>{if(!old && o.url.endsWith('/companies')) {old=o;return true}})
  const pending=page.load();storage.token='new';storage.user={id:2}
  await page.load();old.success({statusCode:200,data:{items:[{id:9,name:'旧公司',role:'owner'}]}});await pending
  assert.equal(page.data.current.id,1)
  page.toggleCompanyMenu();page.onHide();assert.equal(page.data.companyMenuOpen,false)
})
test('room creation freezes its name/key after timeout and retries without duplication',async()=>{
  let writes=0
  const h=harness('rooms','operator',o=>{if(o.method==='POST') {writes++;if(writes===1) o.fail();else o.success({statusCode:201,data:{id:8}});return true}})
  await h.page.onLoad({cid:'1'})
  h.page.openAdd();h.page.change({detail:{value:'一号直播间'}})
  await h.page.save();assert.equal(h.page.data.uncertain,true)
  h.page.change({detail:{value:'不能覆盖'}});assert.equal(h.page.data.draft,'一号直播间')
  await h.page.retry()
  const posts=h.requests.filter(o=>o.method==='POST')
  assert.equal(posts.length,2)
  assert.equal(posts[0].header['Idempotency-Key'],posts[1].header['Idempotency-Key'])
  assert.deepEqual(posts[0].data,posts[1].data)
})
test('room management blocks members and clears pending form on account switch',async()=>{
  let h=harness('rooms','member');await h.page.onLoad({cid:'1'})
  h.page.openAdd();assert.equal(h.page.data.editorOpen,false)
  h=harness('rooms');await h.page.onLoad({cid:'1'});h.page.openAdd();h.page.change({detail:{value:'旧草稿'}})
  h.storage.token='next';h.storage.user={id:2};await h.page.save()
  assert.equal(h.page.data.editorOpen,false)
  assert.equal(h.page.data.draft,'')
  assert.equal(h.requests.filter(o=>o.method==='POST').length,0)
})

function filterHarness(role='owner') {
  const rooms=[{id:3,name:'直播间甲',active:true},{id:4,name:'空直播间',active:true},{id:5,name:'历史房间',active:false}]
  let rows=[{id:1,room_id:3,room_name:'直播间甲',user_id:1,display_name:'本人',start_at:'2030-01-01T10:00:00+08:00',end_at:'2030-01-01T11:00:00+08:00',status:'active'},
    {id:2,room_id:5,room_name:'历史房间',user_id:1,display_name:'本人',start_at:'2030-01-01T12:00:00+08:00',end_at:'2030-01-01T13:00:00+08:00',status:'active'},
    {id:3,room_id:null,user_id:1,display_name:'本人',start_at:'2030-01-01T14:00:00+08:00',end_at:'2030-01-01T15:00:00+08:00',status:'active'}]
  const h=harness('schedule',role,o=>{
    let data
    if(o.url.endsWith('/companies')) data={items:[{id:1,name:'公司甲',role},{id:2,name:'公司乙',role}]}
    else if(o.url.includes('/rooms')) data={items:rooms}
    else data={items:rows}
    o.success({statusCode:200,data});return true
  })
  h.page.setData({selectedDay:'2030-01-01'})
  return {...h,rooms,setRows(value){rows=value}}
}
const selectRoom=(page,key)=>page.selectRoom({currentTarget:{dataset:{key}}})

test('room filter defaults all and switches locally including empty, archived and unassigned groups',async()=>{
  const {page,requests}=filterHarness();await page.load()
  assert.equal(page.data.roomFilterKey,'all')
  assert.equal(page.data.groups.length,4)
  const count=requests.length
  selectRoom(page,'room-4');assert.equal(page.data.groups.length,1);assert.equal(page.data.groups[0].items.length,0)
  selectRoom(page,'room-5');assert.match(page.data.roomFilterLabel,/已停用/)
  selectRoom(page,'unassigned');assert.equal(page.data.groups[0].name,'待分配直播间')
  selectRoom(page,'all');assert.equal(page.data.groups.length,4)
  assert.equal(requests.length,count)
})

test('room menu is mutually exclusive and external, scroll and hide closing preserves selection',async()=>{
  const {page}=filterHarness();await page.load()
  page.toggleCompanyMenu();page.toggleRoomMenu()
  assert.equal(page.data.companyMenuOpen,false);assert.equal(page.data.roomMenuOpen,true)
  page.toggleCompanyMenu();assert.equal(page.data.roomMenuOpen,false)
  page.toggleRoomMenu();page.closeMenus();assert.equal(page.data.roomMenuOpen,false)
  selectRoom(page,'room-3');page.toggleRoomMenu();page.onPageScroll();assert.equal(page.data.roomMenuOpen,false)
  page.toggleRoomMenu();page.onHide();assert.equal(page.data.roomMenuOpen,false)
  assert.equal(page.data.roomFilterKey,'room-3')
})

test('room selection survives same-company refresh but resets on company switch and disappearance',async()=>{
  const {page,setRows}=filterHarness();await page.load();selectRoom(page,'room-3')
  await page.load();assert.equal(page.data.roomFilterKey,'room-3')
  await page.switchCompany({currentTarget:{dataset:{index:1}}});assert.equal(page.data.roomFilterKey,'all')
  selectRoom(page,'room-5');setRows([]);await page.load()
  assert.equal(page.data.roomFilterKey,'all');assert.equal(page.data.groups.length,2)
  selectRoom(page,'room-3');await page.selectDay({detail:{value:'2030-01-02'}})
  assert.equal(page.data.roomFilterKey,'room-3');assert.equal(page.data.groups[0].items.length,0)
})

test('member options include only own visible groups and account change clears room selection',async()=>{
  const {page,storage,setRows}=filterHarness('member');await page.load()
  assert.equal(page.data.roomOptions.some(option=>option.key==='room-4'),false)
  selectRoom(page,'room-4');assert.equal(page.data.roomFilterKey,'all')
  selectRoom(page,'room-3');setRows([]);await page.selectDay({detail:{value:'2030-01-02'}})
  assert.equal(page.data.roomFilterKey,'all')
  storage.token='new';storage.user={id:2};page.toggleRoomMenu()
  assert.equal(page.data.roomFilterKey,'all');assert.equal(page.data.roomMenuOpen,false)
})

test('cancelled schedule rows collapse by default, preserve room choices and follow filters',async()=>{
  const {page,setRows,requests}=filterHarness()
  setRows([{id:1,room_id:5,room_name:'历史房间',user_id:1,display_name:'本人',start_at:'2030-01-01T10:00:00+08:00',end_at:'2030-01-01T11:00:00+08:00',status:'cancelled'}])
  await page.load()
  assert.equal(page.data.showCancelled,false)
  assert.equal(page.data.activeCount,0)
  assert.equal(page.data.cancelledCount,1)
  assert.equal(page.data.groups.some(group=>group.id===5),false)
  assert.equal(page.data.roomOptions.some(option=>option.key==='room-5'),true)
  const count=requests.length
  page.toggleCancelled();assert.equal(page.data.groups.find(group=>group.id===5).items.length,1)
  assert.equal(requests.length,count)
  selectRoom(page,'room-3');assert.equal(page.data.cancelledCount,0)
  selectRoom(page,'room-5');assert.equal(page.data.groups.length,0);assert.equal(page.data.cancelledCount,1)
  page.toggleCancelled()
  await page.selectDay({detail:{value:'2030-01-02'}})
  assert.equal(page.data.showCancelled,false)
})

test('copy entry is restricted to active visible schedules and preserves the source',async()=>{
  const {page,links}=filterHarness()
  await page.load()
  page.copySchedule({currentTarget:{dataset:{id:1}}})
  assert.match(links[0],/cid=1&copy_from=1/)
  assert.equal(page.allGroups[0].items[0].id,1)
  page.setData({manage:false});page.copySchedule({currentTarget:{dataset:{id:1}}})
  assert.equal(links.length,1)
})
