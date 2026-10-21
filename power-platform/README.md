# Terra on Microsoft Power Platform

| Piece | What it does | File |
| --- | --- | --- |
| **Custom connector** "Terra Logistics" | Lets Power Apps and Power Automate read the live network (snapshot, shipments, leaderboard) and expedite shipments | `connector/apiDefinition.swagger.json`, `connector/apiProperties.json` |
| **Flow: Terra Delay Alert** | The .NET API posts critical shipment events (HMAC-signed) to this HTTP-triggered flow, which posts an Adaptive Card to Teams and emails the on-call lead | `flows/TerraDelayAlert.json` |
| **Flow: Terra Daily Dispatch** | The `dailyDispatch` Azure Function posts the morning summary here; the flow shares it in Teams | `flows/TerraDailyDispatch.json` |
| **Canvas app: Terra Ops** | A supervisor's view of at-risk shipments with one-tap Expedite, built on the connector | `canvas-app/Src/*.pa.yaml` |
| **Power BI / Dataverse-free reporting** | SQL Server views `dbo.vw_Leaderboard`, `dbo.vw_LanePerformance` and the procedure `dbo.usp_AtRiskShipments` (see `database/terra-schema.sql`) | — |

## Regenerating the connector

The connector is generated from the API's own OpenAPI 2.0 document, so it never drifts:

```bash
cd api/Terra.Api && dotnet run --urls http://localhost:5080 &
node tools/build-connector.mjs http://localhost:5080
```

## Importing with the Power Platform CLI

```bash
pac auth create --environment https://YOUR-ENV.crm6.dynamics.com
# 1. Connector (set the host to your API, e.g. the Terraform output `api_hostname`)
pac connector create --api-definition-file power-platform/connector/apiDefinition.swagger.json \
                     --api-properties-file power-platform/connector/apiProperties.json
# 2. Flows: create a solution, add each flow from the JSON (Power Automate → Import → Package (legacy)
#    or paste into a new solution flow), then set the environment variables
#    terra_OpsTeamId, terra_OpsChannelId and terra_OnCallEmail.
# 3. Copy the flow's HTTP trigger URL into the API setting Webhooks:PowerAutomateUrl
#    (Terraform: var.power_automate_url) and the Function setting POWER_AUTOMATE_URL.
# 4. Canvas app: in Power Apps Studio, add the Terra Logistics connector, then paste the
#    YAML from canvas-app/Src into the tree view (or `pac canvas pack --sources canvas-app --msapp TerraOps.msapp`).
```

Send a test alert at any time with `POST /api/webhooks/test`.
