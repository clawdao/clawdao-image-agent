# scripts/_scratch — 一次性分析脚本归档区

这些脚本是 **HTML 海报管线开发期**（2026-10-22 ~ 2026-10-24）用来做逆向分析和像素比对的一次性工具：
几何探针、字宽采样、ASCII 网格还原、墨迹/配色比对、SVG dump 等。

## 为什么不直接删

- `tmp-compare-design.ts` / `tmp-compare-geom.ts` / `tmp-compare-ink.ts` 是 **P2-T4 `scripts/poster-diff.ts`
  的原型实现**（断行比对 + 像素差统计），做正式 diff 工具时可以直接参考；
- `tmp-analyze-ref.ts` / `tmp-profile-geometric.ts` / `tmp-subject-ref.ts` 是**基线几何提取**工具，
  回归基线（X-T2）重算时用得上；
- 其余是排障现场（ASCII 看版式、切片看某一块、dump SVG 看结构），重跑一次比重新写一遍便宜。

## 规矩

1. **不放正式入口**：正式的出图 / 合规 / 检查脚本一律在 `scripts/` 顶层或 `scripts/lib/`；
2. **仍然参与类型检查**：`scripts/tsconfig.json` 收录 `scripts/**/*.ts`，所以这里也得类型干净；
3. **不是 API**：别在别处 import 它们；要用就把逻辑提进 `scripts/lib/` 再正式引用；
4. **命名保留 `tmp-` 前缀**：一眼看出是一次性的，不值得当成正式工具维护。
