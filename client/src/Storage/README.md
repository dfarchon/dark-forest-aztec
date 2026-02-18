# Storage (English)

**Role**: **Local persistence**: privacy-related state, plugin library, UI preferences (e.g. modal positions, settings). Uses IndexedDB and/or localStorage. No chain or account logic.

**Public surface**: Export types and a single entry (e.g. `LocalStore` or `PersistentStorage`) with get/set/delete and optional subscriptions. StateManager (and optionally PluginManager) are the consumers.

**Dependencies**: None on other app modules. Do not use `packages/network`.

---

# Storage（中文）

**职责**：**本地持久化**：隐私相关状态、插件库、UI 偏好（如 modal 位置、设置）。使用 IndexedDB 和/或 localStorage，不包含链上或账号逻辑。

**对外暴露**：通过明确出口（如 `index.ts`）暴露类型与单例/类（如 `LocalStore` / `PersistentStorage`），提供 get/set/delete 及可选订阅。消费者为 StateManager（及可选的 PluginManager）。

**依赖**：不依赖本应用其他模块。不使用 `packages/network`。
