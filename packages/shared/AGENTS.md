# `@shared` — 脚本开发套件运行时

读者：Agent。分层与模块契约以 `docs/kit.md` 第 2–3 节为准，这里只写本包的落地规则。

## 目录

```text
src/
  host/       gm.ts  storage.ts  clipboard.ts  settings-store.ts
  settings/   define-settings.ts（第 2 步）
  runtime/    boot.ts  menu.ts  frame.ts  logger.ts（第 3 步）
  dom/        target.ts  traverse.ts  position.ts（第 6 步）
  url/        url.ts（第 6 步）
  index.ts    门面：只导出确认多脚本共用的符号
```

## 规则

1. 模块级不得有副作用：不写全局、不注册监听、不读存储，否则树摇失效，
   改一处会影响四个脚本的产物。
2. 不新增 `@grant`：能力缺失时降级（读不到给默认值、写不进去返回 false，
   注册失败返回 false），风格对齐 `host/gm.ts`。
3. 门面只导出多脚本共用的符号；单脚本逻辑留在脚本内（见 `kit.md` 非目标表）。
4. 每个新模块同步加单测；树摇用哨兵字符串验证（见 `kit.md` 第 8 节）。
