# 奶粉粉体物性试验台（Qwik · 纯前端 · 本机离线）

无服务器 TypeScript 应用：乳粉 **松装密度 / 振实密度 / 漏斗流动时间** 的分步试验、读数复核与本机留档。
数据保存在浏览器 **IndexedDB**，天平与振实计数器通过 **Web Serial** 直连（无串口硬件时可用内置模拟设备演练）。

> 范围声明：系统仅按**已批准方法版本**中的公式读数与计算；**不评价冲调体验、不推荐任何生产参数**。

## 运行

```bash
npm install
npm run dev        # 开发（http://localhost:5173）
npm run build      # 纯 CSR 静态产物到 dist/
npx vite preview   # 注意：Qwik CSR 模式下 preview 会因插件空路径报错；
                   # 直接用静态服务器即可： npx serve dist 或 python3 -m http.server -d dist
npm run test       # 27 个单元测试（公式/判废场景/串口解析/阶段锁定）
npm run typecheck  # tsc --noEmit
```

> Web Serial 需要 Chrome/Edge 且为安全上下文（https 或 localhost）。不支持时界面会提示，可用“模拟天平 / 模拟计数器”完成全流程。
> 构建产物是纯静态文件（`vite preview` 与 Qwik CSR 插件有兼容问题，用 `python3 -m http.server` 等静态服务器即可）。

## 试验流程（逐步向导）

1. **样品/方法**：登记生产样编号、批号、开封时间、调湿状态；选择已批准方法（`Q/MPS-PHY-01 v1.0`）与试验类型。
2. **装粉核对**：选择量筒与装粉方式；点击即**分装一份新 aliquot**（暴露计时从此开始）。
3. **松装读数 V0**：引用天平“稳定(ST)”读数作为皮重 m0、毛重 m1；录入 V0 与周向最高/最低读数。
4. **振实 Vt**：串口计数器/手动脉冲累计次数，**中断即按方法判废且不可续数**；录入 Vt。
5. **漏斗流动**：锁定装粉量 → t1 放开 → t2 最后一粒落下；称残留质量并确认是否口粘粉。
6. **读数复核**：实验员确认结团/架桥/洒失/吸湿/有效测次；无判废项且勾选有效才按公式计算并保存。

### 阶段锁定（关键约束）

每次装粉都会新建 aliquot，状态机：

- 松装链路：`fresh → bulk_loose → tapped`（振实后**禁止**再把这份试样当作初始松装样）
- 流动链路：`fresh → flow_loaded → flow_discharged`
- 异常：`spent`（洒失/吸湿超限/中断后丢弃，必须另取新样）

“本机记录”页有 **aliquot 台账**可审计每个分装的阶段。

## 五个异常测试场景

顶部“异常场景自检”一键注入演示样并直达复核页，对应判废规则：

| 场景 | 触发 | 判废代码 |
| --- | --- | --- |
| 量筒皮重错用 | 实测皮重 58.4 g 与台账 46.2 g 差 >0.5 g | `TARE_MISMATCH` |
| 粉面倾斜 | 周向读数差 6 mL > 量筒允许 2 mL | `SURFACE_TILT` |
| 振实计数中断 | 463/500 且脉冲中断 | `TAP_SHORT` + `TAP_INTERRUPTED` |
| 漏斗口粘粉 | 出口粘粉、残留 3.4 g | `OUTLET_STICKING` |
| 等待期间吸湿 | 开封暴露 > 方法限值 10 min | `MOISTURE_EXPOSURE(_FLOW)` |

判废记录可“留档”但**不计算结果、不计入有效测次**；只有实验员勾选“有效测次”且无 error 时才计入汇总。

## 已批准公式（`Q/MPS-PHY-01 v1.0`）

- 松装密度 ρb = (m1 − m0) / V0（g/mL，3 位小数）
- 振实密度 ρt = (m1 − m0) / Vt（g/mL，3 位小数）
- 流动时间 t = t2 − t1（s，2 位小数，100 g 标准装粉）

公式 id 白名单：`bulk-density-q-phy-01` / `tapped-density-q-phy-01` / `flow-time-100ml-q-phy-01`。
未列入方法版本的指标（Hausner/Carr/冲调性等）系统不计算。

## 代码结构

```
src/
  domain/      类型、种子（方法/量筒台账）、公式、复核规则（纯函数，可测）
  db/          IndexedDB 键值持久化（无网络）
  device/      Web Serial 管理器 + 天平/计数器 ASCII 协议解析 + 模拟设备
  state/       Qwik store：向导动作、aliquot 阶段锁定、保存判废
  components/  Qwik 组件：步骤向导、设备栏、SVG 量筒/漏斗、记录与场景面板
```

### 串口协议

- 天平：按行读取，`ST`/`S`/`OK` 为稳定标记，如 `ST,GS,+102.35,g`；只有稳定读数允许“引用到读数单”。
- 计数器：`P,n` 脉冲、`R` 复位、`H` 保持/中断；真实设备 9600 8N1，模拟器每 120 ms 一个脉冲。
