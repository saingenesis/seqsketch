# 数据格式 1.1

## 三种文件

| 文件 | 用途 | 坐标 |
| --- | --- | --- |
| `*.dataset.json` | 训练及数据分析，只有最终保留的曲线 | X / 800、Y / 1000 |
| `*.seqsketch.json` | 重新打开与继续编辑，含原始采样点 | 画布坐标 |
| `*.svg` | 矢量预览与交换，每条序列线条一个 path | 画布坐标 |

训练文件不是可编辑工程，不能通过“打开工程”导入。打开相同作品 ID 的旧工程会替换本机该作品的内容；发现本机有较新版本时会提示确认。

导出窗口记住用户填写的文件夹，文件名包含作品名称和作品 ID 的前 8 位。训练数据与 SVG 按模式分别使用 `.curve.dataset.json` / `.stroke.dataset.json` 和 `.curve.svg` / `.stroke.svg`；完整工程使用 `.seqsketch.json`。同一路径下同名文件会更新，完整工程包含保存时的模式。

## 训练 JSON

`schemaVersion` 为 `seqsketch.dataset/1.1`。训练下一条线时，使用 `lines` 数组。`sequenceUnit` 区分两种记录模式：

- `curve`：一段三次贝塞尔曲线是一条线，`lines[i].curves` 只有一个元素。
- `stroke`：一次落笔到抬笔是一条线，`lines[i].curves` 包含这次落笔最终保留的所有段，按原始段内顺序排列。

模式可以切换并随工程保存。切换不会重新拟合曲线、修改曲线 ID 或改变原始落笔信息。旧 1.0 工程导入时默认采用 `curve`。

例如一次落笔产生 A、B 两段，第二次落笔产生 C：曲线模式的训练序列为 `[[A], [B], [C]]`；落笔模式为 `[[A, B], [C]]`。删除 A 后，落笔模式仍为 `[[B], [C]]`；只有同一次落笔的全部段都被删除，才移除这条序列记录。

| 字段 | 语义 |
| --- | --- |
| `sampleId` | 作品的稳定 UUID，修改或再次导出不改变 |
| `artistId` | 匿名作者编号，建议用于数据集分组划分 |
| `title` | 作品名称 |
| `source` | `participant` 为参与者作品，`example` 为内置合成示例及其修改版本 |
| `createdAt`, `updatedAt` | 作品创建与最后修改的 ISO 时间 |
| `canvas` | 原始画布尺寸，800 × 1000 |
| `style` | 固定颜色 `#111111`、不透明度 1、线宽 1.5；线宽单位为画布像素 |
| `coordinates` | 左上角原点、按宽高分别归一化；控制点允许超出画布 |
| `curveType` | `cubic-bezier` |
| `sequenceBase` | 0 |
| `ordering` | `original-creation-order-final-surviving-geometry` |
| `fitting` | Paper.js 版本与初始拟合容差；手动修改后的形状不再受原拟合误差约束 |
| `curveCount`, `strokeCount` | 保留曲线数、至少有一段保留曲线的落笔数 |
| `sequenceUnit` | `curve` 或 `stroke`，作品当前记录模式 |
| `lineCount` | 当前模式下的训练序列长度 |
| `lines` | 当前模式的训练序列；每项包含 `id`、`sequence`、`creationOrder` 和 `curves` |
| `curves` | 保留旧格式字段的全部曲线平铺数组；落笔模式训练应读取 `lines` |

`lines[i].sequence` 是从 0 开始的线条位置。曲线模式中 `id` / `creationOrder` 来自曲线；落笔模式中来自原始落笔。`lines[i].curves` 与平铺 `curves` 中对应曲线的字段一致。

### 单个曲线元素

```json
{
  "id": "curve-uuid",
  "sequence": 0,
  "creationOrder": 4,
  "strokeId": "stroke-uuid",
  "strokeIndex": 0,
  "sourceStrokeOrder": 2,
  "sourceSegmentIndex": 1,
  "isStrokeStart": true,
  "isStrokeEnd": true,
  "points": [[0.2, 0.3], [0.25, 0.2], [0.4, 0.4], [0.5, 0.3]]
}
```

