const redis = require('redis')
const { promisify } = require("util")

class Token {
  constructor (sdk) {
    this.sdk = sdk
    this.client = redis.createClient(sdk.redisConfig)
    
    this.hsetAsync = promisify(client.hset).bind(client)
    this.hgetAllAsync = promisify(client.hgetall).bind(client)

    this.accessTokenKey = `accessToken_${this.sdk.appId}`
    this.jsApiTicketKey = `jsApiTicket_${this.sdk.appId}`
  }
  
  async setRedisStore () {
    
    appId = this.sdk.appId

    const accessToken = await this.hgetAllAsync(`accessToken_${appId}`)
    const jsApiTicket = await this.hgetAllAsync(`jsApiTicket_${appId}`)

    if (!accessToken) {
      await this.hsetAsync(this.accessTokenKey, 'accessToken', '')
      await this.hsetAsync(this.accessTokenKey, 'expireTime', '0')
    }

    if (!jsApiTicket) {
      await this.hsetAsync(this.jsApiTicketKey, 'jsApiTicket', '')
      await this.hsetAsync(this.jsApiTicketKey, 'expireTime', '0')
    }
  }
  
  // 返回格式：{expireTime: 0, accessToken: ''}
  async getAccessToken () {
    return this.hgetAllAsync(this.accessTokenKey)
  }

  // {expireTime: sdk.expireTimeJS, jsApiTicket: sdk.jsApiTicket}
  async getJSTicket () {
    return this.hgetAllAsync(this.jsApiTicketKey)
  }

  async setAccessToken (accessToken, expireTime) {
    // 先算一下超时时间
    expireTime = new Date().getTime() + expireTime * 1000 - 5000
    await this.hsetAsync(this.accessTokenKey, 'accessToken', accessToken)
    await this.hsetAsync(this.accessTokenKey, 'expireTime', expireTime)
    return this.getAccessToken()
  }

  // {expireTimeJS: sdk.expireTimeJS, jsApiTicket: sdk.jsApiTicket}
  async setJSTicket (jsApiTicket, expireTime) {
    // 先算下超时时间
    expireTime = new Date().getTime() + expireTime * 1000 - 5000
    await this.hsetAsync(this.jsApiTicketKey, 'jsApiTicket', '')
    await this.hsetAsync(this.jsApiTicketKey, 'expireTime', '0')
    return this.getJSTicket()
  }
}

module.exports = Token
