#!/usr/bin/env bash
# Provisions Azure resources and deploys the Icebreaker app.
#
# Auth model: the storage account in this subscription forbids shared-key
# (connection-string) access by policy, so the web app authenticates to Table
# Storage with its **system-assigned managed identity** (Microsoft Entra ID).
# The app reads AZURE_STORAGE_ACCOUNT_URL and uses DefaultAzureCredential.
#
# Requirements: az CLI logged in; Node + npm available locally (we build and
# ship a self-contained package — Oryx server-side build is not used).
set -euo pipefail

# Subscription: override with SUBSCRIPTION=<id>, otherwise use the one az is
# currently set to.
SUBSCRIPTION="${SUBSCRIPTION:-$(az account show --query id -o tsv)}"
LOCATION="${LOCATION:-swedencentral}"
RG="${RG:-rg-icebreaker}"
SUFFIX="${SUFFIX:-$(openssl rand -hex 4)}"
STORAGE="${STORAGE:-icebreaker${SUFFIX}}"      # 3-24 lowercase alphanumeric
PLAN="${PLAN:-icebreaker-plan}"
APP="${APP:-icebreaker-${SUFFIX}}"             # globally-unique web app name
RUNTIME="${RUNTIME:-NODE:22-lts}"
ROLE="Storage Table Data Contributor"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Subscription: $SUBSCRIPTION"
az account set --subscription "$SUBSCRIPTION"

echo "==> Registering providers"
az provider register -n Microsoft.Web -o none
az provider register -n Microsoft.Storage -o none

echo "==> Resource group $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

echo "==> Storage account $STORAGE (Standard_LRS)"
az storage account create -n "$STORAGE" -g "$RG" -l "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 -o none
SA_ID="$(az storage account show -n "$STORAGE" -g "$RG" --query id -o tsv)"
TABLE_URL="https://${STORAGE}.table.core.windows.net"

echo "==> App Service plan $PLAN (Linux B1)"
az appservice plan create -n "$PLAN" -g "$RG" --is-linux --sku B1 -o none

echo "==> Web app $APP ($RUNTIME)"
az webapp create -n "$APP" -g "$RG" -p "$PLAN" --runtime "$RUNTIME" -o none

echo "==> Enabling managed identity + Table data role"
PRINCIPAL="$(az webapp identity assign -n "$APP" -g "$RG" --query principalId -o tsv)"
az role assignment create --assignee-object-id "$PRINCIPAL" \
  --assignee-principal-type ServicePrincipal --role "$ROLE" --scope "$SA_ID" -o none

echo "==> App settings"
az webapp config appsettings set -n "$APP" -g "$RG" --settings \
  "AZURE_STORAGE_ACCOUNT_URL=$TABLE_URL" \
  "SCM_DO_BUILD_DURING_DEPLOYMENT=false" \
  "WEBSITE_NODE_DEFAULT_VERSION=~22" -o none
az webapp config set -n "$APP" -g "$RG" --startup-file "node dist/http/server.js" -o none

echo "==> Building self-contained package"
cd "$HERE"
rm -rf dist .deploypkg
npm run build
mkdir .deploypkg
cp -R dist public package.json package-lock.json .deploypkg/
( cd .deploypkg && npm ci --omit=dev )
ZIP="$(mktemp -t icebreaker).zip"; rm -f "$ZIP"
( cd .deploypkg && zip -r -q "$ZIP" . )

echo "==> Waiting for RBAC propagation"
sleep 30

echo "==> Deploying"
az webapp deploy -n "$APP" -g "$RG" --src-path "$ZIP" --type zip -o none
rm -f "$ZIP"; rm -rf .deploypkg

URL="https://$(az webapp show -n "$APP" -g "$RG" --query defaultHostName -o tsv)"
echo ""
echo "Deployed: $URL"
echo "Create a session at:   $URL/"
echo "Resource group: $RG (tear down with: az group delete -n $RG --yes --no-wait)"
