class ApiError extends Error {
  constructor(message, code, status) { super(message); this.code=code; this.status=status }
}

function createTransport(platform, config) {
  return function request(path, options = {}) {
    return new Promise((resolve,reject) => {
      const header = {'content-type':'application/json'}
      const token = config.getToken()
      if (token) header.Authorization = `Bearer ${token}`
      if (options.key) header['Idempotency-Key'] = options.key
      platform.request({url:config.baseURL+path, method:options.method || 'GET', data:options.data,
        header, timeout:15000,
        success(response) {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(response.statusCode===204 ? null : response.data); return
          }
          if (response.statusCode===401 && config.onUnauthorized && config.getToken()===token) config.onUnauthorized()
          const detail = response.data && response.data.detail
          const message = Array.isArray(detail) ? detail.map(item=>item.msg).join('；') :
            (detail && detail.message) || (typeof detail==='string' ? detail : '请求失败，请稍后重试')
          reject(new ApiError(message, (detail && detail.code) || 'http', response.statusCode))
        },
        fail() { reject(new ApiError('网络异常，操作结果尚未确认，请保持内容重试', 'network', 0)) }
      })
    })
  }
}

async function saveWithOverlap(payload, submit, confirm) {
  try { return await submit(payload) }
  catch(error) {
    if (error.code !== 'overlap' || !await confirm(error.message)) throw error
    return submit({...payload, confirm_overlap:true})
  }
}

module.exports = {createTransport,saveWithOverlap,ApiError}
