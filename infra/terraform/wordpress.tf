# Optional: WordPress (PHP) as the Dispatch CMS — App Service container + MySQL Flexible Server.

resource "random_password" "mysql" {
  count   = var.enable_wordpress ? 1 : 0
  length  = 24
  special = false
}

resource "azurerm_mysql_flexible_server" "wordpress" {
  count                  = var.enable_wordpress ? 1 : 0
  name                   = "mysql-${local.name}-${random_string.suffix.result}"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  administrator_login    = "wpadmin"
  administrator_password = random_password.mysql[0].result
  sku_name               = "B_Standard_B1ms"
  version                = "8.0.21"
  backup_retention_days  = 7
  tags                   = local.tags

  storage {
    size_gb = 20
  }
}

resource "azurerm_mysql_flexible_database" "wordpress" {
  count               = var.enable_wordpress ? 1 : 0
  name                = "wordpress"
  resource_group_name = azurerm_resource_group.main.name
  server_name         = azurerm_mysql_flexible_server.wordpress[0].name
  charset             = "utf8mb4"
  collation           = "utf8mb4_unicode_ci"
}

resource "azurerm_mysql_flexible_server_firewall_rule" "azure" {
  count               = var.enable_wordpress ? 1 : 0
  name                = "AllowAzureServices"
  resource_group_name = azurerm_resource_group.main.name
  server_name         = azurerm_mysql_flexible_server.wordpress[0].name
  start_ip_address    = "0.0.0.0"
  end_ip_address      = "0.0.0.0"
}

resource "azurerm_linux_web_app" "wordpress" {
  count               = var.enable_wordpress ? 1 : 0
  name                = "app-${local.name}-wp-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  service_plan_id     = azurerm_service_plan.api.id
  https_only          = true
  tags                = local.tags

  site_config {
    always_on = var.app_service_sku != "F1"

    application_stack {
      docker_image_name   = "wordpress:6.8-php8.3-apache"
      docker_registry_url = "https://index.docker.io"
    }
  }

  app_settings = {
    WORDPRESS_DB_HOST                   = azurerm_mysql_flexible_server.wordpress[0].fqdn
    WORDPRESS_DB_USER                   = "wpadmin"
    WORDPRESS_DB_PASSWORD               = random_password.mysql[0].result
    WORDPRESS_DB_NAME                   = "wordpress"
    WORDPRESS_CONFIG_EXTRA              = "define('MYSQL_CLIENT_FLAGS', MYSQLI_CLIENT_SSL);"
    WEBSITES_ENABLE_APP_SERVICE_STORAGE = "true"
  }
}
