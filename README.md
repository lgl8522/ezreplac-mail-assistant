# EZReplace 邮件助手

个人亚马逊客服邮件工作台：翻译买家邮件、按店铺模板生成 3 个双语回复、处理物流状态，并支持中文审核后同步翻译为买家原语言。

## Cloudflare 配置

1. 创建一个 Workers KV namespace，并将其绑定为 `SHOP_TEMPLATES`。它保存店铺模板及接口地址、模型名称；邮件、物流和回复不会写入该 namespace。
2. 将所选模型服务的 API Key 配置为 Worker Secret：`OPENAI_API_KEY`。前端永远不会收到该密钥。
3. 如需启用 17TRACK 自动网页读取，创建一个具有 **Browser Rendering Write** 权限的 Cloudflare API token，并配置：
   - Worker 变量 `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID
   - Worker 密钥 `BROWSER_RUN_API_TOKEN`：上一步创建的 API token
4. 创建名为 `ezreplace-mail-history` 的 D1 数据库，按编号顺序在 D1 控制台执行 [`drizzle`](./drizzle) 目录中的迁移 SQL。
5. 在 Cloudflare 构建变量中添加 `HISTORY_DATABASE_ID`，值为该 D1 数据库的 ID。构建时会把数据库绑定为 `HISTORY_DB`。
6. 添加 Worker 密钥 `APP_ACCESS_CODE`，值必须是 4 位数字。登录成功后保持 24 小时；同一 IP 连续输错 5 次会锁定 15 分钟。
7. 保存变量和密钥后重新部署当前版本。

自动读取失败、超时或未配置 Browser Run 时，页面会自动打开 `https://t.17track.net/zh-cn?nums=单号` 并提示粘贴物流结果；后续分析与回复生成仍可用。

## 自定义模型接口

在网页右上角的齿轮按钮中填写完整的 OpenAI Responses 兼容接口地址和模型名称。默认值为 `https://api.sudorelay.com/v1/responses` 与 `gpt-5.6-luna`。自定义服务会接收买家邮件和物流文本；只使用你信任的服务商，且不要将 API Key 填入网页。

## 隐私与使用方式

- Responses API 请求显式使用 `store: false`。
- 点击“复制买家回复”成功后，应用会把当前邮件上下文和最终选中的双语回复写入 D1；不会保存另外两个未选版本。
- 历史记录最多保留 60 天，每次读取或写入时会自动清理更早的数据。
- 店铺模板通过 KV 持久化。应用页面及业务 API 均要求登录，但 4 位数字校验码的强度有限，仍不应公开分享部署网址。
