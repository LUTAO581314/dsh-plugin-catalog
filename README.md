# dsh-plugin-catalog

在 DSH 的 **插件 → 已安装** 页里，把已安装插件、内置插件配置和实验性插件合成一份可搜索、按分类分组的列表。

- **搜索**：按插件标题、包名、描述、作者、市场关键词和分类名过滤；空格分隔的多个词必须全部命中。
- **按分类分组**：
  - 社区插件按**下载时插件市场的分类**分组。每个插件在**第一次被看到时**记下它当时的分类；同一版本不会被后来的市场改分类覆盖，升级到新版本才按新下载重新记录。可以手动「重新同步分类」。
  - DSH 自带的 `plugins.item` 配置项（子智能体、网页搜索、Agent 循环、终端等）归入**内置**。
  - DSH 随附的 official bundle（包括平常收在「更多」里的实验性组合包）归入**实验性**。
  - 市场索引里没有的第三方插件归入**未分类**。
- 每行右侧保留启用/停用开关（内置配置项没有开关，点开就是配置页）；点行主体打开该插件/配置项的详情页。
- **图标**：内置配置项用官方原语图标（终端 / Agent 循环 / 子智能体 / 网页搜索），其余插件优先用包自带的
  `meta.icon`，没有或读不到时用官方默认插件图，不再用标题首字占位。
- 宽度与插件页其它区块一致（`max-width: 960px`），并与页面一样居中。

## 安装

从 npm 安装（发布后可用）：

```bash
dsh plugin add @lutao581314/dsh-plugin-catalog
```

或直接从 GitHub 安装（无构建步骤）：

```bash
dsh plugin add github:LUTAO581314/dsh-plugin-catalog
```

本地开发时把本仓库链接进 desktop profile：

```bash
dsh plugin --profile desktop add link:<本仓库的本地路径>
```

等 HMR 重新组合（或完全退出并重开 DSH 一次）。打开侧栏 **插件 → 已安装** 即可看到搜索框和分类分组。

卸载：

```bash
dsh plugin remove @lutao581314/dsh-plugin-catalog
```

## 它是怎么嵌进「已安装」页的

插件页把 `plugins.overview` 声明成一个 root 级 list slot，位置就在「已安装」主列表的上方。本插件向它注册一个条目，
并在数据就绪后隐藏页面自带的三个分组，避免出现两份列表：

| 页面自带分组 | 隐藏条件 | 本插件里的替代分组 |
|---|---|---|
| `data-plugin-group="bundles"` | `body[data-dsh-catalog-ready="1"]` | 市场分类 / 未分类 |
| `data-plugin-group="basic"` | `body[data-dsh-catalog-builtins="1"]` | 内置 |
| `data-plugin-group="extensions"` | `body[data-dsh-catalog-experimental="1"]` | 实验性 |

这些 `data-*` 标记只在对应数据源真的拿到内容时才设置：例如 `plugins.item` 还没注册完时不会隐藏
「内置插件配置」，official bundle 读取失败时也不会隐藏「实验性插件」。插件被停用或加载失败时，样式表
随之移除，页面恢复成官方列表。

## 数据与接口

快照存在 `$DSH_HOME/dsh-plugin-catalog/state.json`（默认 `C:\Users\<你>\.dsh\dsh-plugin-catalog\state.json`），
只在第一次写入时创建。宿主半身提供三个路由：

| 路由 | 作用 |
|---|---|
| `GET /dsh-plugin-catalog/state` | 当前快照 |
| `POST /dsh-plugin-catalog/capture` | 记录一批分类（JSON body） |
| `GET /dsh-plugin-catalog/status` | 目录、条目数、更新时间 |

`capture` 的语义：

- `mode: "capture"`（默认）：**首次记录为准**。同版本的插件不会被覆盖；记录里的 `version` 和已记录版本不同时，视为一次新的下载并更新；之前「未收录」的插件后来出现在市场里，也会补上分类。
- `mode: "resync"`：按提交值整体覆盖（界面上的「重新同步分类」）。

快照条目：

```json
{
  "version": 1,
  "updatedAt": 1792600000000,
  "categories": { "usage": { "zh": "用量与计费", "en": "Usage & Billing" } },
  "categoryOrder": ["agi", "ui", "usage"],
  "packages": {
    "dsh-cost-meter": {
      "name": "dsh-cost-meter",
      "listed": true,
      "categoryId": "usage",
      "category": { "zh": "用量与计费", "en": "Usage & Billing" },
      "indexUrl": "https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json",
      "marketTitle": { "zh": "DSH 插件市场", "en": "DSH Plugin Market" },
      "author": "…",
      "keywords": ["cost", "usage"],
      "version": "1.9.15",
      "source": "download",
      "capturedAt": 1792600000000
    }
  }
}
```

`source` 取值：`download`（首次看到）、`backfill`（本功能上线时对已有插件的回填）、`update`（版本变化）、`resync`（手动同步）。

## 为什么分类要找宿主问

浏览器半身通过 `ctx.remote.pluginMarket.search(indexUrl, { text: 包名, sort: { kind: "relevance" } })`
一次查一个已安装插件，从返回的 `metadata.category` 与 `metadata.categories` 里取分类 id / 标题。
索引只由宿主拉取一次（宿主有 10 分钟缓存），所以本插件不会自己下载 7 MB 的索引；
插件市场不可用时，分类沿用上一次记录。

## 测试

```powershell
node test-host.mjs     # 快照合并、路由、原子写、损坏文件
node test-client.mjs   # 分组/搜索、市场抓取、卡片/开关与 overview 注册
```

两个测试都是零依赖的，不需要启动 DSH。

## 兼容性

DSH `0.2.1-rc.2`（在 desktop profile 上验证）。`package.json` 同时声明了 `engines.dsh` 与
`dsh.compatibility.dshReleases`，便于市场判断版本。

## License

MIT
