variable "project" {
  description = "Short name used in every resource name."
  type        = string
  default     = "terra"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{2,11}$", var.project))
    error_message = "Use 3–12 lowercase letters or digits, starting with a letter."
  }
}

variable "environment" {
  description = "Deployment stage (dev, test, prod)."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "environment must be dev, test or prod."
  }
}

variable "location" {
  description = "Azure region. Australia East (Sydney) is closest to Brisbane."
  type        = string
  default     = "australiaeast"
}

variable "static_web_app_location" {
  description = "Static Web Apps are only offered in some regions; East Asia is the nearest to Brisbane."
  type        = string
  default     = "eastasia"
}

variable "sql_admin_login" {
  description = "SQL Server administrator login."
  type        = string
  default     = "terra_admin"
}

variable "sql_entra_admin_object_id" {
  description = "Object ID of the Entra ID group/user that administers Azure SQL (leave empty to skip)."
  type        = string
  default     = ""
}

variable "api_image" {
  description = "API container image (repository:tag) in the registry, set by CI."
  type        = string
  default     = "terra-api:latest"
}

variable "app_service_sku" {
  description = "App Service plan SKU for the API."
  type        = string
  default     = "B1"
}

variable "power_automate_url" {
  description = "HTTP trigger URL of the Terra Delay Alert flow (optional)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "webhook_secret" {
  description = "Shared secret for HMAC-signed webhooks (generated when empty)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "enable_wordpress" {
  description = "Deploy WordPress (App Service + MySQL Flexible Server) as the Dispatch CMS."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Extra tags applied to every resource."
  type        = map(string)
  default     = {}
}
