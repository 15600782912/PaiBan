const {signedIn,errorMessage}=require('../services/api')
module.exports={
  actorMatches(actor,token=this.actorToken) {
    const user=wx.getStorageSync('user')
    return Boolean(actor && signedIn() && user && user.id===actor && this.userId===actor && wx.getStorageSync('token')===token && this.actorToken===token)
  },
  ensureActor() {if(this.actorMatches(this.userId)) return true;this.clearPrivate();return false},
  prepareActor() {
    if(this.userId && !this.actorMatches(this.userId)) this.clearPrivate()
    if(!signedIn()) {this.clearPrivate();return null}
    const user=wx.getStorageSync('user') || {}
    this.userId=user.id;this.actorToken=wx.getStorageSync('token')
    this.setData({loggedIn:true})
    return {actor:this.userId,token:this.actorToken}
  },
  handleError(error,actor,token,generation) {
    if(generation!=null && generation!==this.generation) return
    if(this.actorMatches(actor,token)) this.setData({error:errorMessage(error)})
    else if(!signedIn() && this.actorToken===token) {this.clearPrivate();this.setData({error:errorMessage(error)})}
  }
}
