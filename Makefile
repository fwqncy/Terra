# Terra — common tasks. Run `make help` to list them.
.PHONY: help install dev-api dev-web test test-engine test-web test-api test-functions e2e up up-lite up-serverless down connector geodata brains parity tf-validate

help: ## List targets
	@grep -E '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[1m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies
	cd web && npm ci
	cd functions && npm ci
	cd e2e && npm ci && npx playwright install chromium
	cd api && dotnet restore && dotnet tool restore

dev-api: ## Run the API on :5080 (SQLite + in-memory NoSQL)
	cd api/Terra.Api && dotnet run --urls http://localhost:5080

dev-web: ## Run the Angular dev server on :4200 (proxies /api)
	cd web && npm start

test: test-engine test-web test-api test-functions ## Run every unit/integration suite

test-engine: ## Plain-JS engine tests
	cd web && npm run test:engine

test-web: ## Angular unit tests (Vitest)
	cd web && npx ng test --watch=false

test-api: ## .NET tests incl. JS ⇄ C# parity
	cd api && dotnet test

test-functions: ## Azure Functions tests
	cd functions && npm test

e2e: ## Build the web app and run Playwright (starts the API itself)
	cd web && npx ng build
	cd e2e && npx playwright test

up: ## Full stack in Docker (app :8081, API :5080, WordPress :8080)
	docker compose up --build

up-lite: ## Full stack without SQL Server (Apple silicon without Rosetta)
	docker compose -f docker-compose.yml -f docker-compose.lite.yml up --build

up-serverless: ## Full stack plus Azure Functions and Azurite
	docker compose --profile serverless up --build

down: ## Stop the Docker stack
	docker compose --profile serverless down

connector: ## Regenerate the Power Platform connector from a running API
	node tools/build-connector.mjs http://localhost:5080

geodata: ## Re-download OSM roads + Natural Earth coastlines into the engine
	cd tools && npm install && node build-geodata.mjs

brains: ## Retrain the factory Autopilot brains
	node tools/pretrain.mjs

parity: ## Regenerate the JS → C# parity fixture
	node tools/parity-fixtures.mjs

tf-validate: ## Terraform fmt + validate (no Azure access needed)
	cd infra/terraform && terraform fmt -check -recursive && terraform init -backend=false -input=false && terraform validate
