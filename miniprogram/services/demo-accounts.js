const companies=['星河传媒','晨光直播','云帆互娱','青禾文化','拾光传媒']
module.exports=[
  {account:'demo-admin',display_name:'测试用户阿辰',description:'已创建五家公司，可管理公司及排班'},
  ...companies.map((name,index)=>({account:`demo-operator-${index+1}`,display_name:name+'运营',description:'已加入'+name+'，获授权协助排班'})),
  {account:'demo-anchor-lin',display_name:'测试主播小林',description:'已加入五家公司，查看本人的排班'},
  {account:'demo-anchor-xia',display_name:'测试主播小夏',description:'已加入五家公司，查看本人的排班'},
  {account:'demo-new',display_name:'测试新用户',description:'尚未加入公司，可创建公司或填写邀请码加入'}
]
