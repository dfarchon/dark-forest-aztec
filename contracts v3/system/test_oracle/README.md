# Test Oracle Contract

## 目的

这是一个测试合约，用于验证 Aztec Noir 中 Oracle API 的可用性，特别是 `get_block_header_at` 函数。

## 验证结果

✅ **成功验证**: `dep::aztec::oracle::block_header::get_block_header_at` 在 Aztec v3.0.0-devnet.6-patch.1 中**确实存在且可用**！

详细验证结果请参考: [AZTEC_ORACLE_API_VERIFICATION_RESULTS.md](../../../AZTEC_ORACLE_API_VERIFICATION_RESULTS.md)

## 关键发现

1. **`get_block_header_at` 只能在 Private 函数中使用**
   - 需要传入 `*self.context`（解引用）
   - 返回 `BlockHeader` 结构，具有 `.hash()` 方法

2. **需要导入 Hash trait**
   ```noir
   use dep::aztec::protocol_types::traits::Hash;
   ```

3. **正确的调用方式**
   ```noir
   #[external("private")]
   fn my_function(block_number: u32) -> pub Field {
       let header = get_block_header_at(block_number, *self.context);
       header.hash()
   }
   ```

## 使用场景

这个 API 可用于实现**安全的随机数生成**，类似于 Solidity 中的 `blockhash(n)`：

```noir
// 在 prospect 时记录区块号
let prospect_block = self.context.block_number();

// 在 find 时使用未来区块哈希
const DELAY_BLOCKS: u32 = 5;
let target_block = prospect_block + DELAY_BLOCKS;
assert(self.context.block_number() > target_block, "Too early");

let header = get_block_header_at(target_block, *self.context);
let randomness = poseidon2_hash([
    location_id,
    header.hash(),
    self.context.chain_id(),
]);
```

## 参考

- Discord 讨论: Josh 和 wei3erHase 关于 Aztec 随机数的讨论
- Zac Williamson: "blockHeader.hash() would be as safe to use as entropy as blockHash in Solidity"

## 状态

- **编译状态**: ✅ 成功
- **保留原因**: 作为 API 使用示例和参考文档
- **是否部署**: ❌ 否（仅用于测试验证）
