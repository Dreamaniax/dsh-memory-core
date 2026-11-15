# ADR 0004 — FTS5 trigram 主路径 + 短查询 LIKE 回退

- 状态：Accepted（v0.1 已实现并验证）
- 日期：2026-11-14

## 背景

实测 unicode61 把连续中文当整词，2 字查询“复盘”无法命中“每周复盘”；trigram 对 >=3 字符中文有效，对 2 字符无效；LIKE 对 2 字符有效。英文 trigram 子串可用。

## 决策

v0.1 使用单个 FTS5 trigram 索引；查询长度 <3 Unicode 字符（或任一词 <3）时走 LIKE 回退。FTS 用 BM25（title 5/content 1/tags 2）；LIKE 按 updatedAt 排序。用户输入作为带引号 phrase 绑定，绝不拼 SQL。

## 备选

- 双索引 unicode61 + trigram：英文排序更好，但写入/迁移/一致性成本翻倍。
- 中文分词器/jieba：效果好，但引入依赖与词典维护。
- 仅 LIKE：简单但 10k+ 性能差、无 BM25。

## 后果

- 2 字中文查询可用但性能较低；文档明示。
- 英文 BM25 基于 trigram，和词级 BM25 不完全等价。
- v0.2 可加双索引/分词而不破坏 API。