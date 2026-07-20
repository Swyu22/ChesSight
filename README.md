# ChesSight · 国际象棋攻防可视化训练器

把双方的"控制格"火力版图与每个棋子的安全状态实时画在棋盘上的纯前端训练工具，帮助训练控制格意识、子力安全意识与复盘习惯。

**在线使用：<https://swyu22.github.io/ChesSight/>**

## 功能

- **完整规则走子**（chess.js）：王车易位、吃过路兵、升变（自动升后）、将军 / 将杀 / 逼和检测，Chess.com 式点击走子与落点提示
- **攻击范围覆盖层**：蓝 = 仅白方控制、红 = 仅黑方控制、紫 = 双方均控制
  - 口径为**几何控制**：兵只算斜吃方向（不含直进格）、滑子止于首个阻挡格且含该格、被牵制的子照常计入、含对己方子的保护
- **子力安全标记**（红 > 绿 > 黄优先级）：红框 = 被攻击、绿框 = 未被攻击且有保护、黄框 = 未被攻击且无保护（潜在弱点）；王只在被将军时标红
- **回放训练**：上一步 / 下一步（回退中走新着法则截断重做栈），每步后可视化全量重算
- 两个可视化总开关，默认全开；全关即退化为普通对弈盘

## 训练场景

| 场景 | 用法 |
|---|---|
| 左右互搏 | 自己走双方棋，观察每步后控制区变化 |
| 逐步复盘 | 走完一段后用上一步 / 下一步回放，寻找悬子出现的时刻 |
| 数子训练 | 关闭覆盖层，心算某格攻击者 / 保护者数量，再开启验证 |

## 本地运行

纯静态站点，零构建。因使用 ES Modules 需通过本地服务器访问：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

摆题钩子：浏览器控制台执行 `app.loadFen('<FEN>')` 可载入任意局面。

## 素材与许可

- 棋子图形：**cburnett** 棋子集，作者 Colin M.L. Burnett（Cburnett），[CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)，来自 [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces)
- 规则引擎：[chess.js](https://github.com/jhlywa/chess.js) v1.4.0（BSD-2-Clause），vendor 于 `js/vendor/chess.js`（许可证声明含于文件内），完全离线可用
- 本项目代码：MIT
