# 声笺：复用现有 Cloudflare Worker 的 GitHub 部署

部署开关初始为关闭。代码放在独立分支，不修改原 index.html、GitHub Pages 配置或浏览器聊天数据。

## 用户的一次性授权

1. Cloudflare → My Profile → API Tokens → Create Token → Create Custom Token。
2. 名称：shengjian-deploy。权限：Account / Workers Scripts / Edit，以及 Account / Account Settings / Read。Account Resources 只包括已经创建 shengjian-memory Worker 的那个账户；无需 Global API Key，也不使用声笺 ADMIN_TOKEN。
3. 创建后复制令牌，在 GitHub 仓库 Settings → Secrets and variables → Actions → New repository secret 中保存。Name 必须为 CLOUDFLARE_API_TOKEN，Secret 为刚创建的令牌。不要将令牌发进聊天、Issue、PR 或代码。
4. 告知授权已设置。维护者再把 cloudflare/deploy-request.json 的 enabled 改为 true，提交到部署分支以触发部署。添加 Secret 本身不会开启部署。

复制到浏览器地址栏：
Cloudflare 令牌页：https://dash.cloudflare.com/profile/api-tokens
GitHub 密钥页：https://github.com/yilis2716-create/shengjian/settings/secrets/actions

## 部署行为

- 通过 Cloudflare API 自动确定唯一被授权账户；如果多个账户则停止，可用 GitHub Repository Variable CLOUDFLARE_ACCOUNT_ID 指定（不是密钥）。
- 读取现有 Worker 设置，要求已经绑定 MEMORY_DB、设置 ADMIN_TOKEN Secret 和 ALLOWED_ORIGINS 文本变量。缺少则停止，不创建新 Worker / 数据库，不执行 SQL。
- 保留 D1 / 普通变量，使用 keep_bindings: [secret_text] 保留现有 Secrets。不会读取或上传原 Secret 的值，也不会改变定时触发器。
- 上传完整模块，再访问公开 /health 验证服务标识和配置状态。健康检查不等于确认表结构或管理员能登录，后续还需本人输入已有 ADMIN_TOKEN 创建角色测试。
- 本工作流不配置主动推送的加密密钥、设备订阅和 Cron；不调用聊天或语音 API。普通聊天后台生成仍未实现。
- 流程可以在分支 push 后运行，但 disabled 状态下只做测试。未来若合并 main，也支持 GitHub Actions 手动运行和相关目录更新时运行。
- 所有权限由用户在 Cloudflare 与 GitHub 控制；不再需要时可撤销部署令牌。

## 验证

node --check cloudflare/worker.mjs
node --test cloudflare/deploy.test.mjs

部署 API 仅做模拟网络回归；尚未在用户账户实际上传。正式验证需要先完成授权并打开部署开关。脚本不打印绑定正文或令牌。
