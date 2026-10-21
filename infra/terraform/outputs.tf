output "resource_group" {
  description = "Resource group holding everything."
  value       = azurerm_resource_group.main.name
}

output "acr_login_server" {
  description = "Container registry for the API image."
  value       = azurerm_container_registry.main.login_server
}

output "api_app_name" {
  description = "App Service running the .NET API."
  value       = azurerm_linux_web_app.api.name
}

output "api_hostname" {
  description = "Public API host (use for the Power Platform connector)."
  value       = azurerm_linux_web_app.api.default_hostname
}

output "web_url" {
  description = "Angular front end (Azure Static Web Apps)."
  value       = "https://${azurerm_static_web_app.web.default_host_name}"
}

output "static_web_app_name" {
  description = "Static Web App resource name (CI reads its deployment token)."
  value       = azurerm_static_web_app.web.name
}

output "function_app_name" {
  description = "Azure Functions app for the serverless jobs."
  value       = azurerm_linux_function_app.main.name
}

output "sql_server_fqdn" {
  description = "Azure SQL server."
  value       = azurerm_mssql_server.main.fully_qualified_domain_name
}

output "cosmos_account" {
  description = "Cosmos DB (MongoDB API) account."
  value       = azurerm_cosmosdb_account.main.name
}

output "key_vault_name" {
  description = "Key Vault with the app secrets."
  value       = azurerm_key_vault.main.name
}

output "wordpress_url" {
  description = "WordPress Dispatch CMS (when enabled)."
  value       = var.enable_wordpress ? "https://${azurerm_linux_web_app.wordpress[0].default_hostname}" : null
}
