# 工程標示字型

使用上游 **Noto Sans TC Regular（繁中區域版 OTF）**，不依賴作業系統 fallback，也不另做本機字型子集。

- 上游：[notofonts/noto-cjk](https://github.com/notofonts/noto-cjk)。
- Release：[`Sans2.004`](https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004)；內嵌版本為 2.004。
- 官方下載：[19_NotoSansTC.zip](https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/19_NotoSansTC.zip)。
- 壓縮檔內路徑：`NotoSansTC-Regular.otf`；原始大小 5,683,368 bytes。
- 字型檔 SHA-256：`5bab0cb3c1cf89dde07c4a95a4054b195afbcfe784d69d75c340780712237537`。
- 下載 ZIP SHA-256：`fbbcb216be8056a436c7ec142847f302bb1932d07bdad8b322f4953a389d7cbc`。
- Copyright（字型內嵌聲明）：© 2014–2021 Adobe (http://www.adobe.com/)。
- 授權：SIL Open Font License 1.1，見 [OFL.txt](OFL.txt)。字型由官方 release 原樣取出，**未修改原檔**；OFL.txt 與同一下載包的 LICENSE 逐位元相同。

覆蓋範圍以繁體中文為主。常見姓名及「堃、喆、璿、𡘙」等字元有覆蓋；不保證所有罕用姓名字或簡體／日文專有字形。例如「𠮷、髙、桜、诶」在此字庫中缺字，依 FEV-R22 以 `?` 替代並記錄缺字碼位警示，上傳與交易仍完成，完整來源文字照常保存。共用字元使用此繁中區域版的字形，不因內容語言切換字形，也不載入其他字型補字。

規則摘要的 `font_version` 包含上述字型 SHA-256、Pillow 與 FreeType 版本；排版固定 BASIC。更新字型時必須重跑姓名覆蓋、缺字不中斷及確定性測試。
