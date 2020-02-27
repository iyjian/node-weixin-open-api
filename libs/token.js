let store = ''
const fs = require('fs')
const redis = require('redis')

let accessTokenFile, jsticketTokenFile, redisClient // 用来做文件存储的文件名

exports.setFileStore = (sdk) => {
  accessTokenFile = __dirname + `/../tokens/${sdk.appId}.accessToken`
  jsticketTokenFile = __dirname + `/../tokens/${sdk.appId}.jsTicket`

  const tokenFileExists = fs.existsSync(accessTokenFile)
  if (!tokenFileExists) {
    const fh = fs.openSync(accessTokenFile, 'w')
    fs.writeFileSync(fh, JSON.stringify({ expireTime: 0, accessToken: '' }))
    fs.closeSync(fh)
  }

  const jstokenFileExists = fs.existsSync(jsticketTokenFile)
  if (!jstokenFileExists) {
    const fh = fs.openSync(jsticketTokenFile, 'w')
    fs.writeFileSync(fh, JSON.stringify({ expireTime: 0, jsApiTicket: '' }))
    fs.closeSync(fh)
  }

  store = 'file'
}

// redisConfig
// {host: '127.0.0.1', port: 6379}
exports.setRedisStore = (sdk) => {
  store = 'redis'
  // 这里记录下appId
  appId = sdk.appId
  redisClient = redis.createClient(sdk.redisConfig)
  redisClient.get(`expireTimeJS_${appId}`, (error, reply) => {
    if (!reply) {
      redisClient.set(`expireTimeJS_${appId}`, 0)
    }
  })
  redisClient.get(`expireTime_${appId}`, (error, reply) => {
    if (!reply) {
      redisClient.set(`expireTime_${appId}`, 0)
    }
  })
  redisClient.get(`accessToken_${appId}`, (error, reply) => {
    if (!reply) {
      redisClient.set(`accessToken_${appId}`, '')
    }
  })
  redisClient.get(`jsApiTicket_${appId}`, (error, reply) => {
    if (!reply) {
      redisClient.set(`jsApiTicket_${appId}`, '')
    }
  })
}

// 返回格式：{expireTime: 0, accessToken: ''}
exports.getAccessToken = (sdk, cb) => {
  if (store === 'file') {
    // file
    const accessTokenFile = __dirname + `/../tokens/${sdk.appId}.accessToken`
    let fsContent = fs.readFileSync(accessTokenFile).toString()
    fsContent = JSON.parse(fsContent)
    cb(null, fsContent)
  } else {
    // redis
    let accessToken, expireTime
    redisClient.get(`accessToken_${sdk.appId}`, (error, reply) => {
      accessToken = reply || ''
      redisClient.get(`expireTime_${sdk.appId}`, (error, reply) => {
        expireTime = reply || 0
        cb(null, { accessToken, expireTime })
      })
    })
  }
}

// {expireTime: sdk.expireTimeJS, jsApiTicket: sdk.jsApiTicket}
exports.getJSTicket = (sdk, cb) => {
  if (store === 'file') {
    // file
    const jsticketTokenFile = __dirname + `/../tokens/${sdk.appId}.jsTicket`
    let fsContent = fs.readFileSync(jsticketTokenFile).toString()
    fsContent = JSON.parse(fsContent)
    cb(null, fsContent)
  } else {
    // redis
    let expireTime, jsApiTicket
    redisClient.get(`jsApiTicket_${sdk.appId}`, (error, reply) => {
      jsApiTicket = reply
      redisClient.get(`expireTimeJS_${sdk.appId}`, (error, reply) => {
        expireTime = reply
        cb(null, { jsApiTicket, expireTime })
      })
    })
  }
}

exports.setAccessToken = (sdk, accessToken, expireTime) => {
  // 先算一下超时时间
  expireTime = new Date().getTime() + expireTime * 1000 - 5000

  if (store === 'file') {
    // file
    const accessTokenFile = __dirname + `/../tokens/${sdk.appId}.accessToken`
    const fh = fs.openSync(accessTokenFile, 'w')
    fs.writeFileSync(fh, JSON.stringify({ expireTime, accessToken }))
    fs.closeSync(fh)
    return { expireTime, accessToken }
  } else {
    // redis
    redisClient.set(`accessToken_${sdk.appId}`, accessToken)
    redisClient.set(`expireTime_${sdk.appId}`, expireTime)
    return { expireTime, accessToken }
  }
}

// {expireTimeJS: sdk.expireTimeJS, jsApiTicket: sdk.jsApiTicket}
exports.setJSTicket = (sdk, jsApiTicket, expireTime) => {
  // 先算下超时时间
  expireTime = new Date().getTime() + expireTime * 1000 - 5000

  if (store === 'file') {
    // file
    const jsticketTokenFile = __dirname + `/../tokens/${sdk.appId}.jsTicket`
    const fh = fs.openSync(jsticketTokenFile, 'w')
    fs.writeFileSync(fh, JSON.stringify({ expireTime, jsApiTicket }))
    fs.closeSync(fh)
    return { expireTime, jsApiTicket }
  } else {
    // redis
    redisClient.set(`jsApiTicket_${sdk.appId}`, jsApiTicket)
    redisClient.set(`expireTimeJS_${sdk.appId}`, expireTime)
    return { expireTime, jsApiTicket }
  }
}
