# EZReplac 邮件助手

个人亚马逊客服邮件工作台：翻译买家邮件、按店铺模板生成 3 个双语回复、处理物流状态，并支持中文审核后同步翻译为买家原语言。

## Cloudflare 配置

1. 创建一个 Workers KV namespace，并将其绑定为 `SHOP_TEMPLATES`。它只保存店铺模板；邮件、物流和回复不会写入该 namespace。
2. 将 OpenAI API Key 配置为 Worker Secret：`OPENAI_API_KEY`。前端永远不会收到该密钥。
3. 如需启用 17TRACK 自动网页读取，创建一个最小权限的 Cloudflare API token，并配置以下 Worker Secrets：
   - `CLOUDFLARE_ACCOUNT_ID`
   - `BROWSER_RUN_API_TOKEN`

未配置 Browser Run 时，页面会打开 `https://t.17track.net/zh-cn?nums=单号` 并提示粘贴物流结果；后续分析与回复生成仍可用。

## 隐私与使用方式

- Responses API 请求显式使用 `store: false`。
- 应用不保存邮件、物流轨迹或生成回复；刷新页面后这些内容会丢失。
- 店铺模板通过 KV 持久化。因为未启用密码保护，请勿公开分享部署网址。
