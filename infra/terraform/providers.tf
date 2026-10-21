terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.10"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state lives in an Azure Storage account created once by bootstrap.sh.
  # `terraform init -backend-config=backend.hcl` (see backend.hcl.example), or
  # `terraform init -backend=false` for local validation.
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
  # GitHub Actions authenticates with OIDC (ARM_USE_OIDC=true); locally `az login` works.
  storage_use_azuread = true
}
