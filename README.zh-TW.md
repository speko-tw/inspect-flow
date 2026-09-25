# inspect-flow

[English](README.md) | **繁體中文**

InspectFlow 工程查核系統（Engineering Inspection Management System）

## 執行檢查

需求：[uv](https://docs.astral.sh/uv/)、Node.js（版本見
`frontend/.nvmrc`）、`make`。

- `make setup` 安裝前後端依賴。
- `make check` 對前後端依序執行格式檢查、lint、型別檢查、測試與
  build，並包含前端的拆包檢查。
- CI 在每個 PR 與每次 push 到 `main` 時，執行同一個 `make check`。
- 本機環境變數請複製 `.env.example` 為 `.env` 使用；`.env` 不得
  提交。

## 文件

- [設計意圖（Design Intents）](docs/intents/README.md)：說明 InspectFlow 為什麼這樣設計，包含總覽與架構圖、設計原則、關鍵決策與技術棧、名詞對照，以及待決議事項。
