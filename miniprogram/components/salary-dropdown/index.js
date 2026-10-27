Component({
  properties:{options:{type:Array,value:[]},value:{type:Number,value:0},label:{type:String,value:'请选择薪资'},disabled:{type:Boolean,value:false}},
  data:{open:false},
  observers:{disabled(value){if(value) this.setData({open:false})}},
  methods:{
    toggle(){if(!this.properties.disabled) this.setData({open:!this.data.open})},
    select(e){
      if(this.properties.disabled) return
      const index=Number(e.currentTarget.dataset.index)
      if(!Number.isInteger(index) || !this.properties.options[index]) return
      this.setData({open:false})
      this.triggerEvent('change',{value:index})
    }
  }
})
