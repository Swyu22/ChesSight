# 第三方组件清单

本文件记录仓库内直接分发的第三方文件、来源和 SHA-256。自动校验位于 `scripts/check.mjs`。

| 本地文件 | 版本 / 许可 | 来源 | SHA-256 | 状态 |
|---|---|---|---|---|
| `js/vendor/chess.js` | chess.js 1.4.0 / BSD-2-Clause | [npm 发行包](https://www.npmjs.com/package/chess.js/v/1.4.0) 的 `dist/esm/chess.js` | `76c7c34f0e2e9ab076521a5d6fe786a9cce537bb1b6f29d32a9c9970b5b232d2` | 与上游发行物逐字节一致；许可正文位于文件头。 |
| `js/vendor/stockfish-18-lite-single.wasm` | Stockfish.js 18.0.0 / GPL-3.0 | [v18.0.0 release](https://github.com/nmrugg/stockfish.js/releases/tag/v18.0.0) | `a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1` | 与上游 release asset 逐字节一致。 |
| `js/vendor/stockfish-18-lite-single.js` | Stockfish.js 18 系列 / GPL-3.0 | 文件头指向 [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) | `5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391` | **需人工确认来源**：与 v18.0.0 同名 release asset（SHA-256 `2278005057f381491f1c9bb3e44c9f5920b3a00bef9759e33cc6582769a1f1fe`）不一致。不得将本表解读为已完成 Corresponding Source 合规。 |
| `assets/pieces/*.svg`、图标中的马形 | cburnett / CC-BY-SA 3.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces) | 12 个 SVG 的固定哈希见下表并由 `scripts/check.mjs` 强制校验 | 初次审计逐文件比对 Wikimedia cburnett 原文件一致；页面页脚与 README 保留作者、来源及许可链接。 |

### 棋子 SVG 固定 SHA-256

| 文件 | SHA-256 |
|---|---|
| `bB.svg` | `ba67da76ce919addc60ecb8b46801def073dd54149b2c038a2d07a16d904d5e4` |
| `bK.svg` | `025eea92e0ef8eb1fd06b1c58d0d112948f08bf66cea6b5d003659569949b41c` |
| `bN.svg` | `735cc58315b123a56632d4877a6b976c827481fa97bf9a5c8f459ec969bc2549` |
| `bP.svg` | `4413bf7c18a341f9723d97e6f92c985e30b6167b037e80842cea59b7541bb074` |
| `bQ.svg` | `70191a3fbc729ef629661e2419a66ab8024c49277aab8ccae3a5ef61372ab802` |
| `bR.svg` | `6abf617a9e26902e0734d85897c9ca55e29d7be2928142aa21032c38967e34ba` |
| `wB.svg` | `1d7beace24d455c923ee80d27125963eaf0287b956c5576dbf790c97ac0b97eb` |
| `wK.svg` | `56f55c784843b1ac272b8745d740aa2a3e6c585513ef889978916f88e5d0b70b` |
| `wN.svg` | `5486791207156f7ae8b8678187648df45085d726334c2862e73b077dea00641e` |
| `wP.svg` | `cc7de30708dcec8f4d593a89d10893d5f9c063682039a1c441e86c44cf2096db` |
| `wQ.svg` | `b72b864e2a5b6c8f8afb7f260130c10e649ff063f4ef58190c00a35c56364327` |
| `wR.svg` | `4d42ab45afd862c704eb9b35317102d453a7a6b9b71d40f18958c8eadc829e4b` |

## 验证

```bash
npm run check
shasum -a 256 js/vendor/chess.js js/vendor/stockfish-18-lite-single.js js/vendor/stockfish-18-lite-single.wasm
```

## 分发注意事项

- 项目自有源码为 MIT；第三方文件继续受其各自许可约束。
- Stockfish/Stockfish.js 为 GPL-3.0；许可全文保存在 `licenses/GPL-3.0.txt`。发布负责人需要确认本地 JavaScript glue 的精确源码、修改记录、构建方式和 Corresponding Source 交付方式；这是发布阻断型人工确认项，本文件不构成法律意见。
- `js/vendor/chess.js` 文件末尾引用了未随仓库分发的 source map；不影响运行，但调试时会出现缺失映射，后续可补同版本官方 map 或在重新 vendor 时移除声明并更新哈希。
