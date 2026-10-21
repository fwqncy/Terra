data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

resource "random_password" "sql" {
  length           = 24
  special          = true
  override_special = "!#%*-_=+"
}

resource "random_password" "webhook" {
  length  = 40
  special = false
}

locals {
  name           = "${var.project}-${var.environment}"
  compact        = "${var.project}${var.environment}${random_string.suffix.result}"
  webhook_secret = var.webhook_secret != "" ? var.webhook_secret : random_password.webhook.result
  tags = merge({
    project     = var.project
    environment = var.environment
    managed-by  = "terraform"
  }, var.tags)
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

# ---------- observability ----------

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  tags                = local.tags
}

# ---------- container registry ----------

resource "azurerm_container_registry" "main" {
  name                = "acr${local.compact}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = false
  tags                = local.tags
}

# ---------- SQL Server (players, saves, shipments) ----------

resource "azurerm_mssql_server" "main" {
  name                          = "sql-${local.name}-${random_string.suffix.result}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  version                       = "12.0"
  administrator_login           = var.sql_admin_login
  administrator_login_password  = random_password.sql.result
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true
  tags                          = local.tags

  dynamic "azuread_administrator" {
    for_each = var.sql_entra_admin_object_id == "" ? [] : [1]
    content {
      login_username = "terra-sql-admins"
      object_id      = var.sql_entra_admin_object_id
    }
  }
}

resource "azurerm_mssql_database" "main" {
  name                        = "sqldb-${local.name}"
  server_id                   = azurerm_mssql_server.main.id
  sku_name                    = "GP_S_Gen5_1"
  min_capacity                = 0.5
  auto_pause_delay_in_minutes = 60
  max_size_gb                 = 8
  zone_redundant              = false
  storage_account_type        = "Local"
  tags                        = local.tags
}

# Lets Azure services (the API) reach the server; tighten with private endpoints for production.
resource "azurerm_mssql_firewall_rule" "azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# ---------- Cosmos DB for MongoDB (brains, worlds, telemetry) ----------

resource "azurerm_cosmosdb_account" "main" {
  name                 = "cosmos-${local.name}-${random_string.suffix.result}"
  location             = azurerm_resource_group.main.location
  resource_group_name  = azurerm_resource_group.main.name
  offer_type           = "Standard"
  kind                 = "MongoDB"
  mongo_server_version = "7.0"
  minimal_tls_version  = "Tls12"
  tags                 = local.tags

  capabilities {
    name = "EnableMongo"
  }

  capabilities {
    name = "EnableServerless"
  }

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }
}

resource "azurerm_cosmosdb_mongo_database" "terra" {
  name                = "terra"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
}

# ---------- secrets ----------

resource "azurerm_key_vault" "main" {
  name                       = "kv-${local.compact}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = false
  soft_delete_retention_days = 7
  tags                       = local.tags
}

resource "azurerm_role_assignment" "deployer_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

locals {
  sql_connection = "Server=tcp:${azurerm_mssql_server.main.fully_qualified_domain_name},1433;Database=${azurerm_mssql_database.main.name};User ID=${var.sql_admin_login};Password=${random_password.sql.result};Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"
  secrets = {
    "sql-connection"   = local.sql_connection
    "mongo-connection" = azurerm_cosmosdb_account.main.primary_mongodb_connection_string
    "webhook-secret"   = local.webhook_secret
    "power-automate"   = var.power_automate_url != "" ? var.power_automate_url : "not-configured"
  }
}

resource "azurerm_key_vault_secret" "app" {
  for_each     = local.secrets
  name         = each.key
  value        = each.value
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.deployer_secrets]
}

# ---------- API (container on App Service) ----------

resource "azurerm_service_plan" "api" {
  name                = "asp-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  tags                = local.tags
}

resource "azurerm_static_web_app" "web" {
  name                = "stapp-${local.name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.static_web_app_location
  sku_tier            = "Free"
  sku_size            = "Free"
  tags                = local.tags
}

