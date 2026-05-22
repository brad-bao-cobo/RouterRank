# Check4U Backend

FastAPI + Supabase backend，提供三项核心服务：
1. **定价数据 API** — 官方 & 聚合商 token 价格查询
2. **评测运行** — 对所有 provider × model 组合发起真实 API 调用并存储结果
3. **评分计算** — 基于测试结果计算可信度、经济性、性能三维评分

## 项目结构

```
backend/
├── app/
│   ├── main.py                  # FastAPI 入口
│   ├── config.py                # 全局配置（pydantic-settings + .env）
│   ├── database.py              # Supabase client 单例
│   ├── models/
│   │   ├── registry.py          # Provider & Model 注册表（唯一数据源）
│   │   ├── pricing.py           # 定价相关 Pydantic 模型
│   │   └── test_result.py       # 测试请求 Pydantic 模型
│   ├── routers/
│   │   ├── pricing.py           # GET /pricing/*
│   │   ├── test_run.py          # POST /test-run
│   │   ├── stream_test.py       # POST /stream-test-result
│   │   ├── model_evaluation.py  # GET /model-evaluation
│   │   └── providers.py         # GET /registry/*
│   └── services/
│       ├── llm_caller.py        # 所有 LLM API 调用（官方 & 三方，含流式）
│       ├── test_result.py       # 测试结果存库
│       └── metrics.py           # 两阶段评分计算
├── scripts/
│   ├── import_csv.py            # CSV 批量导入定价数据
│   ├── import_test_results.py   # 历史测试结果导入
│   ├── export_test_results.py   # 测试结果导出
│   └── run_test.py              # 手动触发测试运行
├── docker/
│   ├── init.sql                 # 本地 Docker 初始化 SQL
│   └── migrate.sql              # 数据库迁移
├── docker-compose.test.yml      # 本地测试环境（Supabase Docker）
├── schema.sql                   # 完整建表 SQL
├── requirements.txt
└── .env.example
```

## 快速上手

### 1. 建表（一次性）

登录 Supabase Dashboard → SQL Editor，粘贴并执行 `schema.sql`。

### 2. 配置环境变量

```bash
cp .env.example .env
# 填入 Supabase 和各 LLM 服务商的 API key
```

### 3. 安装依赖 & 启动

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Swagger 文档：`http://localhost:8000/docs`

### 4. 本地 Docker 测试环境

```bash
docker-compose -f docker-compose.test.yml up -d
# 使用 .env.test 连接本地 Supabase
ENV_FILE=.env.test uvicorn app.main:app --reload --port 8000
```

---

## API 说明

### Registry 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/registry/providers` | 全部 provider 及其支持的模型列表 |
| GET | `/registry/providers/{slug}` | 单个 provider（按 slug 查询） |
| GET | `/registry/models` | 全部唯一模型 |

### 定价接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/pricing/` | 查询全部定价，支持 `provider_type / provider_name / model_family / model_name` 过滤 |
| GET | `/pricing/comparison` | 官方价 vs 聚合商价，按模型分组 |
| GET | `/pricing/providers` | 服务商名称列表 |
| GET | `/pricing/models` | 模型名称列表 |
| GET | `/pricing/{id}` | 单条记录 |

### 测试运行接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/test-run` | 批量发起测试，结果写入 `test_result` 表 |
| POST | `/stream-test-result` | 单条 prompt 实时流式测试（SSE） |

#### POST /test-run 请求体

```json
{
  "prompts": ["prompt1", "prompt2"],
  "server": "prod-us-west",
  "region": "Shanghai",
  "temperature": 0,
  "models": ["gpt-5.4-mini", "claude-haiku-4-5", "gemini-3.1-flash-lite"],
  "providers": ["OpenAI", "Anthropic", "Google", "OpenRouter", "EasyRouter", "B.ai", "EdenAI"]
}
```

### 评分接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/model-evaluation` | 返回所有 provider × model 的最新评分结果 |
| POST | `/model-evaluation/compute` | 触发重新计算，结果写入 `model_evaluation` 表 |

---

## 评分算法

### Phase 1 — 原始指标

每个 provider × model 组合从 `test_result` 表中计算：

- `success_rate` — 成功请求比例
- `ttft / tpot / e2e` P50 & P95 — 延迟分位数（ms）
- `prompt_token_deviation` — 相同 `(run_id, prompt)` 下与官方的 token 数偏差
- `input/output/cached_input_price_deviation` — 与官方定价的偏差率

### Phase 2 — 三维评分（0–100）

| 维度 | 权重 | 依据 |
|------|------|------|
| 可信度 trustworthiness | 40% | token 偏差：偏差 0% → 100 分，偏差 ≥20% → 0 分 |
| 经济性 economics | 40% | 价格偏差：偏差越小分越高 |
| 性能 performance | 20% | 动态阈值：全部 provider 中最快 → 100，最慢 → 0 |

### Phase 3 — 综合评分 & 等级

```
total_score = 0.4 × trustworthiness + 0.4 × economics + 0.2 × performance
```

| 等级 | 分数区间 |
|------|---------|
| AAA  | ≥ 90    |
| AA   | ≥ 75    |
| A    | ≥ 60    |
| B    | ≥ 40    |
| C    | < 40    |

---

## 支持的 Provider × Model 组合

| 模型 | OpenAI | Anthropic | Google | OpenRouter | EasyRouter | B.ai | EdenAI |
|------|--------|-----------|--------|-----------|-----------|------|--------|
| GPT-5.4 mini          | ✅ | — | — | ✅ | ✅ | ✅ | ✅ |
| Claude Haiku 4.5      | — | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| Gemini 3.1 Flash-Lite | — | — | ✅ | ✅ | ✅ | ❌ | ✅ |

> 新增 provider 或 model 只需修改 `app/models/registry.py`，无需改动其他文件（除 `llm_caller.py` 新增调用函数外）。
