// let _ = require('lodash')
const crypto = require('crypto')
const http = require('request')
const async = require('async')
const moment = require('moment')
const parseString = require('xml2js').parseString
const axios = require('axios')
const token = require('./libs/token')

module.exports = () => {
  return {
    init: (wxConfig) => {
      const sdk = {
        token: wxConfig.token,
        appId: wxConfig.appId,
        appSecret: wxConfig.appSecret,
        accessToken: '',
        expireTime: 0,
        expireTimeJS: 0,
        jsApiTicket: '',
        domain: wxConfig.domain,
        debug: wxConfig.debug,
        redisConfig: wxConfig.redisConfig
      }

      // let updateToken, getToken

      if (sdk.redisConfig) {
        token.setRedisStore(sdk)
      } else {
        token.setFileStore(sdk)
      }

      // 返回 timeStamp
      const getTimeStamp = () => {
        return moment().format('X')
      }

      // private: 构造nonceStr
      const getNonceStr = () => {
        const $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        const maxPos = $chars.length
        let noceStr = ''
        for (let i = 0; i < 32; i++) {
          noceStr += $chars.charAt(Math.floor(Math.random() * maxPos))
        }
        return noceStr
      }

      // private: 参数签名
      const generateSign = (obj) => {
        const params = Object.keys(obj).sort().map(key => `${key}=` + obj[key])
        return crypto.createHash('sha1').update(params.join('&')).digest('hex')
      }

      // exports.generateSign = generateSign

      // private: 刷新token
      const getAccessToken = (fn) => {
        // 先取一下accessToken
        token.getAccessToken(sdk, async (error, accessToken) => {
          sdk.accessToken = accessToken.accessToken
          sdk.expireTime = accessToken.expireTime
          if (new Date().getTime() > sdk.expireTime) {
            // 如果token超时，或者没有token(expireTime 初始值为0)
            // 则开始获取token
            const url = `${sdk.domain}/cgi-bin/token?grant_type=client_credential&appid=${sdk.appId}&secret=${sdk.appSecret}`
            const response = await axios.get(url)
            if (response.data.errcode) {
              console.error('getAccessToken', response.data)
              fn(response.data.errmsg, null)
            } else {
              const { access_token, expires_in } = response.data
              token.setAccessToken(sdk, access_token, expires_in)
              sdk.accessToken = access_token
              sdk.expireTime = expires_in
              fn(null, sdk.accessToken)
            }
          } else {
            fn(null, sdk.accessToken)
          }
        })
      }

      // get access token的同步版本
      const getAccessTokenSync = () => {
        return new Promise((resolve, reject) => {
          getAccessToken((error, result) => {
            if (error) {
              reject(error)
            } else {
              resolve(result)
            }
          })
        })
      }

      const getJsApiTicket = (fn) => {
        // 先获取一下jsApiTicket
        token.getJSTicket(sdk, (error, jsTicket) => {
          sdk.expireTimeJS = jsTicket.expireTime
          sdk.jsApiTicket = jsTicket.jsApiTicket
          if (new Date().getTime() > sdk.expireTimeJS) {
            // 如果超时了，或者还没刷新过
            async.series([
              getAccessToken,
              (cb) => {
                const url = `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${sdk.accessToken}&type=jsapi`
                http.get(url, { json: true }, (error, response, body) => {
                  if (error) {
                    cb(error, null)
                  } else {
                    if (body.errcode) {
                      // TODO: 核实一下 有没有这个errmsg
                      cb(body.errmsg, null)
                    } else {
                      cb(null, body)
                    }
                  }
                })
              }
            ], (error, result) => {
              if (error) {
                console.log('jsApiTicket Error %s', error)
                fn(error, null)
              } else {
                const jsTicket = token.setJSTicket(sdk, result[1].ticket, result[1].expires_in)
                sdk.jsApiTicket = jsTicket.jsApiTicket
                sdk.expireTimeJS = jsTicket.expireTime
                fn(null, sdk.jsApiTicket)
              }
            })
          } else {
            // 如果没有过期
            fn(null, sdk.jsApiTicket)
          }
        })
      }

      sdk.parseXml = (xmlString, fn) => {
        parseString(xmlString, {
          explicitArray: false
        }, (error, json) => {
          if (error) {
            fn(new Error('xmlParseError'), null)
          } else {
            fn(null, json)
          }
        })
      }

      // 检查签名是否正确
      sdk.checkSign = (signature, timestamp, nonce, fn) => {
        const str = [sdk.token, timestamp, nonce].sort().join('')
        const mySign = crypto.createHash('sha1').update(str).digest('hex')
        if (mySign === signature) {
          fn(null, null)
        } else {
          fn(new Error('signError'), null)
        }
      }

      sdk.text = (from, to, content) => {
        const now = +new Date()
        return `<xml><ToUserName><![CDATA[${to}]]></ToUserName><FromUserName><![CDATA[${from}]]></FromUserName><CreateTime>${now}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content}]]></Content></xml>`
      }

      // 回复图片消息
      // 首先将图片上传到微信服务器
      // type: 图片（image）、语音（voice）、视频（video）和缩略图（thumb）
      // 这里直接返回了需要返回给用户的xml结构
      sdk.media = (from, to, type, fileBuffer, fn) => {
        async.auto({
          getAccessToken,
          upload: ['getAccessToken', (results, cb) => {
            const url = `${wxConfig.domain}/cgi-bin/media/upload?access_token=${sdk.accessToken}&type=${type}`
            const r = http.post(url, {
              json: true
            }, (error, response, body) => {
              if (error) {
                console.log(error)
                cb(error, null)
              } else if (body.errcode) {
                console.log(body.errmsg)
                cb(body.errmsg, null)
              } else {
                cb(null, body)
              }
            })
            r.form().append('file', fileBuffer, {
              filename: 'myFile.png',
              contentType: 'image/png'
            })
          }]
        }, (error, result) => {
          const now = +new Date()
          if (error) {
            console.log('send media error:')
            console.log('accesstoken: %s expireTime: %s', sdk.accessToken, sdk.expireTime)
            fn(null, `<xml><ToUserName><![CDATA[${to}]]></ToUserName><FromUserName><![CDATA[${from}]]></FromUserName><CreateTime>${now}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[获取失败，请重试！]]></Content></xml>`)
          } else {
            // console.log(result.upload)
            const mediaInfo = `<Image><MediaId><![CDATA[${result.upload.media_id}]]></MediaId></Image>`
            fn(null, `<xml><ToUserName><![CDATA[${to}]]></ToUserName><FromUserName><![CDATA[${from}]]></FromUserName><CreateTime>${now}</CreateTime><MsgType><![CDATA[${type}]]></MsgType>${mediaInfo}</xml>`)
          }
        })
      }

      sdk.oAuth = (code, fn) => {
        http.get(`${wxConfig.domain}/sns/oauth2/access_token`, {
          qs: {
            appid: sdk.appId,
            secret: sdk.appSecret,
            code,
            grant_type: 'authorization_code'
          },
          json: true
        }, (error, response, body) => {
          if (error) {
            fn(error, null)
          } else {
            if (body.errcode) {
              fn(body.errcode, null)
            } else {
              fn(null, body.openid)
            }
          }
        })
      }

      // 获取已创建标签

      // {
      //   "tags":[
      //   {
      //     "id":1,
      //     "name":"每天一罐可乐星人",
      //     "count":0
      //   },
      //   {
      //     "id":2,
      //     "name":"星标组",
      //     "count":0
      //   },
      //   {
      //     "id":127,
      //     "name":"广东",
      //     "count":5
      //   }
      // ]
      // }
      sdk.getTags = async () => {
        try {
          await getAccessTokenSync()
        } catch (e) {
          //
        }
        return axios.get(`https://api.weixin.qq.com/cgi-bin/tags/get?access_token=${sdk.accessToken}`)
      }

      // 批量为用户打标签
      // 一次最多为50个openIds打标签
      sdk.addTag = async (openid_list, tagid) => {
        try {
          await getAccessTokenSync()
        } catch (e) {
          //
        }
        const url = `https://api.weixin.qq.com/cgi-bin/tags/members/batchtagging?access_token=${sdk.accessToken}`
        return axios.post(url, {
          openid_list,
          tagid
        })
      }

      // 用户授权 获取SNS信息 需要跳转的方式为 snsapi_userinfo
      sdk.oAuthSNS = (code, fn) => {
        async.auto({
          auth: (cb) => {
            http.get(`${wxConfig.domain}/sns/oauth2/access_token`, {
              qs: {
                appid: sdk.appId,
                secret: sdk.appSecret,
                code,
                grant_type: 'authorization_code'
              },
              json: true
            }, (error, response, body) => {
              if (error) {
                cb(error, null)
              } else {
                if (body.errcode) {
                  cb(body.errcode, null)
                } else {
                  cb(null, body)
                }
              }
            })
          },
          profile: ['auth', (results, cb) => {
            const url = `${wxConfig.domain}/sns/userinfo?access_token=${results.auth.access_token}&openid=${results.auth.openid}&lang=zh_CN`
            http.get(url, {
              json: true
            }, (error, response, body) => {
              if (error) {
                cb(error, {})
              } else {
                if (body.errcode) {
                  cb(body.errmsg, {})
                } else {
                  cb(null, body)
                }
              }
            })
          }]
        }, (error, result) => {
          fn(error, result.profile)
        })
      }

      sdk.getConfigParams = (url, debug, jsApiList, cb) => {
        const appId = sdk.appId
        const noncestr = getNonceStr()
        const timestamp = getTimeStamp()
        getJsApiTicket((error, jsapi_ticket) => {
          const signature = generateSign({ jsapi_ticket, noncestr, timestamp, url })
          cb(error, {
            debug,
            appId,
            timestamp,
            nonceStr: noncestr,
            signature,
            jsApiList
          })
        })
      }

      // 创建菜单
      sdk.createMenu = (menuConfig, fn) => {
        async.auto({
          getAccessToken,
          createMenu: ['getAccessToken', (dummy, cb) => {
            const url = `${wxConfig.domain}/cgi-bin/menu/create?access_token=${sdk.accessToken}`
            http.post(url, { json: true, form: menuConfig }, (error, response, body) => {
              if (error) {
                cb(error, null)
              } else {
                if (body.errcode) {
                  cb(body.errmsg, null)
                } else {
                  cb(null, null)
                }
              }
            })
          }]
        }, fn)
      }

      /**
       * https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Service_Center_messages.html
       * 中搜索 客服接口-发消息
       * 
       * 发送文字消息
         {
            "touser":"OPENID",
            "msgtype":"text",
            "text":
            {
              "content":"Hello World"
            }
          }

          中间可以插入小程序链接（其中href中指定的链接是在客户端不支持小程序的时候使用的跳转页面）
          <a href="http://www.qq.com"
             data-miniprogram-appid="appid"
            data-miniprogram-path="pages/index/index">
            点击跳小程序
          </a>

          发送小程序卡片
          {
            "touser":"OPENID",
            "msgtype":"miniprogrampage",
            "miniprogrampage":
            {
              "title":"title",
              "appid":"appid",
              "pagepath":"pagepath",
              "thumb_media_id":"thumb_media_id"
            }
          }          
       */
      sdk.sendKfMsg = (form, fn) => {
        async.auto({
          getAccessToken,
          delMenu: ['getAccessToken', (dummy, cb) => {
            const url = `${wxConfig.domain}/cgi-bin/message/custom/send?access_token=${sdk.accessToken}`
            http.post(url, { json: form }, (error, response, body) => {
              if (error) {
                cb(error, null)
              } else {
                if (body.errcode) {
                  cb(body.errmsg, null)
                } else {
                  cb(null, null)
                }
              }
            })
          }]
        }, fn)
      }

      // 删除菜单
      sdk.delMenu = (fn) => {
        async.auto({
          getAccessToken,
          delMenu: ['getAccessToken', (dummy, cb) => {
            const url = `${wxConfig.domain}/cgi-bin/menu/delete?access_token=${sdk.accessToken}`
            http.post(url, { json: true }, (error, response, body) => {
              if (error) {
                cb(error, null)
              } else {
                if (body.errcode) {
                  cb(body.errmsg, null)
                } else {
                  cb(null, null)
                }
              }
            })
          }]
        }, fn)
      }

      // 根据openId获取用户信息（这个是获取关注过公众号的用户的Profile）
      sdk.getProfile = (openId, fn) => {
        async.auto({
          getAccessToken,
          profile: ['getAccessToken', (dummy, cb) => {
            const url = `${wxConfig.domain}/cgi-bin/user/info?access_token=${sdk.accessToken}&openid=${openId}&lang=zh_CN`
            http.post(url, {
              json: true
            }, (error, response, body) => {
              if (error) {
                cb(error, {})
              } else {
                if (body.errcode) {
                  cb(body.errmsg, {})
                } else {
                  cb(null, body)
                }
              }
            })
          }]
        }, (error, result) => {
          if (error) {
            fn(error, {})
          } else {
            fn(null, result.profile)
          }
        })
      }

      // 获取带参数的二维码，返回一个buffer
      sdk.getMPQRCode = (sceneId, fn) => {
        async.auto({
          getAccessToken,
          ticket: ['getAccessToken', (dummy, cb) => {
            const url = `${wxConfig.domain}/cgi-bin/qrcode/create?access_token=${sdk.accessToken}`
            http.post(url, {
              json: {
                action_name: 'QR_LIMIT_STR_SCENE',
                action_info: {
                  scene: {
                    scene_str: sceneId
                  }
                }
              }
            }, (error, response, body) => {
              if (error) {
                cb(error, null)
              } else {
                if (body.errcode) {
                  cb(body.errmsg, null)
                } else {
                  console.log(encodeURIComponent(body.ticket))
                  console.log((body.ticket))
                  cb(null, body.ticket)
                }
              }
            })
          }],
          qrCode: ['ticket', (results, cb) => {
            // 注意：这个地方不要傻逼呵呵的用${wxConfig.domain} 这个是mp.weixin.qq.com 再说一遍，这个是 mp.weixin.qq.com
            const url = `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${results.ticket}`
            console.log(url)
            http.get(url, {
              encoding: null
            }, (error, response, body) => {
              if (error) {
                cb(error, null)
              } else {
                if (body.errcode) {
                  cb(body.errmsg, null)
                } else {
                  cb(null, body)
                }
              }
            })
          }]
        }, (error, result) => {
          if (error) {
            // 如果报错，则生成一个空数组
            fn(error, [])
          } else {
            fn(null, result.qrCode)
          }
        })
      }
      
      // 发送客服消息(模板消息）
      // to: 发给谁？ openId
      // templateId: 客服模板编号
      // link: 点击模板后到达的页面
      // customData: 在指定模板中自定义的消息
      /**
       * 发送模板消息
       * to
       * templateId
       * link
       * customData
       * miniprogram {appid: 'wxe54fe812586edb10', path: ''}
       * fn
       */
      sdk.sendTemplateMsg = (to, templateId, link, customData, miniprogram, fn) => {
        if (typeof miniprogram === 'function') {
          fn = miniprogram
        }
        async.auto({
          getAccessToken,
          send: ['getAccessToken', (dummy, cb) => {
            const url = `${wxConfig.domain}/cgi-bin/message/template/send?access_token=${sdk.accessToken}`
            http.post(url, {
              json: {
                touser: to,
                template_id: templateId,
                url: link,
                data: customData,
                miniprogram
              }
            }, (error, response, body) => {
              if (error) {
                console.error(`sendTemplateMsg`, 'accessToken:', sdk.accessToken, 'accessToken', sdk.expireTime)
                cb(error, null)
              } else {
                if (body.errcode) {
                  cb(body.errmsg, null)
                } else {
                  cb(null, null)
                }
              }
            })
          }]
        }, fn)
      }

      // 静默授权
      // 静默授权后,session中自然会带openId
      sdk.auth = (req, res, next) => {
        const { URL } = require('url')
        if (req.session.openId) {
          next()
        } else {
          const { code } = req.query
          if (code) {
            sdk.oAuth(code, async (error, result) => {
              if (!error) {
                req.session.openId = result
                next()
              } else {
                const originUrl = new URL(`${req.protocol}://${req.hostname}${req.originalUrl}`)
                originUrl.searchParams.delete('code')
                const searchParams = originUrl.searchParams.toString()
                const url = encodeURIComponent(`${originUrl.origin}${originUrl.pathname}?${searchParams}`)
                res.redirect(`https://open.weixin.qq.com/connect/oauth2/authorize?appid=${wxConfig.appId}&redirect_uri=${url}&response_type=code&scope=snsapi_base&state=rta#wechat_redirect`)
              }
            })
          } else {
            const url = encodeURIComponent(`${req.protocol}://${req.hostname}${req.originalUrl}`)
            res.redirect(`https://open.weixin.qq.com/connect/oauth2/authorize?appid=${wxConfig.appId}&redirect_uri=${url}&response_type=code&scope=snsapi_base&state=rta#wechat_redirect`)
          }
        }
      }

      // 带信息的授权
      sdk.snsAuth = (req, res, next) => {
        const { URL } = require('url')
        const { code } = req.query
        if (req.session.headImageUrl) {
          // 如果session中已经加载过headImageUrl表示已经做个SNA授权
          next()
        } else {
          if (code) {
            sdk.oAuthSNS(code, (error, result) => {
              if (!error) {
                req.session.openId = result.openid
                req.session.nickName = result.nickname
                req.session.sex = result.sex === 2 ? 0 : result.sex
                req.session.headImageUrl = result.headimgurl
                req.session.wxProfile = result
                next()
              } else {
                const originUrl = new URL('http://' + req.hostname + req.originalUrl)
                originUrl.searchParams.delete('code')
                const searchParams = originUrl.searchParams.toString()
                const url = `${originUrl.origin}${originUrl.pathname}?${searchParams}`
                res.redirect(`https://open.weixin.qq.com/connect/oauth2/authorize?appid=${wxConfig.appId}&redirect_uri=${url}&response_type=code&scope=snsapi_userinfo&state=rta#wechat_redirect`)
              }
            })
          } else {
            const url = `http://${req.hostname}${req.originalUrl}`
            res.redirect(`https://open.weixin.qq.com/connect/oauth2/authorize?appid=${wxConfig.appId}&redirect_uri=${url}&response_type=code&scope=snsapi_userinfo&state=rta#wechat_redirect`)
          }
        }
      }
      // 仅仅在第一次接入的时候有用，以后用不上了
      sdk.verifyEcho = (req, res) => {
        const { signature, timestamp, nonce, echostr } = req.query

        sdk.checkSign(signature, timestamp, nonce, (error) => {
          if (error) {
            res.send('error')
          } else {
            if (echostr === null) {
              res.send('error')
            } else {
              res.send(echostr)
            }
          }
        })
      }
      return sdk
    }
  }
}