resource "azurerm_linux_web_app" "api" {
  name                = "app-${local.name}-api-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  service_plan_id     = azurerm_service_plan.api.id
  https_only          = true
  tags                = local.tags

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on                               = var.app_service_sku != "F1"
    container_registry_use_managed_identity = true
    health_check_path                       = "/api/health"
    health_check_eviction_time_in_min       = 5
    minimum_tls_version                     = "1.2"
    ftps_state                              = "Disabled"

    application_stack {
      docker_image_name   = var.api_image
      docker_registry_url = "https://${azurerm_container_registry.main.login_server}"
    }

    cors {
      allowed_origins = ["https://${azurerm_static_web_app.web.default_host_name}"]
    }
  }

  app_settings = {
    ASPNETCORE_ENVIRONMENT                = "Production"
    WEBSITES_PORT                         = "8080"
    Database__Provider                    = "SqlServer"
    ConnectionStrings__Sql                = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["sql-connection"].versionless_id})"
    ConnectionStrings__Mongo              = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["mongo-connection"].versionless_id})"
    Webhooks__Secret                      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["webhook-secret"].versionless_id})"
    Webhooks__PowerAutomateUrl            = var.power_automate_url == "" ? "" : "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["power-automate"].versionless_id})"
    WordPress__BaseUrl                    = var.enable_wordpress ? "https://${azurerm_linux_web_app.wordpress[0].default_hostname}" : ""
    App__PublicUrl                        = "https://${azurerm_static_web_app.web.default_host_name}"
    Cors__Origins__0                      = "https://${azurerm_static_web_app.web.default_host_name}"
    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.main.connection_string
  }

  logs {
    http_logs {
      file_system {
        retention_in_days = 7
        retention_in_mb   = 35
      }
    }
  }
}

resource "azurerm_role_assignment" "api_acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_web_app.api.identity[0].principal_id
}

resource "azurerm_role_assignment" "api_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.api.identity[0].principal_id
}

# ---------- Serverless (Azure Functions, Node 20) ----------

resource "azurerm_storage_account" "functions" {
  name                            = "st${local.compact}"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  tags                            = local.tags
}

resource "azurerm_service_plan" "functions" {
  name                = "asp-${local.name}-func"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  os_type             = "Linux"
  sku_name            = "Y1"
  tags                = local.tags
}

resource "azurerm_linux_function_app" "main" {
  name                       = "func-${local.name}-${random_string.suffix.result}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  service_plan_id            = azurerm_service_plan.functions.id
  storage_account_name       = azurerm_storage_account.functions.name
  storage_account_access_key = azurerm_storage_account.functions.primary_access_key
  https_only                 = true
  tags                       = local.tags

  identity {
    type = "SystemAssigned"
  }

  site_config {
    application_insights_connection_string = azurerm_application_insights.main.connection_string
    minimum_tls_version                    = "1.2"

    application_stack {
      node_version = "20"
    }

    cors {
      allowed_origins = ["https://${azurerm_static_web_app.web.default_host_name}"]
    }
  }

  app_settings = {
    TERRA_API_URL           = "https://${azurerm_linux_web_app.api.default_hostname}"
    COSMOS_MONGO_CONNECTION = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["mongo-connection"].versionless_id})"
    COSMOS_DATABASE         = azurerm_cosmosdb_mongo_database.terra.name
    POWER_AUTOMATE_URL      = var.power_automate_url == "" ? "" : "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["power-automate"].versionless_id})"
    WEBHOOK_SECRET          = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app["webhook-secret"].versionless_id})"
    WORDPRESS_URL           = var.enable_wordpress ? "https://${azurerm_linux_web_app.wordpress[0].default_hostname}" : ""
  }
}

resource "azurerm_role_assignment" "functions_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_function_app.main.identity[0].principal_id
}
