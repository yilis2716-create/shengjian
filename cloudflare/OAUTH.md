# ChatGPT 私人插件接入（后台 1.1.0）

原来的声笺 REST API 与 Kelivo `/mcp/<角色ID>` Bearer 接口继续使用。
ChatGPT 使用新地址 `https://shengjian-memory.yilis2716.workers.dev/mcp`。
此地址仅接受 OAuth 访问凭证，不接受管理员密钥或原角色密钥。

插件使用公开 OAuth 客户端 + 动态注册（DCR），必须使用 S256 PKCE。
授权页由同一个 Worker 提供：用户在网页表单填写已有角色 ID 与角色密钥，
选择授权后才返回一次性授权码给 ChatGPT。密钥不会进入插件包、聊天或重定向 URL。
不需要新 Cloudflare Secret，不需要创建新数据库或更换密钥。

后台首次使用 OAuth 路由时，自动以 `CREATE TABLE IF NOT EXISTS` 添加 oauth_clients、
oauth_codes、oauth_sessions、oauth_used、oauth_limits 表和两个索引；不改写现有角色或记忆。
数据库只保存角色密钥快照的哈希与 OAuth 凭证的哈希。
访问凭证有效期一小时；刷新凭证轮换，授权最多 30 天；重复使用已轮换的刷新凭证会撤销此授权。
代码五分钟过期且原子单次兑换；授权页十分钟过期，签名上下文 + HttpOnly SameSite cookie 防 CSRF。
回调仅允许 ChatGPT 官方 HTTPS 回调（稳定回调或 connector/oauth/<id>），不做任意 URL 抓取。
不支持匿名记忆访问、不支持客户端凭据模式、不支持工具参数指定其他角色。

OAuth 工具有 memory_search、memory_save 和只读 memory_profile。
只读授权不会列出保存工具，直接尝试调用也会被拒绝。
metadata 的 resource 固定为本服务的完整 `/mcp` 地址，交换和刷新时必须一致。

撤销连接：打开 `https://shengjian-memory.yilis2716.workers.dev/oauth/connections`，
使用角色 ID 和角色密钥撤销此角色所有 OAuth 连接。也可从 ChatGPT 连接设置断开。
更换角色密钥会使该角色全部旧 OAuth 凭证与旧角色密钥同时失效。
只撤销 OAuth 不影响声笺或 Kelivo 的原角色密钥。

运行 `python3 build.py` 生成完整单文件 Worker。
测试：`node oauth-test.mjs` 使用真实 SQLite 模拟 D1 batch 原子事务，测试完整授权、
读写与角色权限、一次性/并发兑换、刷新重放、过期、撤销、CSRF、限流与旧接口。
`oauth-smoke.mjs` 是部署后的公开端点验证，不读取真实用户记忆或密钥。

插件创建不等于用户已经授权；必须在 ChatGPT 连接页面由用户完成授权，再测试实际工具可用性。
