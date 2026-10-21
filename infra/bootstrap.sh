#!/usr/bin/env bash
# One-time setup: remote Terraform state + a GitHub Actions identity using OIDC (no stored secrets).
# usage: ./infra/bootstrap.sh <github-owner/repo> [location]
set -euo pipefail

REPO="${1:?usage: bootstrap.sh <github-owner/repo> [location]}"
LOCATION="${2:-australiaeast}"
SUFFIX=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 5)
RG="rg-terra-tfstate"
SA="stterratfstate${SUFFIX}"
SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)

echo "› State storage ${SA} in ${RG}"
az group create -n "$RG" -l "$LOCATION" -o none
az storage account create -n "$SA" -g "$RG" -l "$LOCATION" --sku Standard_LRS --min-tls-version TLS1_2 \
  --allow-blob-public-access false -o none
az storage container create -n tfstate --account-name "$SA" --auth-mode login -o none

echo "› GitHub Actions identity (OIDC federated credentials for main and pull requests)"
APP_ID=$(az ad app create --display-name "terra-github-actions" --query appId -o tsv)
az ad sp create --id "$APP_ID" -o none || true
for SUBJECT in "repo:${REPO}:ref:refs/heads/main" "repo:${REPO}:environment:production" "repo:${REPO}:pull_request"; do
  NAME=$(echo "$SUBJECT" | tr ':/' '--' | tr -cd 'a-zA-Z0-9-' | cut -c1-120)
  az ad app federated-credential create --id "$APP_ID" --parameters "{\"name\":\"${NAME}\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"${SUBJECT}\",\"audiences\":[\"api://AzureADTokenExchange\"]}" -o none
done
az role assignment create --assignee "$APP_ID" --role "Contributor" --scope "/subscriptions/${SUB}" -o none
az role assignment create --assignee "$APP_ID" --role "User Access Administrator" --scope "/subscriptions/${SUB}" -o none
az role assignment create --assignee "$APP_ID" --role "Storage Blob Data Contributor" \
  --scope "$(az storage account show -n "$SA" -g "$RG" --query id -o tsv)" -o none

cat <<OUT

Done. Add these GitHub repository secrets/variables:
  AZURE_CLIENT_ID        = ${APP_ID}
  AZURE_TENANT_ID        = ${TENANT}
  AZURE_SUBSCRIPTION_ID  = ${SUB}
  TF_STATE_STORAGE       = ${SA}

And create infra/terraform/backend.hcl from backend.hcl.example with storage_account_name = ${SA}.
OUT
