# Cella Playground

> **一個概念，各式投影。**

你有沒有想過——「狗」和「dog」明明長得完全不一樣，為什麼我們知道它們是同一個東西？

程式世界也有這個問題。同一份資料可以用 JSON 表示，也可以用 XML 表示。同一個功能在 v1 API 和 v2 API 長得不一樣。同一個演算法在 Python 和 Rust 裡寫法不同。

**我們一直在手動確認「這兩個東西其實是同一個」。** 手動寫轉換器、手動維護版本相容、手動 port 程式碼。

如果有一套系統，能用數學**證明**兩個表達是同一個概念，然後**自動轉換**呢？

---

## 這就是 Cella

Cella 是一個基於 **Cubical Type Theory** 的語言。聽起來很嚇人，但核心想法很簡單：

### 1. 程式就是證明

在 Cella 裡，寫一個函數 `A -> B`，就是在證明「如果 A 成立，那 B 也成立」。不是比喻——是數學事實。型別檢查通過 = 你的證明是正確的。

### 2. 等式是路徑，不是對錯

傳統數學說 `a = b` 要麼成立要麼不成立。Cella 說 `a = b` 是一條**路徑**——從 a 走到 b 的過程。不同的路 = 不同的證明方式。

### 3. 等價的東西就是同一個東西

這是最關鍵的。如果兩個結構可以互相轉換且不丟失資訊（數學上叫「等價」），Cella 保證它們就是**同一個東西**。而且可以**自動轉換**——不需要你手動寫任何轉接器。

**這叫 Univalence。** 在其他系統（如 Lean4、Coq）裡，這只是一個理論宣言。在 Cella 裡，它是**可以執行的程式碼**。

---

## 為什麼你該在意？

想像一下：

- 換了資料庫 schema？**自動 migration，數學保證不丟資料。**
- API 升級了版本？**自動產生 adapter，保證行為一致。**
- 要把 Python 程式搬到 Rust？**證明兩邊等價，自動翻譯。**

這些今天都需要工程師手動做，而且經常出錯。Cella 的目標是讓**概念本身**成為程式設計的核心——程式碼只是概念的投影，投影可以自由切換。

---

## 試試看

**[打開 Playground →](https://timcsy.github.io/cella/playground/)**

三條路線，選適合你的：

| 路線 | 適合誰 | 你會學到 |
|------|--------|---------|
| 🌱 **初心者** | 我沒學過數學 | 型別、函數、遞迴、等式是路徑、程式＝證明 |
| 🔬 **數學人** | 我學過數學 | Curry-Howard、HoTT、transport、Univalence 的計算性 |
| ⚡ **老手** | 我用過 Lean4/Agda/Coq | 語法對照、cubical interval、ua compute、效能 |

不用安裝任何東西。打開瀏覽器就能寫程式、驗證證明、看到結果。

---

## 跟 Lean4 / Agda / Coq 的差異

| | Lean4 | Cubical Agda | Coq | **Cella** |
|---|-------|-------------|-----|-----------|
| 等式可計算 | ✗ | ✓ | ✗ | **✓** |
| transport 歸約 | ✗ | ✓ | ✗ | **✓** |
| ua 可執行 | ✗ | ✓ | ✗ | **✓** |
| 瀏覽器原生 | ✗ | ✗ | △ | **✓** |
| 概念距離 | ✗ | ✗ | ✗ | **研究中** |

Cella 的 `transport (ua equiv) x` 會歸約為 `equiv.forward x`。在 Lean4 和 Coq 裡，這一行永遠 stuck。

---

## 技術細節

- 完全在瀏覽器中執行（WebAssembly），不需要後端伺服器
- WASM module 僅 1.4 MB
- 286 個標準庫定義預載
- 基於 CCHM Cubical Type Theory（§2-§8 完整實作）
- Rust 實作，記憶體優化（400 個定義僅 78 MB）

---

## 開發

```bash
# 建構 WASM module
wasm-pack build crates/playground-wasm --target web --out-dir ../../playground/pkg

# 產生 stdlib cache
cargo run --bin stdlib-cache -- lib/std.cella -o playground/stdlib.celc

# 本地測試
python3 -m http.server 3000 -d playground
```

---

**Cella** — 程式碼只是概念的投影。概念才是本體。
