.PHONY: help up down build rebuild logs ps test lint check-infra dev-backend dev-agent

COMPOSE = docker compose
BACKEND_DIR = backend
AGENT_DIR   = agent-service
FRONTEND_DIR = frontend

help: ## 显示所有可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

up: ## 启动所有服务（后台）
	$(COMPOSE) up -d

down: ## 停止所有服务
	$(COMPOSE) down

build: ## 构建所有镜像
	$(COMPOSE) build

rebuild: ## 重新构建并启动
	$(COMPOSE) up -d --build

logs: ## 查看所有服务日志
	$(COMPOSE) logs -f

ps: ## 查看服务状态
	$(COMPOSE) ps

test: ## 运行所有测试
	cd $(BACKEND_DIR) && npm test
	cd $(AGENT_DIR) && python -m pytest -v

lint: ## 代码检查
	cd $(BACKEND_DIR) && npx eslint "src/**/*.ts" --fix
	cd $(AGENT_DIR) && python -m ruff check app/ --fix
	cd $(FRONTEND_DIR) && npx tsc --noEmit

check-infra: ## 检查基础设施连通性
	python3 scripts/check_infra.py

dev-backend: ## 本地开发 Backend（需要本地 PostgreSQL/Redis）
	cd $(BACKEND_DIR) && npm run start:dev

dev-agent: ## 本地开发 Agent Service（需要本地 Milvus/Neo4j/Redis）
	cd $(AGENT_DIR) && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend: ## 本地开发前端组件
	cd $(FRONTEND_DIR) && npm run dev

clean: ## 清理构建产物和容器
	$(COMPOSE) down -v --rmi local
	rm -rf $(BACKEND_DIR)/dist $(AGENT_DIR)/__pycache__ $(FRONTEND_DIR)/dist

init: ## 初始化项目（安装依赖 + 复制环境变量）
	cp -n .env.example .env || true
	cd $(BACKEND_DIR) && npm install
	cd $(FRONTEND_DIR) && npm install
	cd $(AGENT_DIR) && pip install -r requirements.txt
	@echo "✅ 项目初始化完成，请编辑 .env 填入真实配置"