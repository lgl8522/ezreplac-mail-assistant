# EZReplac 邮件助手

个人亚马逊客服邮件工作台：翻译买家邮件、按店铺模板生成 3 个双语回复、处理物流状态，并支持中文审核后同步翻译为买家原语言。

## Cloudflare 配置

1. 创建一个 Workers KV namespace，并将其绑定为 `SHOP_TEMPLATES`。它保存店铺模板及接口地址、模型名称；邮件、物流和回复不会写入该 namespace。
2. 将所选模型服务的 API Key 配置为 Worker Secret：`OPENAI_API_KEY`。前端永远不会收到该密钥。
3. 如需启用 17TRACK 自动网页读取，创建一个具有 **Browser Rendering Write** 权限的 Cloudflare API token，并配置：
   - Worker 变量 `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID
   - Worker 密钥 `BROWSER_RUN_API_TOKEN`：上一步创建的 API token
4. 保存变量和密钥后重新部署当前版本。

自动读取失败、超时或未配置 Browser Run 时，页面会自动打开 `https://t.17track.net/zh-cn?nums=单号` 并提示粘贴物流结果；后续分析与回复生成仍可用。

## 自定义模型接口

在网页右上角的“工作台设置”中填写完整的 OpenAI Responses 兼容接口地址和模型名称。默认值为 `https://api.sudorelay.com/v1/responses` 与 `gpt-5.6-luna`。自定义服务会接收买家邮件和物流文本；只使用你信任的服务商，且不要将 API Key 填入网页。

## 隐私与使用方式

- Responses API 请求显式使用 `store: false`。
- 应用不保存邮件、物流轨迹或生成回复；刷新页面后这些内容会丢失。
- 店铺模板通过 KV 持久化。因为未启用密码保护，请勿公开分享部署网址。