上面是字段示意，不是实际采集样本。

- 曲线上的 `sequence`：在平铺 `curves` 中的位置，始终是曲线级编号。下一条线的训练步数以 `lines[i].sequence` 为准。
- `creationOrder`：原始创建序号，在当前工程历史分支内递增，删除后不压缩。
- `strokeIndex`：保留落笔的连续编号，从 0 开始。
- `sourceStrokeOrder`：原始落笔序号，删除后允许有空缺。
- `sourceSegmentIndex`：该段在最初这次落笔的拟合结果中的位置，删除后允许有空缺。
- `isStrokeStart` / `isStrokeEnd`：是否是当前输出中这个落笔的第一个 / 最后一个保留段，不代表最初的第一段 / 最后一段仍然存在。
- `points`：顺序为 `[P0, P1, P2, P3]`，分别是起点、第一控制点、第二控制点、终点，保留最多 8 位小数。不反转路径方向，也不按空间位置重排。

曲线参数形式：`B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t)t^2 P2 + t^3 P3`，其中 `0 <= t <= 1`。

坐标分别按宽、高缩放，不保持欧氏长度。恢复几何时，X 乘 800、Y 乘 1000。栅格化需使用正确的宽高比和固定线宽，SVG 可作为对应的矢量视图。

### 编辑与顺序

例如按顺序画出 A、B、C，随后修改 A、删除 B、再画 D，训练数据为 `[A的最终形状, C, D]`。A 的 ID 和创建序号不变。

撤销和重做恢复对应几何快照与原有 ID。撤销新笔画后再画一笔会创建新 ID，并建立新的历史分支；被丢弃分支的创建序号可能被复用，因此 `creationOrder` 不是跨所有编辑分支的全局操作编号。当前最终序列内，序号唯一且有序。

连续落笔被分段时，按沿路径的方向依次排列。单独移动某段可能使最终路径不再连续；训练时不要仅凭共享的 `strokeId` 强制连接相邻端点。

## 完整工程

`schemaVersion` 为 `seqsketch.project/1.1`。包含作品元信息、`sequenceUnit`、画布配置、`curves`、`strokes`、`nextCurveOrder` 和 `nextStrokeOrder`。仍支持导入 1.0 工程，打开后以 1.1 保存。

`curves` 中的每段保留 `id`、`strokeId`、`creationOrder`、`segmentIndex` 和未归一化的四个控制点。

`strokes` 中每次落笔保存：

| 字段 | 语义 |
| --- | --- |
| `id` | 原始落笔 UUID |
| `order` | 原始落笔序号，从 0 开始 |
| `startedAt` | 开始落笔的 ISO 时间 |
| `rawPoints` | 原始采样点 `{x, y, t}`；t 是相对本次落笔开始的毫秒数 |

坐标已经映射到画布坐标系，超出画布的输入被限制在边界。忽略相邻距离过近的采样，保留浏览器提供的合并事件。原始采样不包含压力、倾斜角或设备信息。示例的采样数组为空，因为示例直接由矢量曲线构成。

删除曲线不会清除它所属落笔的原始采样记录。工程不保存撤销栈、鼠标悬停、完整修改日志或被放弃的撤销分支。不要将原始采样当作最终线条进行训练。

## SVG

曲线模式每段曲线一个 `path`；落笔模式每次保留落笔一个 `path`。每段几何使用独立的 `M ... C ...` 子路径，不会跨越被删除的段或编辑后产生的间隙补线。`data-sequence` 对应当前模式的线条顺序，元信息包含 `sequenceUnit`。

## 汇总建议

目前每次导出一个作品文件，没有服务器端数据汇总。收集时保留完整工程作为原始资料，训练 JSON 作为派生输入，以 `sampleId` 和 `updatedAt` 管理重复导出版本。作者编号在共享电脑上不会自动辨认参与者，需要组织者统一分配。

建议先进行少量试采集，检查：短排线是否丢失、拟合形状是否符合原笔迹、每张图的段数分布、段内方向与落笔分组，以及作者间训练/测试划分。
