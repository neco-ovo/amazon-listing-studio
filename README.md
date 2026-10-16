# Amazon Listing Studio

面向个人卖家的 Amazon 商品图片与 Listing 制作 Skill，以 Codex 为主要运行环境。通过用户资料、参考图、商品链接和可选的 SellerSprite 关键词表，制作真实图片、整理产品事实并生成 Listing 文案。

主流程：**产品资料 → 主图 → 批准并锁定 Product Master → 副图 → Listing → 交付**。

## 能做什么

- 生成并检查主图和副图，复用适用的商家版式、字体与电商模板
- 记录用户确认的事实、缺失信息和冲突，避免把竞品描述直接当作本品事实
- 生成标题、Item Highlights、五要点、描述、后台搜索词、Special Features 和适用商品属性
- 支持 Parent / Child、复合 Variation Theme，以及已有产品增加子体
- 读取 SellerSprite 关键词反查与挖掘 XLSX，保存可复用的关键词分析
- 支持局部图片调整和单字段文案修改，仅检查相关内容与直接依赖
- 对批准的内容生成交付包；按需准备上传工作簿和图片托管请求

图片由当前运行环境的生图能力完成；仓库脚本负责状态、校验、批准和打包。仅运行脚本不会自动生成图片。此项目不提供 WebUI 或 HTTP 服务，也不自动发布商品至 Seller Central。

## 安装

需要 Git、Node.js 20 或更新版本，以及具备图片生成、图片检查和本地文件操作能力的 Codex 环境。

将仓库克隆到 Codex 的个人 Skill 目录下，文件夹命名为 `amazon-listing-studio`。默认目录示例：

```powershell
git clone https://github.com/neco-ovo/amazon-listing-studio.git "$env:USERPROFILE\.codex\skills\amazon-listing-studio"
Set-Location "$env:USERPROFILE\.codex\skills\amazon-listing-studio"
npm ci
```

如果使用自定义 `CODEX_HOME`，请改为其下的 `skills/amazon-listing-studio`。已有同名安装时，先检查其中的本地修改，再更新；不要直接覆盖。重新打开 Codex 对话后使用 `$amazon-listing-studio` 调用。

## 开始一个产品项目

在独立产品目录中工作，输入实际参数、参考素材和目标。示例：

```text
$amazon-listing-studio
为这个新品创建项目。产品为 8 英寸宽 × 12 英寸高的铝制标牌，
竖向、圆角、四角安装孔。参考图用于设计参考，商品链接仅用于市场参考。
先给我主图方案，再根据我选定的方向生成图片。
项目保存到 D:/Amazon/projects/my-sign。
```

默认站点与语言为 Amazon.com / en-US。当前明确的用户事实优先；关键资料缺失或用户确认相互冲突时，Skill 会集中询问。主图和 Product Master 批准后继续副图；批准副图规划后可生成整组图片并集中审阅。

修改时直接说明范围，例如“只修改第二条五要点”或“保持版式，仅修改尺寸标注”。恢复任务时提供产品根目录，从 `project.md` 与 `state.json` 继续。

产品项目应放在 Skill 仓库之外。每个产品使用独立目录，参考资料、图片、文案、状态和交付内容均保存在该目录内。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `SKILL.md` | Skill 入口、流程和按需读取的参考路由 |
| `references/` | 事实、图片、Listing、Variation 与交付说明 |
| `assets/` | 随仓库提供的素材与参考资源 |
| `scripts/studio.js` | 状态操作与工作流命令入口 |
| `scripts/lib/` | 校验和工作流实现 |
| `tests/` | 单元、契约和流程测试 |
| `docs/`、`evals/` | 设计记录与评测资料 |
| `seed.yaml` | 初始需求规格 |

## 验证与维护

```powershell
npm test
npm run validate:skill
```

`npm test` 运行仓库测试；`validate:skill` 检查入口、参考路由和关键文档要求。测试通过不代表某个实际商品已经获得 Amazon 审核批准。

批准后的项目可通过统一入口打包，输出路径需位于产品目录内：

```powershell
node scripts/studio.js finalize --project-dir D:/Amazon/projects/my-sign --output delivery/final
```

详细命令参数和当前阶段要求见 [Skill 入口](SKILL.md) 及其对应参考。上传模板、枚举和条件必填项以当前模板为依据；准备上传时如需公开图片地址，应完成托管和 URL 映射后继续。

更新安装时，确认当前分支及本地修改，再拉取并安装锁定依赖：

```powershell
git pull --ff-only
npm ci
```

新增依赖、字体或参考素材时，应保留适用的来源与许可信息；本仓库说明不替代素材本身的许可条款。
