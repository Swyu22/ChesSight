# ChesSight · 国际象棋攻防可视化训练器

把双方的"控制格"火力版图与每个棋子的安全状态实时画在棋盘上的纯前端训练工具，帮助训练控制格意识、子力安全意识与复盘习惯。

**在线使用：<https://chessight.art>**（备用地址 <https://swyu22.github.io/ChesSight/>）

## 功能

- **完整规则走子**（chess.js）：王车易位、吃过路兵、升变（自动升后）、将军 / 将杀 / 逼和检测，Chess.com 式点击或**拖拽**走子与落点提示
- **攻击范围覆盖层**：蓝 = 仅白方控制、红 = 仅黑方控制、紫 = 双方均控制
  - 口径为**几何控制**：兵只算斜吃方向（不含直进格）、滑子止于首个阻挡格且含该格、被牵制的子照常计入、含对己方子的保护
- **子力安全标记**（红 > 绿 > 黄优先级）：红框 = 被攻击、绿框 = 未被攻击且有保护、黄框 = 未被攻击且无保护（潜在弱点）；王只在被将军时标红
- **回放训练**：上一步 / 下一步（回退中走新着法则截断重做栈），每步后可视化全量重算
- **X-Ray 杀伤线**：每个棋子的攻击射线以虚线箭头持续显示（蓝 = 白方、红 = 黑方），与覆盖层同口径
- **引擎提示**：内置 Stockfish 18（lite NNUE，单线程 WASM，本地加载），💡提示按钮（快捷键 **F1**）给出当前局面最佳走法（文字 + 橙色箭头）；勾选"持续提示"后每步走完自动分析
- **与电脑对弈**：勾选后对方（= 非当前棋盘视角方）由 Stockfish 自动应对，翻转棋盘即交换阵营
- **AI 实时解说**：每步走完自动生成一句中文解说（DeepSeek 经 Cloudflare Worker 以 SSE 流式推送，API Key 藏于 Worker secret）；按走子顺序排队逐条补齐，快速连走也不漏解说，可一键关闭
- **下棋音效**：WebAudio 实时合成（走子/吃子/易位/将军/升变/终局六种，Chess.com 风格木质手感），零采样素材，可一键静音
- **PWA 可安装**：附 `manifest.json` 与应用图标，支持"添加到主屏幕"独立窗口运行
- **自由摆棋**：无限调色板备选框（12 种棋子随取随放、计数徽章显示已移出数量），拖拽摆盘时控制格/安全框/X-Ray 实时刷新；完成时校验局面合法性，行棋方可选、易位权按王车原位自动推断
- **棋盘翻转**：一键切换白方 / 黑方视角，坐标与箭头同步翻转
- **知名开局库**：14 个经典开局一键摆盘（走子记入历史可回放），附每个开局的历史由来与优缺点简介
- 可视化总开关默认全开；全关即退化为普通对弈盘

## 训练场景

| 场景 | 用法 |
|---|---|
| 左右互搏 | 自己走双方棋，观察每步后控制区变化 |
| 逐步复盘 | 走完一段后用上一步 / 下一步回放，寻找悬子出现的时刻 |
| 数子训练 | 关闭覆盖层，心算某格攻击者 / 保护者数量，再开启验证 |

## 本地运行

纯静态站点，零构建。因使用 ES Modules 需通过本地服务器访问。端口用 **8173**（与解说 Worker 的 Origin 白名单 `localhost:8173` 一致，本地才能调用 AI 解说；其余功能与端口无关）：

```bash
python3 -m http.server 8173
# 打开 http://localhost:8173
```

摆题钩子：浏览器控制台执行 `app.loadFen('<FEN>')` 可载入任意局面。

## 素材与许可

- 棋子图形：**cburnett** 棋子集，作者 Colin M.L. Burnett（Cburnett），[CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)，来自 [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces)
- 规则引擎：[chess.js](https://github.com/jhlywa/chess.js) v1.4.0（BSD-2-Clause），vendor 于 `js/vendor/chess.js`（许可证声明含于文件内），完全离线可用
- 分析引擎：[Stockfish.js](https://github.com/nmrugg/stockfish.js) 18（GPLv3，基于 [Stockfish](https://github.com/official-stockfish/Stockfish)），vendor 单线程 lite 构建于 `js/vendor/stockfish-18-lite-single.{js,wasm}`，许可证声明含于 JS 文件头，源码见上述仓库
- 本项目代码：MIT
